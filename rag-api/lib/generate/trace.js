/**
 * RAG trace serialization — POC supportability aid (not a locked spec domain).
 *
 * The demo frontend exposes a closable "inner workings" sidebar that shows, for
 * each turn, what the RAG pipeline actually did: the raw retrieval ranking, the
 * post-rerank context, and the LLM "final prompt". This module builds the
 * *appraised*, client-safe version of that data — keeping text previews bounded,
 * dropping embedding vectors (never shipped to the browser), and annotating the
 * retrieved chunks that survived reranking into the context window.
 *
 * Nothing here is a secret: the previews are a small prefix of corpus text and
 * the URLs are public help pages. But a POC should still keep payloads small.
 */

const PREVIEW_CHARS = 180;
const QUERY_PREVIEW_CHARS = 120;

/** Shortens `text` to ~`PREVIEW_CHARS` with an ellipsis when truncated. */
export function preview(text, maxChars = PREVIEW_CHARS) {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars).trimEnd()}…`;
}

/**
 * Serializes a single retrieved chunk for the trace sidebar.
 *
 * @param {object} hit  a retrieval hit (`id`, `title`, `url`, `text`,
 *   `similarityScore`, optionally `distance`).
 * @param {object} [options]
 * @param {number} [options.rank=0] the numbering (`1`-based) this hit received in
 *   the LLM context window, or `0` for segments dropped by rerank/relevance.
 * @param {boolean} [options.keptInContext] whether this hit survived into the LLM context.
 * @returns {{ id?: string, rank: number, title: string, url: string, category?: string|null, score: number|null, textPreview: string, text: string, chars: number, keptInContext: boolean }}
 */
export function serializeHit(hit = {}, { rank = 0, keptInContext = false } = {}) {
  const score =
    typeof hit.similarityScore === 'number'
      ? hit.similarityScore
      : typeof hit.distance === 'number'
        ? 1 - hit.distance
        : null;

  return {
    id: hit.id,
    rank,
    title: hit.title || 'Untitled source',
    url: hit.url || '#',
    category: hit.category || null,
    score: score == null ? null : Number(score.toFixed(4)),
    textPreview: preview(hit.text),
    text: typeof hit.text === 'string' ? hit.text : '', // full chunk text (for the chunk modal)
    chars: typeof hit.text === 'string' ? hit.text.length : 0,
    keptInContext,
  };
}

/**
 * Builds the full RAG trace payload for one turn.
 *
 * @param {object} [outcome={}]  the resolved `pipeline.run(...)` outcome (partial allowed).
 * @param {string} [outcome.query]  the user query.
 * @param {Array<object>} [outcome.retrievalHits]  array of retrieved hits.
 * @param {Record<number, object>} [outcome.sourceMap]  numbered source metadata.
 * @param {string} [outcome.context]  the assembled LLM context.
 * @param {boolean} [outcome.timedOut]  whether retrieval soft-timed-out.
 * @param {object} [outcome.rerankInfo]  `{ didRerank, reason }`.
 * @param {object} [outcome.classification]  classifier result.
 * @param {object} [outcome.timings]  per-stage timings in ms.
 * @param {object} [outcome.error]  retrieval error diagnosis `{ message }`.
 * @param {object} [options]
 * @param {object} [options.messages]  the chat messages sent to the LLM (used
 *   to render the final prompt). If omitted the `finalPrompt` field is omitted.
 * @returns {object} `{ query, classification, retrieved, rerank, context,
 *   timings, timedOut, finalPrompt? }`.
 */
export function buildTrace(outcome = {}, { messages } = {}) {
  const hits = Array.isArray(outcome.retrievalHits) ? outcome.retrievalHits : [];
  const sourceMap = outcome.sourceMap || {};

  // id set of the chunks that ended up in the LLM context window (used to tag
  // each retrieved chunk as "kept" vs "dropped" in the sidebar). `sourceMap` is
  // keyed by the numbered source key, so we read its values for ids.
  const entries = Object.entries(sourceMap); // [n, {title,url,id}]
  const inContextIds = new Set(entries.map(([, s]) => s && s.id).filter(Boolean));

  const retrieved = hits.map((h, idx) =>
    serializeHit(h, {
      rank: idx + 1,
      keptInContext: inContextIds.has(h.id),
    }),
  );

  const rerank = {
    didRerank: !!(outcome.rerankInfo && outcome.rerankInfo.didRerank),
    reason: (outcome.rerankInfo && outcome.rerankInfo.reason) || 'rerank skipped',
  };

  const context = {
    sources: entries.map(([n, s]) => ({ n: Number(n), id: s && s.id })),
    length: (outcome.context || '').length,
  };

  const payload = {
    query: preview(String(outcome.query ?? ''), QUERY_PREVIEW_CHARS),
    classification: outcome.classification || null,
    retrieved,
    rerank,
    context,
    timings: outcome.timings || null,
    timedOut: !!(outcome.timedOut || outcome.error),
  };

  // Surface a retrieval failure reason so the sidebar shows WHY no context was
  // found (diagnostic aid, does not leak the prompt or keys).
  if (outcome.error) {
    payload.error = { message: String(outcome.error.message || 'retrieval failed').slice(0, 300) };
  }

  if (messages) {
    payload.finalPrompt = messages
      .filter((m) => m && typeof m.content === 'string')
      .map((m, i) => `[${i + 1}] ${m.role}\n${m.content}`);
  }

  return payload;
}