/**
 * Firestore-backed vector retriever.
 *
 * Domain 3, Step 3.2. Runs a single `findNearest` (COSINE) query against the
 * `chunks` collection, bounded by a soft timeout + concurrency semaphore so a
 * slow Firestore / slow embed never drags the request tail indefinitely.
 */

import { withSoftTimeout, createSemaphore } from './limiter.js';
import type { Embedder, Hit } from '../types/rag.js';
import type { Firestore } from '../types/firestore.js';

export interface RetrieverDeps {
  firestore: Firestore;
  embeddings: Embedder;
}

export interface RetrieverOptions {
  limit?: number;
  maxConcurrent?: number;
  retrieveTimeoutMs?: number;
  embedTimeoutMs?: number;
}

export interface RetrieveOptions {
  /** Max number of chunks (defaults to factory `limit`). */
  limit?: number;
  distanceThreshold?: number;
  timeoutMs?: number;
  embedTimeoutMs?: number;
}

export interface RetrieveResult {
  hits: Hit[];
  timedOut: boolean;
  reason: string | null;
}

export interface Retriever {
  retrieve(queryVector: number[], options?: RetrieveOptions): Promise<Hit[]>;
  retrieveWithTimeout(queryVector: number[], options?: RetrieveOptions): Promise<Hit[]>;
  embedAndRetrieve(queryText: string, options?: RetrieveOptions): Promise<RetrieveResult>;
  readonly activeCount: number;
}

export function createRetriever(deps: RetrieverDeps, options: RetrieverOptions = {}): Retriever {
  const { firestore, embeddings } = deps;
  const limit = options.limit ?? 20;
  const semaphore = createSemaphore(options.maxConcurrent ?? 4);
  const retrieveTimeoutMs = options.retrieveTimeoutMs ?? 2000;

  async function retrieve(
    queryVector: number[],
    { limit: k = limit, distanceThreshold }: RetrieveOptions = {},
  ): Promise<Hit[]> {
    const col = firestore.collection('chunks');
    const query = col.findNearest({
      vectorField: 'embedding',
      queryVector,
      limit: k,
      distanceMeasure: 'COSINE',
      distanceResultField: 'similarity',
      ...(distanceThreshold !== undefined ? { distanceThreshold } : {}),
    });
    const snap = await query.get();
    return snap.docs.map((d) => {
      const raw = d.data() ?? {};
      const data = { ...raw, id: d.id } as Hit;
      return {
        ...data,
        ...(data.similarity !== undefined
          ? { distance: data.similarity, similarityScore: 1 - data.similarity }
          : {}),
      };
    });
  }

  async function retrieveWithTimeout(
    queryVector: number[],
    opts: RetrieveOptions = {},
  ): Promise<Hit[]> {
    const result = await withSoftTimeout(() => semaphore.run(() => retrieve(queryVector, opts)), {
      timeoutMs: opts.timeoutMs ?? retrieveTimeoutMs,
      fallback: [],
    });
    return result.value;
  }

  async function embedAndRetrieve(
    queryText: string,
    opts: RetrieveOptions = {},
  ): Promise<RetrieveResult> {
    const embed = await withSoftTimeout(() => embeddings.embed(String(queryText || '')), {
      timeoutMs: opts.embedTimeoutMs ?? 1500,
      fallback: null,
    });
    if (embed.timedOut || !embed.value) {
      return { hits: [], timedOut: true, reason: 'embedding timed out' };
    }
    const hits = await retrieveWithTimeout(embed.value, opts);
    return { hits, timedOut: false, reason: null };
  }

  return {
    retrieve,
    retrieveWithTimeout,
    embedAndRetrieve,
    get activeCount() {
      return semaphore.activeCount;
    },
  };
}