/**
 * Dynamic reranking — conditional skip.
 */

import { withSoftTimeout } from './limiter.js';
import type { Hit, RerankerFn, RerankResult } from '../types/rag.js';

interface RerankerDeps {
    reranker?: { rerank: RerankerFn };
}

interface RerankerOptions {
    /** Confidence threshold above which rerank is skipped (default 0.75). */
    confidenceThreshold?: number;
    /** Rerank soft timeout in ms (default 1500). */
    rerankTimeoutMs?: number;
}

export interface Reranker {
    rerank(query: string, hits: Hit[]): Promise<RerankResult>;
}

export function createReranker(
    deps: RerankerDeps,
    options: RerankerOptions = {},
): Reranker {
    const rerankFn: RerankerFn = deps.reranker?.rerank ?? (async (_q: string, hits: Hit[]) => hits);
    const threshold = options.confidenceThreshold ?? 0.75;
    const timeoutMs = options.rerankTimeoutMs ?? 1500;

    async function rerank(query: string, hits: Hit[]): Promise<RerankResult> {
        if (!Array.isArray(hits) || hits.length === 0) {
            return { hits: [], didRerank: false, reason: 'no hits to rerank' };
        }
        const top = hits[0] as Hit;
        const score = top.similarityScore ?? 1 - (top.distance ?? 0);

        if (score >= threshold) {
            return { hits, didRerank: false, reason: 'top score above threshold; skipping rerank' };
        }

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