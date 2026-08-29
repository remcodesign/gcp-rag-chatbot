import { describe, it, expect } from 'vitest';
import { SAMPLE_GROUPS } from '../lib/sampleQuestions';
import type { SampleGroup } from '../lib/sampleQuestions';

describe('sampleQuestions', () => {
    it('defines one group per corpus folder, every group with questions', () => {
        const folders = SAMPLE_GROUPS.map((g) => g.folder);
        expect(folders).toEqual(['products', 'faq', 'policies', 'loyalty', 'support']);
        expect(SAMPLE_GROUPS).toHaveLength(5);
        for (const g of SAMPLE_GROUPS) {
            // Structural goal: every corpus folder offers at least one quick-start.
            expect(g.questions.length).toBeGreaterThan(0);
        }
    });

    it('every question is a non-empty trimmed string', () => {
        const all = SAMPLE_GROUPS.flatMap((g: SampleGroup) => g.questions.map((q) => q.text));
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
