/**
 * Citation rendering helpers — Domain 6, Step 6.4.
 *
 * The backend validates inline `[Source N]` citations against the source map
 * (Domain 5) and delivers a running `citations` list on each token event plus a
 * final `sources` list on `done`. This module converts those into clickable
 * chips/footnotes and renders the answer text with the inline markers intact.
 */

import { renderMarkdown } from './markdown';
import type { MarkdownDeps } from '../types/markdown';
import type { Source } from '../types/sse';

/**
 * Renders markdown answer text as sanitized HTML with inline `[Source N]`
 * markers wrapped in a `<span class="citation">` for styling.
 *
 * @param text validated markdown answer text (may contain `[Source N]`).
 * @param deps optional `{ parse, sanitize }` overrides (see markdown.ts).
 * @returns sanitized HTML with citation spans.
 */
export function renderAnswer(text = '', deps?: MarkdownDeps): string {
    const html =
        deps && (deps.parse || deps.sanitize) ? renderMarkdown(text, deps) : renderMarkdown(text);
    return html.replace(/\[Source (\d+)\]/g, '<span class="citation">[Source $1]</span>');
}

/**
 * Builds the clickable source list (chips/footnotes) from the final `sources`
 * array delivered on the `done` event.
 *
 * @param sources the final source list.
 * @returns sources with a usable `url` (falls back to `#` when missing so the
 *   chip never breaks) and a `text` (empty string when absent) for the chunk modal.
 */
export function buildSourceChips(sources: Source[] = []): Source[] {
    return sources
        .filter((s) => s && s.title)
        .map((s) => ({ ...s, url: s.url || '#', text: s.text || '' }));
}
