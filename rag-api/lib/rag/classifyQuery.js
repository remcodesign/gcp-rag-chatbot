/**
 * Query classification — conditional rewrite.
 *
 * Domain 3, Step 3.1. The insight from the spec: *clear, self-contained*
 * queries should go straight to retrieval (no blocking rewrite call), while
 * *ambiguous / conversational* queries (pronoun references like "its") are
 * rewritten with prior-turn context. This keeps rewriting from being a
 * mandatory, latency-adding step.
 *
 * The classifier is a cheap, dependency-free heuristic: if the query contains a
 * resolvable pronoun ("it", "this", "that", "these", "those", "they", "them")
 * AND there is prior conversational context to anchor it to, we mark it as
 * needing a rewrite. Callers decide the rewrite strategy (LLM in later
 * domains); this module only decides *whether* to.
 */

const AMBIGUOUS_MARKERS = new Set([
  'it', 'this', 'that', 'these', 'those', 'they', 'them', 'its', 'their', 'theirs',
]);

/**
 * Tokenizes a query into significant lowercase words (drops short stopwords and
 * punctuation).
 */
function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Decides whether a query needs a context-aware rewrite.
 *
 * @param {string} query          the current user message.
 * @param {object} [options]
 * @param {Array<object>} [options.history]  prior messages (each with `role`
 *   and `content`) used as context. Default [].
 * @returns {{ rewrite: boolean, reason: string }}
 */
export function classifyQuery(query, { history = [] } = {}) {
  const hasChatHistory = Array.isArray(history) && history.length > 0;
  const queryTokens = tokens(query);
  const hasPronoun = queryTokens.some((w) => AMBIGUOUS_MARKERS.has(w))
    || AMBIGUOUS_MARKERS.has(String(query).trim().toLowerCase());

  if (hasPronoun && hasChatHistory) {
    return { rewrite: true, reason: 'ambiguous pronoun with prior context' };
  }
  if (hasPronoun && !hasChatHistory) {
    return { rewrite: false, reason: 'ambiguous pronoun but no prior context to anchor to' };
  }
  return { rewrite: false, reason: 'self-contained query; no rewrite needed' };
}