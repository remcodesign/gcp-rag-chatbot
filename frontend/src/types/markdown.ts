/**
 * Markdown type-set — the marked + DOMPurify rendering seam (Domain 6, Step 6.4).
 * Both functions are injectable so node-env unit tests pass fakes; production
 * (App.vue) uses the real `marked` + `dompurify`.
 */

/** markdown -> HTML renderer. */
export type MarkdownParser = (md: string) => string;

/** HTML -> clean HTML sanitizer. */
export type Sanitizer = (html: string) => string;

/** Injectables for `renderMarkdown`. */
export interface MarkdownDeps {
    parse?: MarkdownParser;
    sanitize?: Sanitizer;
}