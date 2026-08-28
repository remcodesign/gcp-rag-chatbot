/**
 * RAG pipeline entry — orchestrates Domain 3.
 */

import { createRetriever } from './retriever.js';
import { createReranker } from './reranker.js';
import { buildContext } from './context.js';
import type { RetrieverDeps } from './retriever.js';
import type { Pipeline, RunOutcome, Hit } from '../types/rag.js';
import type { ChatMessage } from '../types/chat.js';

export interface PipelineDeps {
    firestore: RetrieverDeps['firestore'];
    embeddings: RetrieverDeps['embeddings'];
    /** Optional external reranker (LLM/cohere-style) injected by callers. */
    reranker?: { rerank: (query: string, hits: Hit[]) => Promise<Hit[]> };
}

export interface PipelineOptions {
    /** Max chunks per retrieval (default 20). */
    limit?: number;
    maxConcurrent?: number;
    embedTimeoutMs?: number;
    retrieveTimeoutMs?: number;
    rerankTimeoutMs?: number;
    minScore?: number;
    maxSources?: number;
    confidenceThreshold?: number;
}

export interface PipelineRunInput {
    history?: ChatMessage[];
}

export function createPipeline(deps: PipelineDeps, options: PipelineOptions = {}): Pipeline {
    const retriever = createRetriever(deps, options);
    const reranker = createReranker({ reranker: deps.reranker }, options);

    async function run(query: string, _options: PipelineRunInput = {}): Promise<RunOutcome> {
        const t0 = Date.now();
        const embedResult = await retriever.embedAndRetrieve(query, {
            embedTimeoutMs: options.embedTimeoutMs,
        });
        const t1 = Date.now();
        if (embedResult.timedOut) {
            return {
                query,
                hits: [],
                retrievalHits: [],
                sourceMap: {},
                context: '',
                sources: [],
                rerankInfo: null,
                timings: { embed: t1 - t0, retrieval: 0, rerank: 0, total: t1 - t0 },
                timedOut: true,
            };
        }

        const retrievalHits = embedResult.hits;
        const rerankOutcome = await reranker.rerank(query, retrievalHits);
        const t2 = Date.now();
        const context = buildContext(rerankOutcome.hits, {
            minScore: options.minScore,
            maxSources: options.maxSources,
        });
        const t3 = Date.now();

        return {
            query,
            hits: rerankOutcome.hits,
            retrievalHits,
            sourceMap: context.sourceMap,
            context: context.context,
            sources: context.sources,
            rerankInfo: { didRerank: rerankOutcome.didRerank, reason: rerankOutcome.reason },
            timings: { embed: t1 - t0, retrieval: t2 - t1, rerank: t3 - t2, total: t3 - t0 },
            timedOut: false,
        };
    }

    return { run };
}