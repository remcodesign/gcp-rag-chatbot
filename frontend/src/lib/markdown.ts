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

import type { MarkdownDeps, Sanitizer } from '../types/markdown';

/** DOMPurify options: keep `target` so link chips can open in a new tab. */
const SANITIZE_OPTS = { ADD_ATTR: ['target'] };

/**
 * Resolves DOMPurify's `sanitize` function.
 *
 * dompurify v3 exports a *factory* as the default: `dompurify(root?) -> { sanitize }`
 * where `root` is a `WindowLike`. In a real browser the global `window` is used;
 * in a node test env there is no window, so we fall back to the HTML-escaping
 * path (safe default). We detect the factory by calling it only when a window is
 * present. No `any`: the input is `unknown`, narrowed by runtime checks.
 */
function resolveSanitize(): Sanitizer | null {
	const factory = DOMPurify as unknown as ((root?: unknown) => { sanitize: (html: string, opts?: object) => string }) | undefined;
	if (typeof factory !== 'function') return null;

	const context: unknown = typeof window !== 'undefined' ? window : null;
	if (!context) return null;

	try {
		const inst = factory(context);
		if (inst && typeof inst.sanitize === 'function') {
			const fn = inst.sanitize;
			return (html: string): string => fn(html, SANITIZE_OPTS);
		}
	} catch {
		/* fall through to escape fallback */
	}
	return null;
}

/**
 * HTML-escaping fallback used only when DOMPurify truly cannot be resolved
 * (e.g. a bare node test env with no window). Guarantees untrusted markup never
 * reaches the DOM; the browser always uses the real DOMPurify.
 */
function escapeFallback(html: string): string {
	return String(html)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Converts a markdown string into sanitized HTML.
 *
 * @param text raw markdown answer text.
 * @param deps injected `{ parse, sanitize }` overrides (default to marked + DOMPurify).
 * @returns sanitized HTML.
 */
export function renderMarkdown(text = '', deps: MarkdownDeps = {}): string {
	const parse = deps.parse ?? ((md: string): string => String(marked.parse(String(md ?? ''), { gfm: true, breaks: true })));
	const sanitize = deps.sanitize ?? resolveSanitize() ?? escapeFallback;
	const html = parse(String(text ?? ''));
	return sanitize(html);
}