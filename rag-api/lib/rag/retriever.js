/**
 * Retrieval — single Firestore `findNearest` call, with soft timeout + concurrency
 * limiting.
 *
 * Domain 3, Steps 3.2 & 3.3. The pipeline owns retrieval only; it does not do
 * embeddings itself (the embedding provider is injected, so tests and later
 * domains control it).
 */

import { withSoftTimeout, createSemaphore } from './limiter.js';

/**
 * Builds the retriever bound to a Firestore-shaped backend and an embeddings
 * adapter.
 *
 * @param {object} deps
 * @param {object} deps.firestore    Firestore instance (real or fake).
 * @param {object} deps.embeddings   Adapter with `embed(query)` -> number[].
 * @param {object} [options]
 * @param {number} [options.limit=20]        default top-K.
 * @param {number} [options.maxConcurrent=4] pipeline-wide downstream cap.
 * @param {number} [options.retrieveTimeoutMs=2000]  soft timeout per retrieval.
 * @returns {{ retrieve, retrieveWithTimeout, embedAndRetrieve }}
 */
export function createRetriever(deps, options = {}) {
  const { firestore, embeddings } = deps;
  const limit = options.limit ?? 20;
  const semaphore = createSemaphore(options.maxConcurrent ?? 4);
  const retrieveTimeoutMs = options.retrieveTimeoutMs ?? 2000;

  /**
   * Runs the Firestore `findNearest` query and maps docs into plain objects,
   * including the computed similarity and the document id.
   */
  async function retrieve(queryVector, { limit: k = limit, distanceThreshold } = {}) {
    const col = firestore.collection('chunks');
    const q = col.findNearest({
      vectorField: 'embedding',
      queryVector,
      limit: k,
      distanceMeasure: 'COSINE',
      distanceResultField: 'similarity',
      ...(distanceThreshold !== undefined ? { distanceThreshold } : {}),
    });
    const snap = await q.get();
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        ...data,
        id: d.id,
        // In the real client distanceResultField is a *distance*; the spec calls
        // it `similarity`. We surface both: raw distance + a similarity score.
        ...(data.similarity !== undefined
          ? { distance: data.similarity, similarityScore: 1 - data.similarity }
          : {}),
      };
    });
  }

  /**
   * Retrieval guarded by the semaphore (capping concurrent Firestore calls) and
   * wrapped in a soft timeout so a slow query returns what it has, never hangs.
   */
  async function retrieveWithTimeout(queryVector, opts = {}) {
    const result = await withSoftTimeout(
      () => semaphore.run(() => retrieve(queryVector, opts)),
      { timeoutMs: opts.timeoutMs ?? retrieveTimeoutMs, fallback: [] },
    );
    // On timeout we return the fallback ([]); otherwise the resolved hits.
    return result.value;
  }

  /**
   * Embeds a query then retrieves — the common "search" path. The embed is also
   * kept bounded; a timeout here returns [] so the pipeline degrades.
   */
  async function embedAndRetrieve(queryText, opts = {}) {
    const embed = await withSoftTimeout(
      () => embeddings.embed(String(queryText || '')),
      { timeoutMs: opts.embedTimeoutMs ?? 1500, fallback: null },
    );
    if (embed.timedOut || !embed.value) return { hits: [], timedOut: true, reason: 'embedding timed out' };
    const hits = await retrieveWithTimeout(embed.value, opts);
    return { hits, timedOut: false, reason: null };
  }

  return { retrieve, retrieveWithTimeout, embedAndRetrieve, get activeCount() { return semaphore.activeCount; } };
}