/**
 * Seeder write path — Location 1 (text) then embed + Location 2 (vector).
 *
 * Domain 4, Step 4.4. For each batch of chunks:
 *   1. upsert text fields (Location 1) — ids are content hashes, so idempotent;
 *   2. embed the batch via the provider (array input = ONE batched call);
 *   3. batch-commit the vector field (Location 2) with `FieldValue.vector`
 *      semantics. Text already exists, so on embedding failure a re-run only
 *      fills missing vectors.
 *
 * NOTE: the real Firestore stores vectors via `FieldValue.vector(array)` — a
 * plain array is NOT queryable by `findNearest`. The fake test double stores a
 * plain array (elements are what matter there), so the real client must wrap
 * the vector here.
 */

import { FieldValue } from '@google-cloud/firestore';

import type { Firestore } from './types/firestore.js';
import type { Embedder } from './types/embedder.js';
import type { Chunk } from './types/corpus.js';

export interface WriteVectorOptions {
  maxRetries?: number;
  retryBaseMs?: number;
}

type EmbedError = Error & { code?: string };

/**
 * Writes the text/metadata half of a chunk (Location 1).
 * @param firestore Firestore-shaped backend.
 * @param chunks    each chunk carries `{ id, text, title, url, sourceId, category, index, tags }`.
 */
export async function writeTextFields(firestore: Firestore, chunks: Chunk[]): Promise<void> {
  const batch = firestore.batch();
  for (const chunk of chunks) {
    batch.set(firestore.collection('chunks').doc(chunk.id), {
      sourceId: chunk.sourceId,
      category: chunk.category,
      title: chunk.title,
      url: chunk.url,
      index: chunk.index,
      text: chunk.text,
      tags: chunk.tags,
    }, { merge: true });
  }
  await batch.commit();
}

/**
 * Builds the text actually embedded for a chunk: the source tags (synonyms)
 * prepended to the body text. Prepending to EVERY chunk means the synonym
 * signal reaches every vector of a source, not just the first chunk. The
 * stored `text` field stays the original body so citations/answers are
 * unchanged — only the embed input is enriched.
 */
export function embedTextForChunk(chunk: Chunk): string {
  const tags = Array.isArray(chunk.tags) && chunk.tags.length > 0 ? chunk.tags.join(', ') : '';
  return tags ? `${tags}. ${chunk.text}` : chunk.text;
}

/**
 * Embeds a batch of texts and merges the vector field (Location 2).
 * @param firestore   Firestore-shaped backend.
 * @param chunks      each with `id` and `text` (+ optional `tags`).
 * @param embeddings  adapter with `embed(texts) -> Array<number[]>`.
 * @param opts        `{ maxRetries = 3, retryBaseMs = 50 }` 429/5xx backoff per batch.
 * @returns number of vectors written.
 */
export async function writeVectors(
  firestore: Firestore,
  chunks: Chunk[],
  embeddings: Embedder,
  opts: WriteVectorOptions = {},
): Promise<number> {
  const maxRetries = opts.maxRetries ?? 3;
  const retryBaseMs = opts.retryBaseMs ?? 50;
  const vectors = await embedWithRetry(
    chunks.map((c) => embedTextForChunk(c)),
    embeddings,
    { maxRetries, retryBaseMs },
  );

  const batch = firestore.batch();
  chunks.forEach((chunk, i) => {
    const vec = vectors[i];
    if (vec && vec.length > 0) {
      // Real Firestore requires the vector wrapped in FieldValue.vector() for
      // findNearest to query it. The fake stores a plain array (elements only).
      batch.set(
        firestore.collection('chunks').doc(chunk.id),
        { embedding: FieldValue.vector(vec) },
        { merge: true },
      );
    }
  });
  await batch.commit();
  return vectors.filter((v) => Array.isArray(v) && v.length > 0).length;
}

/** Embed with retry/backoff on 429 or 5xx; throws a typed error after exhausting. */
async function embedWithRetry(
  textsAll: string[],
  embeddings: Embedder,
  { maxRetries, retryBaseMs }: { maxRetries: number; retryBaseMs: number },
): Promise<number[][]> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const vectors = (await embeddings.embed(textsAll)) as number[][];
      if (!Array.isArray(vectors)) throw new Error('embedding adapter returned non-array');
      return vectors;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const embedErr = err as EmbedError;
      // Generic retryable errors are retried unless the adapter annotated a
      // non-retryable code.
      if (typeof embedErr.code === 'string' && isNonRetryable(embedErr.code)) {
        break;
      }
      if (maxRetries > 0) await sleep(retryBaseMs * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** Built-in non-retryable codes (adapter sets `code` on errors). */
function isNonRetryable(err: string): boolean {
  return err === 'INVALID_ARGUMENT' || err === 'UNAUTHENTICATED' || err === 'FORBIDDEN';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}