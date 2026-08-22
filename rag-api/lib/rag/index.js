/**
 * Domain 3 — RAG Pipeline (retrieval + rerank, Firestore-backed).
 *
 * Public entry point for the RAG module. Exposes the pipeline factory and the
 * individual building blocks so later domains can reuse pieces directly.
 */

export { createPipeline } from './pipeline.js';
export { createRetriever } from './retriever.js';
export { createReranker } from './reranker.js';
export { buildContext, isRelevant } from './context.js';
export { classifyQuery } from './classifyQuery.js';
export { createSemaphore, withSoftTimeout } from './limiter.js';