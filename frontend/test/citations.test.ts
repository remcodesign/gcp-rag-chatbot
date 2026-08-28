import { describe, it, expect } from 'vitest';
import { renderAnswer, buildSourceChips } from '../src/lib/citations';
import type { Sanitizer } from '../src/types/markdown';

const keepHtml: { sanitize: Sanitizer } = { sanitize: (html) => html };

describe('renderAnswer', () => {
    it('wraps inline [Source N] markers in citation spans', () => {
        const html = renderAnswer('You can return it within 30 days. [Source 1]', keepHtml);
        expect(html).toContain('<span class="citation">[Source 1]</span>');
    });

    it('renders markdown into HTML (headings, bold)', () => {
        const html = renderAnswer('### Returns\n\nYou can **return** within 30 days.', keepHtml);
        expect(html).toContain('<h3');
        expect(html).toContain('<strong>return</strong>');
        expect(html).toContain('You can <strong>return</strong> within 30 days.');
    });

    it('escapes untrusted markup in a no-DOM env (safe fallback)', () => {
        const html = renderAnswer('<script>alert(1)</script> & [Source 2]');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&amp;');
    });

    it('renders a list when the answer contains one', () => {
        const html = renderAnswer('Steps:\n\n- one\n- two\n', keepHtml);
        expect(html).toContain('<ul>');
        expect(html).toContain('<li>one</li>');
    });

    it('keeps plain text readable', () => {
        const html = renderAnswer('plain answer', keepHtml);
        expect(html).toContain('plain answer');
    });
});

describe('buildSourceChips', () => {
    it('builds clickable chips from the final sources list', () => {
        const chips = buildSourceChips([
            { n: 1, title: 'Return policy', url: '/help/returns', id: 'returns-01' },
            { n: 2, title: 'Warranty', url: '/help/warranty', id: 'warranty-01' },
        ]);
        expect(chips).toHaveLength(2);
        expect(chips[0].url).toBe('/help/returns');
    });

    it('falls back to # when a source has no url so the chip never breaks', () => {
        const chips = buildSourceChips([{ n: 1, title: 'No link', url: null, id: 'x' }]);
        expect(chips[0].url).toBe('#');
    });

    it('drops sources with no title (graceful hide)', () => {
        const chips = buildSourceChips([{ n: 1, title: '', url: '/x', id: 'x' }]);
        expect(chips).toHaveLength(0);
    });
});
