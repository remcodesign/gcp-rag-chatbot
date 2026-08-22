/**
 * Citation rendering helpers — Domain 6, Step 6.4.
 *
 * The backend validates inline `[Source N]` citations against the source map
 * (Domain 5) and delivers a running `citations` list on each token event plus a
 * final `sources` list on `done`. This module converts those into clickable
 * chips/footnotes and renders the answer text with the inline markers intact.
 *
 * `renderAnswer` is a pure function of the answer text + citation list, so it
 * is unit-testable without a DOM. The Vue component binds the returned HTML via
 * `v-html` (the text is backend-validated; citations are stripped of any
 * non-existent source, so no untrusted markup reaches the DOM).
 */

/**
 * Renders the answer text with inline `[Source N]` markers wrapped in a
 * `<span class="citation">` so CSS can style them as chips.
 *
 * @param {string} text  validated answer text (may contain `[Source N]`).
 * @returns {string} HTML-safe string with citation spans.
 */
export function renderAnswer(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[Source (\d+)\]/g, '<span class="citation">[Source $1]</span>');
}

/**
 * Builds the clickable source list (chips/footnotes) from the final `sources`
 * array delivered on the `done` event.
 *
 * @param {Array<{n:number,title:string,url:string,id:string}>} sources
 * @returns {Array<{n:number,title:string,url:string,id:string}>} sources with a
 *   usable `url` (falls back to `#` when missing so the chip never breaks).
 */
export function buildSourceChips(sources = []) {
  return sources
    .filter((s) => s && s.title)
    .map((s) => ({ ...s, url: s.url || '#' }));
}