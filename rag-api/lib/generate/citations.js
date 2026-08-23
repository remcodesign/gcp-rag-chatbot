/**
 * Inline citation validation — Domain 5, Step 5.3.
 *
 * The model is prompted to emit `[Source N]` inline, but LLM-generated metadata
 * is **untrusted**. This module validates every citation against the source map
 * (built in Domain 3), normalizes case/whitespace, and strips any citation that
 * references a source that does not exist. This prevents hallucinated or
 * perverse citations (`[Source 9]`, `[source 3]`) from reaching the client.
 *
 * The same normalizer produces the canonical *source reference* the client uses
 * to render clickable chips against the `sourceMap` delivered with the stream.
 */

/** Matches `[Source N]` in any casing/spacing, capturing the number. */
const SOURCE_RE = /\[source\s*(\d+)\]/gi;

/**
 * Normalizes a `[Source N]` token, or returns `null` when it is not a valid
 * reference. Case-insensitive; strips extra surrounding whitespace.
 *
 * @param {string} tok  raw token, e.g. `[SOURCE 3]`.
 * @returns {{ n: number, token: string } | null}
 */
export function normalizeSourceToken(tok) {
  const m = new RegExp(SOURCE_RE.source, 'i').exec(String(tok ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  return { n, token: `[Source ${n}]` };
}

/**
 * Validates and rewrites inline `[Source N]` references against `sourceMap`.
 *
 * A source is *valid* when `sourceMap` contains a matching key (numbers are the
 * 1-based keys built by `buildContext`). Invalid references are removed from the
 * text. Valid ones are canonicalized to `[Source N]` so the client can match
 * them exactly.
 *
 * @param {string} text        model output that may contain inline citations.
 * @param {object} sourceMap   `{ 1: {title,url,id}, 2: {...} }` from buildContext.
 * @returns {{ text: string, citations: Array<{ n: number, title?: string }> }}
 */
export function validateCitations(text, sourceMap = {}) {
  const src = String(text ?? '');
  let out = src;
  const citations = [];
  const observed = new Set();

  const replacer = (match, numStr) => {
    const n = Number(numStr);
    if (sourceMap[n] != null) {
      if (!observed.has(n)) {
        observed.add(n);
        citations.push({ n, title: sourceMap[n].title });
      }
      return `[Source ${n}]`;
    }
    return ''; // hallucinated / out-of-range -> strip
  };

  out = out.replace(SOURCE_RE, replacer);

  // Clear any double spaces left by removed citations (cosmetic).
  return {
    text: out.replace(/\s{2,}/g, ' ').trim(),
    citations,
  };
}

/**
 * Builds an "appended sources" fallback block used when the model's inline
 * citations are unreliable: maps each numbered source to its title/url so the
 * client can still render references. `full` includes the url (SSE payload);
 * clients decide whether to show it.
 *
 * @param {object} sourceMap  `{ n: {title,url,id,text} }`.
 * @returns {Array<{ n: number, title: string, url: string, id: string, text?: string }>}
 */
export function listSources(sourceMap = {}) {
  return Object.entries(sourceMap)
    .map(([n, s]) => ({ n: Number(n), title: s && s.title, url: s && s.url, id: s && s.id, text: (s && s.text) ?? '' }))
    .filter((s) => s.title);
}