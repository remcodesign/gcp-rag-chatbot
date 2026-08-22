/**
 * RAG trace rendering helpers — POC "inner workings" sidebar.
 *
 * The chatStore retains the backend `trace` payload (see
 * `rag-api/lib/generate/trace.js` for the source shape). This module turns it
 * into display-friendly data for the sidebar: a list of retrieved chunks each
 * tagged with its score and whether it survived into the LLM context window, the
 * rerank decision, the resulting context source order, timings, and the final
 * prompt. It is a pure function of the trace payload so it stays unit-testable.
 */

/** Parses the classification reason into a short human label. */
export function describeClassification(classification) {
  if (!classification) return 'self-contained (no rewrite)';
  if (classification.rewrite) {
    return `needs rewrite — ${classification.reason || 'ambiguous'}`;
  }
  return classification.reason || 'self-contained (no rewrite)';
}

/**
 * Shapes the backend `trace` payload for rendering.
 *
 * @param {object|null} trace  the raw `trace` SSE payload.
 * @returns {object|null} normalized `{ query, classification, retrieved, rerank, context, timings, timedOut, finalPrompt }`.
 */
export function normalizeTrace(trace) {
  if (!trace) return null;
  return {
    query: trace.query || '',
    classification: describeClassification(trace.classification),
    retrieved: Array.isArray(trace.retrieved) ? trace.retrieved : [],
    rerank: trace.rerank || { didRerank: false, reason: '' },
    context: trace.context || { sources: [], length: 0 },
    timings: trace.timings || null,
    timedOut: !!trace.timedOut,
    finalPrompt: Array.isArray(trace.finalPrompt) ? trace.finalPrompt.join('\n\n') : '',
  };
}

/** Rounds a Score or returns a placeholder when absent/NaN. */
export function formatScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
  return (score * 100).toFixed(0) + '%';
}