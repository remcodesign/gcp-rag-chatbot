/**
 * Context + source map construction.
 *
 * Domain 3, Step 3.5. Assembles the numbered prompt context and a
 * `sourceId -> { title, url }` mapping used by the generator for citations.
 * Drops empty / low-relevance docs so the LLM sees clean context.
 */

/**
 * A minimum relevance rule: docs with no useful text, or far below the top hit,
 * are noise. Exact formula is a knob for calibration.
 */
export function isRelevant(hit, { minScore = 0.3 } = {}) {
  const score = hit.similarityScore ?? 1 - (hit.distance ?? 0);
  if (typeof hit.text !== 'string' || hit.text.trim().length < 20) return false;
  return score >= minScore;
}

/**
 * Builds the prompt context lines and a source map for citations.
 *
 * @param {Array<object>} hits  retrieved + reranked docs, each with `id`,
 *   `text`, `title`, `url` and a similarity score.
 * @param {object} [options]
 * @param {number} [options.minScore=0.3]  relevance floor for including a doc.
 * @returns {{ sourceMap: Record<string, {title:string,url:string}>, context: string, sources: Array<object> }}
 */
export function buildContext(hits, { minScore = 0.3 } = {}) {
  const kept = (Array.isArray(hits) ? hits : []).filter((h) => isRelevant(h, { minScore }));

  const sourceMap = {};
  const sources = [];
  const lines = [];

  kept.forEach((hit, idx) => {
    const n = idx + 1;
    const title = hit.title || 'Untitled source';
    const url = hit.url || '';
    sourceMap[n] = { title, url, id: hit.id };
    sources.push({ number: n, title, url, id: hit.id });
    lines.push(`[Source ${n}] ${String(hit.text).trim()}`);
  });

  return {
    sourceMap, // number -> metadata (the citation map the generator validates against)
    context: lines.join('\n\n'),
    sources,
  };
}