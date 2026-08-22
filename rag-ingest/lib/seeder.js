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

/**
 * Writes the text/metadata half of a chunk (Location 1).
 * @param {object} firestore
 * @param {Array<object>} chunks  each { id, text, title, url, sourceId, category, index }
 */
export async function writeTextFields(firestore, chunks) {
  const batch = firestore.batch();
  for (const chunk of chunks) {
    batch.set(firestore.collection('chunks').doc(chunk.id), {
      sourceId: chunk.sourceId,
      category: chunk.category,
      title: chunk.title,
      url: chunk.url,
      index: chunk.index,
      text: chunk.text,
    }, { merge: true });
  }
  await batch.commit();
}

/**
 * Embeds a batch of texts and merges the vector field (Location 2).
 *
 * @param {object} firestore
 * @param {Array<object>} chunks       each with `id` and `text`.
 * @param {object} embeddings          adapter with `embedMany(texts) -> Array<number[]>`.
 * @param {object} [opts]
 * @param {number} [opts.maxRetries=3]  429/5xx backoff retries per batch.
 * @param {number} [opts.retryBaseMs=50] base backoff (doubles each retry).
 * @returns {Promise<number>} number of vectors written.
 */
export async function writeVectors(firestore, chunks, embeddings, opts = {}) {
  const maxRetries = opts.maxRetries ?? 3;
  const retryBaseMs = opts.retryBaseMs ?? 50;
  const vectors = await embedWithRetry(chunks.map((c) => c.text), embeddings, {
    maxRetries,
    retryBaseMs,
  });

  const batch = firestore.batch();
  chunks.forEach((chunk, i) => {
    if (vectors[i]) {
      // Real Firestore requires the vector wrapped in FieldValue.vector() for
      // findNearest to query it. The fake stores a plain array (elements only).
      batch.set(
        firestore.collection('chunks').doc(chunk.id),
        { embedding: FieldValue.vector(vectors[i]) },
        { merge: true },
      );
    }
  });
  await batch.commit();
  return vectors.filter(Boolean).length;
}

/** Embed with retry/backoff on 429 or 5xx; throws a typed error after exhausting. */
async function embedWithRetry(textsAll, embeddings, { maxRetries, retryBaseMs }) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const vectors = await embeddings.embed(textsAll);
      if (!Array.isArray(vectors)) throw new Error('embedding adapter returned non-array');
      return vectors;
    } catch (err) {
      lastErr = err;
      // Generic retryable errors are retried unless the adapter annotated a
      // non-retryable code.
      if (err && typeof err.code === 'string' && isNonRetryable(err.code)) {
        break;
      }
      if (maxRetries > 0) await sleep(retryBaseMs * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** Built-in non-retryable codes (adapter sets `code` on errors). */
function isNonRetryable(err) {
  return err.code === 'INVALID_ARGUMENT' || err.code === 'UNAUTHENTICATED' || err.code === 'FORBIDDEN';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}