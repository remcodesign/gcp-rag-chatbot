import { describe, it, expect } from 'vitest';
import { buildTrace, serializeHit, preview } from '../../lib/generate/trace.js';
import type { RunOutcome } from '../../lib/types/rag.js';

const OUTCOME: RunOutcome = {
    query: 'What is the return policy?',
    classification: { rewrite: false, reason: 'self-contained query; no rewrite needed' },
    retrievalHits: [
        {
            id: 'returns-01',
            title: 'Return policy',
            url: '/help/returns',
            category: 'faq',
            text: 'You can return most items within 30 days of delivery. Items must be unused and in original packaging.',
            similarityScore: 0.92,
        },
        {
            id: 'warranty-01',
            title: 'Warranty overview',
            url: '/help/warranty',
            category: 'faq',
            text: 'The warranty covers manufacturing defects for a period of one year.',
            similarityScore: 0.51,
        },
        {
            id: 'noise-01',
            title: 'Stock levels',
            url: '/help/stock',
            category: 'support',
            text: 'Warehouse stock is refreshed on a weekly cycle across all regions.',
            similarityScore: 0.3,
        },
    ],
    sourceMap: {
        1: { title: 'Return policy', url: '/help/returns', id: 'returns-01' },
        2: { title: 'Warranty overview', url: '/help/warranty', id: 'warranty-01' },
    },
    context: '[Source 1] We have a return policy...',
    rerankInfo: { didRerank: true, reason: 'low confidence, ran rerank' },
    timings: { embed: 120, retrieval: 80, rerank: 40, total: 240 },
    timedOut: false,
};

describe('trace — preview bounds text', () => {
    it('truncates long text with an ellipsis and keeps short text intact', () => {
        const short = preview('short');
        expect(short).toBe('short');
        const long = preview('x'.repeat(400));
        expect(long.length).toBeLessThanOrEqual(181);
        expect(long.endsWith('…')).toBe(true);
    });
});

describe('trace — serializeHit', () => {
    it('maps score/id/title/url and marks kept-in-context', () => {
        const h = serializeHit(
            { id: 'a', title: 'T', url: '/t', text: 'Some document text of sufficient length', similarityScore: 0.9 },
            { rank: 1, keptInContext: true },
        );
        expect(h.id).toBe('a');
        expect(h.score).toBeCloseTo(0.9, 4);
        expect(h.keptInContext).toBe(true);
        expect(h.rank).toBe(1);
    });

    it('computes score from distance when similarityScore is absent', () => {
        const h = serializeHit({ id: 'b', distance: 0.3, text: 'x'.repeat(40) });
        expect(h.score).toBeCloseTo(0.7, 4);
    });

    it('never ships the raw embedding vector', () => {
        const h = serializeHit({ id: 'c', embedding: [0.1, 0.2, 0.3], text: 'text' });
        expect(h).not.toHaveProperty('embedding');
    });
});

describe('trace — buildTrace', () => {
    it('builds a client-safe payload with retrieval, rerank, context and final prompt', () => {
        const trace = buildTrace(OUTCOME, {
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'Context:\n[Source 1] ...' },
                { role: 'user', content: 'What is the return policy?' },
            ],
        });
        expect(trace.retrieved).toHaveLength(3);
        expect(trace.retrieved[0]?.keptInContext).toBe(true);
        expect(trace.retrieved[2]?.keptInContext).toBe(false);
        expect(trace.rerank.didRerank).toBe(true);
        expect(trace.context).toBeDefined();
        expect(trace.timings).toMatchObject({ embed: 120, retrieval: 80 });
        expect(trace.finalPrompt).toBeDefined();
        expect(trace.finalPrompt?.join('')).toContain('system prompt');
        expect(trace.finalPrompt?.join('')).toContain('What is the return policy?');
    });

    it('omits finalPrompt when messages are not supplied', () => {
        const trace = buildTrace(OUTCOME, {});
        expect(trace.finalPrompt).toBeUndefined();
        expect(trace.query).toContain('return policy');
    });

    it('degrades with empty outcome (no crash)', () => {
        const trace = buildTrace({}, {});
        expect(trace.retrieved).toEqual([]);
        expect(trace.rerank.didRerank).toBe(false);
        expect(trace.context.sources).toEqual([]);
        expect(trace.timedOut).toBe(false);
    });

    it('surfaces a retrieval failure reason without leaking internals', () => {
        const trace = buildTrace(
            { query: 'q', error: { message: 'SomeOpenRouterEmbeddingError: fail' } },
            {},
        );
        expect(trace.error).toBeDefined();
        expect(trace.error?.message).toContain('fail');
        expect(trace.retrieved).toEqual([]);
        expect(trace.timedOut).toBe(true);
    });
});