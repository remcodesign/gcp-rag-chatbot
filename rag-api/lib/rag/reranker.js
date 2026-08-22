/**
 * Dynamic reranking — conditional skip.
 *
 * Domain 3, Step 3.4. The spec: the top similarity Firestore returns is used to
 * decide whether to run an (expensive) rerank. Above a calibrated threshold we
 * skip it entirely (latency saved); below the threshold we run a cheap
 * OpenRouter rerank to preserve quality. The threshold is deliberately
 * configurable — it must be calibrated on your own labeled set, not a universal
 * value.
 */

import { withSoftTimeout } from './limiter.js';

/**
 * Builds the reranker.
 *
 * @param {object} deps
 * @param {object} deps.reranker   Adapter with `rerank(query, hits)` -> re-ranked
 *   hit list. Optional — if omitted, rerank is a no-op pass-through.
 * @param {object} [options]
 * @param {number} [options.confidenceThreshold=0.75]  top similarity above which
 *   we skip rerank.
 * @param {number} [options.rerankTimeoutMs=1500]      soft timeout on rerank.
 * @returns {{ rerank: (query, hits) => Promise<{ hits, didRerank: boolean, reason: string }> }}
 */
export function createReranker(deps, options = {}) {
  const rerankFn = deps.reranker?.rerank ?? (async (_q, hits) => hits);
  const threshold = options.confidenceThreshold ?? 0.75;
  const timeoutMs = options.rerankTimeoutMs ?? 1500;

  async function rerank(query, hits) {
    if (!Array.isArray(hits) || hits.length === 0) {
      return { hits: [], didRerank: false, reason: 'no hits to rerank' };
    }
    const top = hits[0];
    const score = top.similarityScore ?? 1 - (top.distance ?? 0);

    if (score >= threshold) {
      return { hits, didRerank: false, reason: 'top score above threshold; skipping rerank' };
    }

    // Low confidence: run the (already-bounded) reranker; on timeout keep the
    // original order rather than erroring.
    const result = await withSoftTimeout(() => rerankFn(query, hits), {
      timeoutMs,
      fallback: hits,
    });
    return {
      hits: result.value,
      didRerank: !result.timedOut,
      reason: result.timedOut ? 'rerank timed out; kept original order' : 'low confidence, ran rerank',
    };
  }

  return { rerank };
}