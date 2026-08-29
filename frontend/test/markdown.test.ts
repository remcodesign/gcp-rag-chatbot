import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../lib/markdown';

describe('renderMarkdown — DI seam', () => {
    it('calls parse then sanitize, in order', () => {
        const calls: string[] = [];
        const parse = (md: string): string => {
            calls.push('parse');
            return `<em>${md}</em>`;
        };
        const sanitize = (html: string): string => {
            calls.push('sanitize');
            return `<safe>${html}</safe>`;
        };
        const out = renderMarkdown('**bold**', { parse, sanitize });
        expect(calls).toEqual(['parse', 'sanitize']);
        expect(out).toBe('<safe><em>**bold**</em></safe>');
    });

    it('coerces undefined input to empty string', () => {
        const parse = (md?: string): string => String(md ?? '');
        const sanitize = (html: string): string => html;
        expect(renderMarkdown(undefined as unknown as string, { parse, sanitize })).toBe('');
        expect(renderMarkdown(null as unknown as string, { parse, sanitize })).toBe('');
    });
});

describe('renderMarkdown — browser-like DOM (real DOMPurify + marked)', () => {
    it('renders markdown and sanitizes untrusted markup in a real DOM', async () => {
        const { JSDOM } = await import('jsdom');
        const dom = new JSDOM('<!doctype html><html><body></body></html>');
        const { default: DOMPurify } = await import('dompurify');
        // dompurify's v3 factory takes a `WindowLike` root directly (not `{window}`).
        const purify = DOMPurify(
            dom.window as unknown as NonNullable<Parameters<typeof DOMPurify>[0]>,
        );

        const html = renderMarkdown(
            '### Returns\n\nYou can **return** within 30 days.\n\n- one\n- two\n\n<script>alert(1)</script>',
            { sanitize: (h: string): string => purify.sanitize(h) },
        );
        expect(html).toContain('<h3>Returns</h3>');
        expect(html).toContain('<strong>return</strong>');
        expect(html).toContain('<li>one</li>');
        expect(html).not.toContain('<script>');
        dom.window.close();
    });
});
