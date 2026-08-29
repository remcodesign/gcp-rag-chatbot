import { describe, it, expect } from 'vitest';
import { toChunkModal } from '../lib/chunkModal';
import type { Source } from '../types/sse';
import type { TraceHit } from '../types/trace';

describe('toChunkModal', () => {
    it('returns null for a falsy chunk', () => {
        expect(toChunkModal(null as unknown as Source)).toBeNull();
        expect(toChunkModal(undefined as unknown as Source)).toBeNull();
    });

    it('maps a Source chip into a modal payload', () => {
        const source: Source = {
            n: 1,
            title: 'Return policy',
            url: '/returns',
            id: 'chunk-1',
            text: 'You can return within 30 days.',
        };
        const modal = toChunkModal(source);
        expect(modal).toEqual({
            title: 'Return policy',
            url: '/returns',
            id: 'chunk-1',
            text: 'You can return within 30 days.',
            score: null,
        });
    });

    it('maps a TraceHit into a modal payload with its score', () => {
        const hit: TraceHit = {
            id: 'chunk-2',
            rank: 1,
            title: 'Warranty',
            url: '/warranty',
            category: 'faq',
            score: 0.87,
            textPreview: '...',
            text: 'Warranty covers defects.',
            chars: 24,
            keptInContext: true,
        };
        const modal = toChunkModal(hit);
        expect(modal).toEqual({
            title: 'Warranty',
            url: '/warranty',
            id: 'chunk-2',
            text: 'Warranty covers defects.',
            score: 0.87,
        });
    });

    it('falls back to empty strings when optional fields are missing', () => {
        const source: Source = { n: 2, title: 'Sizing', url: null, id: 'chunk-3' };
        const modal = toChunkModal(source);
        expect(modal?.title).toBe('Sizing');
        expect(modal?.url).toBe('#');
        expect(modal?.text).toBe('');
        expect(modal?.score).toBeNull();
    });
});
