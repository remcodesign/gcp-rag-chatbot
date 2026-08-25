import { describe, it, expect } from 'vitest';
import { SAMPLE_GROUPS } from '../src/lib/sampleQuestions';
import type { SampleGroup } from '../src/lib/sampleQuestions';

describe('sampleQuestions', () => {
  it('defines one group per corpus folder (5 groups, 5 questions each)', () => {
    const folders = SAMPLE_GROUPS.map((g) => g.folder);
    expect(folders).toEqual(['products', 'faq', 'policies', 'loyalty', 'support']);
    expect(SAMPLE_GROUPS).toHaveLength(5);
    for (const g of SAMPLE_GROUPS) {
      expect(g.questions).toHaveLength(5);
    }
  });

  it('every question is a non-empty trimmed string', () => {
    const all = SAMPLE_GROUPS.flatMap((g: SampleGroup) => g.questions.map((q) => q.text));
    expect(all.length).toBe(25);
    for (const q of all) {
      expect(typeof q).toBe('string');
      expect(q.trim().length).toBeGreaterThan(3);
    }
  });

  it('groups carry a human label', () => {
    for (const g of SAMPLE_GROUPS) {
      expect(g.label.trim().length).toBeGreaterThan(0);
    }
  });
});