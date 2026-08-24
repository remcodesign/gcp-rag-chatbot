/**
 * Domain 3 — RAG Pipeline (retrieval + rerank, Firestore-backed).
 *
 * Public entry point for the RAG module. Exposes the pipeline factory and the
 * individual building blocks so later domains can reuse pieces directly.
 */

export { createPipeline } from './pipeline.js';
export type { PipelineDeps, PipelineOptions } from './pipeline.js';
export { createRetriever } from './retriever.js';
export type { Retriever, RetrieverDeps, RetrieverOptions } from './retriever.js';
export { createReranker } from './reranker.js';
export type { Reranker } from './reranker.js';
export { buildContext, isRelevant } from './context.js';
export { classifyQuery } from './classifyQuery.js';
export { createSemaphore, withSoftTimeout } from './limiter.js';
export type { Semaphore, SoftTimeoutResult } from './limiter.js';
export { createOpenRouterEmbedder, EMBED_MODEL, EMBED_DIMS } from './openRouterEmbedder.js';
export type { OpenRouterEmbedder } from './openRouterEmbedder.js';