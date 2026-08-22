/**
 * RAG pipeline entry — orchestrates the Domain 3 steps.
 *
 * Domain 3. Wires together:
 *   3.1 query classification (conditional rewrite signal)
 *   3.2 findNearest retrieval
 *   3.3 soft timeout + concurrency limiting
 *   3.4 dynamic rerank (conditional skip)
 *   3.5 context + source map construction
 *
 * It is dependency-injected so later domains (streaming backend, OpenRouter
 * adapters) can wire real providers without changing the pipeline logic.
 */

import { createRetriever } from './retriever.js';
import { createReranker } from './reranker.js';
import { buildContext } from './context.js';
import { classifyQuery } from './classifyQuery.js';

/**
 * Creates the RAG pipeline.
 *
 * @param {object} deps
 * @param {object} deps.firestore    Firestore instance.
 * @param {object} deps.embeddings   Adapter: `embed(text) -> number[]`.
 * @param {object} [deps.reranker]   Adapter: `rerank(query, hits) -> hits`.
 * @param {object} [options]         See retriever/reranker/context options.
 * @returns {{ buildContextResult, run, classifyQuery }}
 */
export function createPipeline(deps, options = {}) {
  const retriever = createRetriever(deps, options);
  const reranker = createReranker({ reranker: deps.reranker }, options);

  /**
   * Full query -> context flow.
   *
   * @param {string} query
   * @param {object} [opts]
   * @param {Array<object>} [opts.history]   prior messages for the classifier.
   * @param {string}  [opts.rewrittenQuery]  if the caller already rewrote an
   *   ambiguous query, pass the rewritten text; the classifier result is then
   *   informational only.
   * @returns {Promise<object>} `{ query, hits, retrievalHits, sourceMap, context,
   *   sources, classification, rerankInfo, timings, timedOut }`
   *
   * `retrievalHits` is the raw `findNearest` ranking (each hit carries the
   * Firestore `similarityScore` + `id`/`title`/`url`/`text`) and `hits` is the
   * post-rerank list — the RAG-trace feature surfaces both so the client can
   * show what was found vs. what the LLM saw in its context window.
   */
  async function run(query, { history = [], rewrittenQuery } = {}) {
    const t0 = Date.now();
    const classification = classifyQuery(query, { history });

    const effectiveQuery = rewrittenQuery ?? query;
    const embedResult = await retriever.embedAndRetrieve(effectiveQuery, {
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
        classification,
        rerankInfo: null,
        timings: { embed: t1 - t0, retrieval: 0, rerank: 0, total: t1 - t0 },
        timedOut: true,
        rewriteRequested: classification.rewrite,
      };
    }

    const retrievalHits = embedResult.hits;
    const rerankOutcome = await reranker.rerank(effectiveQuery, retrievalHits);
    const t2 = Date.now();
    const context = buildContext(rerankOutcome.hits);
    const t3 = Date.now();

    return {
      query,
      hits: rerankOutcome.hits,
      retrievalHits,
      sourceMap: context.sourceMap,
      context: context.context,
      sources: context.sources,
      classification,
      rerankInfo: { didRerank: rerankOutcome.didRerank, reason: rerankOutcome.reason },
      timings: {
        embed: t1 - t0,
        retrieval: t2 - t1,
        rerank: t3 - t2,
        total: t3 - t0,
      },
      timedOut: false,
      rewriteRequested: classification.rewrite,
    };
  }

  return { run, classifyQuery };
}