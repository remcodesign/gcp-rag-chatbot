#!/usr/bin/env node
// Domain 9 / Step 9.3 — startup/import smoke test.
//
// The cheapest guard for this codebase's single most expensive failure mode:
// a JSDoc that swallows an `export function` only surfaces at Cloud Run
// startup (health-check failure), NOT at build and NOT in vitest (which only
// transforms the imports used by the tests). Here we import every entrypoint
// into a real ESM module graph. If any module can't resolve or an export is
// missing, Node dies with a non-zero exit code and the build aborts BEFORE an
// image is pushed.
//
// src/server.js boots `createRuntime()` at import/start time; we deliberately
// import only to resolve the module graph, so keep the server un-started here.

await import('../lib/cors.js');
await import('../lib/health.js');
await import('../lib/state/index.js');
await import('../lib/state/errors.js');
await import('../lib/state/sessionStore.js');
await import('../lib/rag/index.js');
await import('../lib/rag/classifyQuery.js');
await import('../lib/rag/context.js');
await import('../lib/rag/limiter.js');
await import('../lib/rag/openRouterEmbedder.js');
await import('../lib/rag/pipeline.js');
await import('../lib/rag/reranker.js');
await import('../lib/rag/retriever.js');
await import('../lib/generate/index.js');
await import('../lib/generate/chatBridge.js');
await import('../lib/generate/citations.js');
await import('../lib/generate/generator.js');
await import('../lib/generate/readDelta.js');
await import('../lib/generate/sse.js');
await import('../lib/generate/trace.js');
await import('../src/server.js');

console.log('smoke ok: rag-api entrypoints import cleanly');