import { describe, it, expect } from 'vitest';
import { renderAnswer, buildSourceChips } from '../src/lib/citations.js';

describe('renderAnswer', () => {
  it('wraps inline [Source N] markers in citation spans', () => {
    const html = renderAnswer('You can return it within 30 days. [Source 1]');
    expect(html).toContain('<span class="citation">[Source 1]</span>');
  });

  it('escapes HTML so untrusted text cannot inject markup', () => {
    const html = renderAnswer('<script>alert(1)</script> & [Source 2]');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('leaves text without citations unchanged (safe)', () => {
    expect(renderAnswer('plain answer')).toBe('plain answer');
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