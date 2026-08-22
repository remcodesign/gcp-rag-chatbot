import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/lib/markdown.js';

// Mock the real DOMPurify + marked is not needed here — we test the seam:
// renderMarkdown must call parse (markdown->html) then sanitize (html->clean)
// in that order, using the injected fakes. The RESt (real marked + dompurify)
// is covered implicitly by citations.test (that exercise the defaults through
// the browser build). These unit tests keep node env deterministic.

describe('renderMarkdown — DI seam', () => {
  it('calls parse then sanitize, in order', () => {
    const calls = [];
    const parse = (md) => {
      calls.push('parse');
      return `<em>${md}</em>`;
    };
    const sanitize = (html) => {
      calls.push('sanitize');
      return `<safe>${html}</safe>`;
    };
    const out = renderMarkdown('**bold**', { parse, sanitize });
    expect(calls).toEqual(['parse', 'sanitize']);
    expect(out).toBe('<safe><em>**bold**</em></safe>');
  });

  it('coerces undefined input to empty string', () => {
    const parse = (md) => md;
    const sanitize = (html) => html;
    expect(renderMarkdown(undefined, { parse, sanitize })).toBe('');
    expect(renderMarkdown(null, { parse, sanitize })).toBe('');
  });
});

describe('renderMarkdown — browser-like DOM (real DOMPurify + marked)', () => {
  it('renders markdown and sanitizes untrusted markup in a real DOM', async () => {
    // jsdom provides a window so DOMPurify's factory can create a real instance,
    // mirroring the browser path (resolveSanitize picks up the window factory).
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const { default: DOMPurify } = await import('dompurify');
    const purify = DOMPurify(dom.window); // factory with a real window

    const html = renderMarkdown(
      '### Returns\n\nYou can **return** within 30 days.\n\n- one\n- two\n\n<script>alert(1)</script>',
      { sanitize: (h) => purify.sanitize(h) },
    );
    expect(html).toContain('<h3>Returns</h3>');
    expect(html).toContain('<strong>return</strong>');
    expect(html).toContain('<li>one</li>');
    expect(html).not.toContain('<script>');
    dom.window.close();
  });
});