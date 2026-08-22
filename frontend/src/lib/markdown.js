/**
 * Markdown rendering — converts the streamed answer (which arrives as Markdown)
 * into safe, rendered HTML for the chat UI.
 *
 * Uses two tiers, following the approved dependency choice:
 *   - `marked`      parses CommonMark/GFM (headings, bold, italic, lists, code,
 *                   links, etc.) into HTML.
 *   - `dompurify`   sanitizes that HTML so only safe tags survive (no raw
 *                   `<script>`, no `javascript:` hrefs, etc.).
 *
 * Both are injected so unit tests (node env, no DOM) can pass a fake `parse`
 * and a fake `sanitize` — the same DI pattern the rest of the project uses.
 * Production (`App.vue`) uses the real `marked` + `dompurify`.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** DOMPurify options: keep `target` so link chips can open in a new tab. */
const SANITIZE_OPTS = { ADD_ATTR: ['target'] };

/**
 * Resolves DOMPurify's `sanitize` function across module interop shapes:
 *   - `dompurify` exposed directly with `.sanitize` (browser build),
 *   - `.default.sanitize` (some ESM interop),
 *   - a factory function callable as `dompurify({ window }) -> { sanitize }`
 *     (node/universal builds).
 * Returns a `(html) => string` sanitizer, or null if none is resolvable.
 */
function resolveSanitize() {
  const purify = DOMPurify;
  // Shape 1: already an instance with `.sanitize`.
  if (purify && typeof purify.sanitize === 'function') {
    const fn = purify.sanitize.bind(purify);
    return (html) => fn(html, SANITIZE_OPTS);
  }
  // Shape 2: `.default` instance.
  const dflt = purify && purify.default;
  if (dflt && typeof dflt.sanitize === 'function') {
    const fn = dflt.sanitize.bind(dflt);
    return (html) => fn(html, SANITIZE_OPTS);
  }
  // Shape 3: factory `dompurify({ window })`. In a real browser the global
  // `window` is present, so create a fresh instance; otherwise escape.
  if (typeof purify === 'function') {
    const context = typeof window !== 'undefined' ? window : null;
    if (context) {
      try {
        const inst = purify({ window: context });
        if (inst && typeof inst.sanitize === 'function') {
          const fn = inst.sanitize.bind(inst);
          return (html) => fn(html, SANITIZE_OPTS);
        }
      } catch { /* fall through to escape fallback */ }
    }
  }
  return null;
}

/**
 * HTML-escaping fallback used only when DOMPurify truly cannot be resolved
 * (e.g. a bare node test env with no window). Guarantees untrusted markup never
 * reaches the DOM; the browser always uses the real DOMPurify.
 */
function escapeFallback(html) {
  return String(html)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Converts a markdown string into sanitized HTML.
 *
 * @param {string} text  raw markdown answer text.
 * @param {object} [deps]
 * @param {(md:string)=>string} [deps.parse]    markdown -> HTML (default `marked`).
 * @param {(html:string)=>string} [deps.sanitize]  HTML -> clean HTML (default dompurify).
 * @returns {string} sanitized HTML.
 */
export function renderMarkdown(text = '', deps = {}) {
  const parse = deps.parse ?? ((md) => marked.parse(String(md ?? ''), { gfm: true, breaks: true }));
  const sanitize = deps.sanitize ?? resolveSanitize() ?? escapeFallback;
  const html = parse(String(text ?? ''));
  return sanitize(html);
}