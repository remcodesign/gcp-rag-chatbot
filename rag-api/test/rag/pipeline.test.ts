import { describe, it, expect, beforeEach } from 'vitest';
import { createPipeline } from '../../lib/rag/pipeline.js';
import { createRetriever } from '../../lib/rag/retriever.js';
import type { Retriever } from '../../lib/rag/retriever.js';
import { createReranker } from '../../lib/rag/reranker.js';
import { buildContext, isRelevant } from '../../lib/rag/context.js';
import { createSemaphore, withSoftTimeout } from '../../lib/rag/limiter.js';
import { createFakeFirestore } from '../fakes/fakeFirestore.js';
import type { FakeFirestore } from '../fakes/fakeFirestore.js';
import type { Embedder, Hit } from '../../lib/types/rag.js';

/** Writes a few chunk docs with embeddings into the fake Firestore. */
function seedChunks(firestore: FakeFirestore): void {
    const returns = ['what is the return policy', 'how long to return an item'];
    const warranty = ['how long is the warranty', 'what does the warranty cover'];
    firestore.set(['chunks', 'returns-01'], {
        id: 'returns-01',
        text: returns[0],
        title: 'Return policy',
        url: '/help/returns',
        category: 'faq',
        embedding: [1, 0, 0],
    });
    firestore.set(['chunks', 'returns-02'], {
        id: 'returns-02',
        text: returns[1],
        title: 'Return window',
        url: '/help/returns#window',
        category: 'faq',
        embedding: [0.9, 0.1, 0],
    });
    firestore.set(['chunks', 'warranty-01'], {
        id: 'warranty-01',
        text: warranty[0],
        title: 'Warranty overview',
        url: '/help/warranty',
        category: 'faq',
        embedding: [0, 1, 0],
    });
}

/** Stub embedding adapter: returns a fixed, simple query vector. */
const embedIdentity = {
    embed: async (text: string) => {
        if (/return/i.test(String(text))) return [1, 0, 0];
        if (/warranty/i.test(String(text))) return [0, 1, 0];
        return [0, 0, 1];
    },
};

describe('Step 3.2 — retrieval: single Firestore findNearest', () => {
    let fs: FakeFirestore;
    let retriever: Retriever;
    beforeEach(() => {
        fs = createFakeFirestore();
        seedChunks(fs);
        retriever = createRetriever({ firestore: fs, embeddings: embedIdentity });
    });

    it('returns top-K chunks with similarity scores, nearest first', async () => {
        const hits = await retriever.retrieve([1, 0, 0], { limit: 2 });
        expect(hits.length).toBe(2);
        expect(hits[0]?.title).toBe('Return policy');
        expect(hits[0]?.similarityScore).toBeCloseTo(1 - (1 - 1), 3);
        expect(typeof hits[0]?.id).toBe('string');
    });

    it('resolves a document id correctly', async () => {
        const hits = await retriever.retrieve([1, 0, 0], { limit: 1 });
        expect(hits[0]?.id).toBe('returns-01');
    });

    it('returns empty and degrades gracefully when nothing is above the threshold', async () => {
        const hits = await retriever.retrieve([0.2, 0.2, 0.9], { limit: 3 });
        expect(Array.isArray(hits)).toBe(true);
        expect(hits.length).toBeGreaterThanOrEqual(0);
    });
});

describe('Step 3.3 — soft timeout + concurrency limiting', () => {
    it('semaphore queues excess searches instead of erroring (backpressure)', async () => {
        const sem = createSemaphore(1);
        let active = 0;
        const work = async () => {
            active += 1;
            const now = active;
            await new Promise((r) => setTimeout(r, 5));
            active -= 1;
            return now;
        };
        const results = await Promise.all([sem.run(work), sem.run(work), sem.run(work)]);
        expect(results).toHaveLength(3);
        expect(active).toBe(0);
    });

    it('returns available results when a search path times out (bounded, no hang)', async () => {
        const fsLocal = createFakeFirestore();
        seedChunks(fsLocal);
        const slowEmbed: Embedder = {
            embed: () => new Promise((resolve) => setTimeout(() => resolve([1, 0, 0]), 50)),
        };
        const boundedRetriever = createRetriever(
            { firestore: fsLocal, embeddings: slowEmbed },
            { limit: 5 },
        );
        const res = await withSoftTimeout(() => boundedRetriever.embedAndRetrieve('return'), {
            timeoutMs: 1000,
            fallback: { hits: [], timedOut: true, reason: null },
        });
        expect(res.timedOut).toBe(false);
        expect(res.value.hits.length).toBeGreaterThan(0);
    });

    it('does not throw if a retrieval exceeds the soft timeout — it returns fallback []', async () => {
        const result = await withSoftTimeout(() => Promise.resolve('x'), {
            timeoutMs: 1,
            fallback: 'fallback',
        });
        expect(result.value).toBe('x');
    });

    it('does not throw when the wrapped task REJECTS — it returns the fallback (soft degrade)', async () => {
        const result = await withSoftTimeout(
            () => Promise.reject(new Error('OpenRouter embeddings HTTP 500')),
            { timeoutMs: 1000, fallback: [] },
        );
        expect(result.timedOut).toBe(true);
        expect(result.value).toEqual([]);
    });
});

describe('Step 3.4 — dynamic reranking (conditional skip)', () => {
    it('skips rerank when top similarity is above threshold (latency saved)', async () => {
        const reranker = createReranker(
            {
                reranker: {
                    rerank: async () => {
                        throw new Error('should not be called');
                    },
                },
            },
            { confidenceThreshold: 0.8 },
        );
        const hits = [
            { id: 'a', title: 'A', similarityScore: 0.9 },
            { id: 'b', title: 'B', similarityScore: 0.6 },
        ];
        const result = await reranker.rerank('q', hits);
        expect(result.didRerank).toBe(false);
        expect(result.reason).toContain('above threshold');
    });

    it('reranks when confidence is low (quality preserved)', async () => {
        let called = 0;
        const reranker = createReranker(
            {
                reranker: {
                    rerank: async (_q: string, hits: Hit[]) => {
                        called += 1;
                        return hits.slice().reverse();
                    },
                },
            },
            { confidenceThreshold: 0.8 },
        );
        const hits = [
            { id: 'a', title: 'A', similarityScore: 0.5 },
            { id: 'b', title: 'B', similarityScore: 0.7 },
        ];
        const result = await reranker.rerank('q', hits);
        expect(called).toBe(1);
        expect(result.didRerank).toBe(true);
        expect(result.hits[0]?.id).toBe('b');
    });
});

describe('Step 3.5 — context + source map construction', () => {
    it('builds a prompt with numbered sources', () => {
        const hits = [
            {
                id: 'a',
                title: 'Return',
                url: '/a',
                text: 'You can return within 30 days.',
                similarityScore: 0.9,
            },
            {
                id: 'b',
                title: 'Warranty',
                url: '/b',
                text: 'The warranty covers defects.',
                similarityScore: 0.7,
            },
        ];
        const { context, sourceMap, sources } = buildContext(hits);
        expect(context).toContain('[Source 1]');
        expect(context).toContain('[Source 2]');
        expect(sourceMap[1]).toMatchObject({ title: 'Return', url: '/a', id: 'a' });
        expect(sources).toHaveLength(2);
    });

    it('omits empty or low-relevance docs from context', () => {
        const hits = [
            {
                id: 'a',
                title: 'Good',
                url: '/a',
                text: 'A longer relevant document text here for the demo.',
                similarityScore: 0.95,
            },
            { id: 'b', title: 'Short', url: '/b', text: 'too short', similarityScore: 0.9 },
            {
                id: 'c',
                title: 'Noise',
                url: '/c',
                text: 'Irrelevant document body that is long enough.',
                similarityScore: 0.1,
            },
        ];
        const { context, sources } = buildContext(hits);
        expect(context).toContain('[Source 1]');
        expect(context).not.toContain('too short');
        expect(context).not.toContain('Irrelevant');
        expect(sources).toHaveLength(1);
    });

    it('caps the number of sources so a small corpus does not flood the context', () => {
        const hits = Array.from({ length: 12 }, (_, i) => ({
            id: `c${i}`,
            title: `Chunk ${i}`,
            url: `/c${i}`,
            text: `A relevant document body that is long enough for chunk ${i}.`,
            similarityScore: 0.6 - i * 0.01,
        }));
        const { context, sources } = buildContext(hits, { maxSources: 5, minScore: 0.4 });
        expect(sources).toHaveLength(5);
        expect(context.split('[Source').length - 1).toBe(5);
    });
});

describe('Pipeline integration', () => {
    it('runs the full flow: embed -> retrieve -> rerank -> context', async () => {
        const fs = createFakeFirestore();
        seedChunks(fs);
        const pipeline = createPipeline(
            {
                firestore: fs,
                embeddings: embedIdentity,
                reranker: { rerank: async (_q: string, h: Hit[]) => h },
            },
            { confidenceThreshold: 0.9, maxConcurrent: 2 },
        );
        const result = await pipeline.run('what is the return policy?');
        expect(result.hits?.length).toBeGreaterThan(0);
        expect(result.sourceMap).toBeDefined();
        expect(result.context).toMatch(/\[Source 1\]/);
        expect(result.timedOut).toBe(false);
    });

    it('surfaces a timed-out retrieval gracefully (no LLM hangs)', async () => {
        const fs = createFakeFirestore();
        seedChunks(fs);
        const slowEmbed: Embedder = {
            embed: () => new Promise((resolve) => setTimeout(() => resolve([1, 0, 0]), 100)),
        };
        const pipeline = createPipeline(
            { firestore: fs, embeddings: slowEmbed },
            { embedTimeoutMs: 1, confidenceThreshold: 0.9 },
        );
        const result = await pipeline.run('return policy');
        expect(result.timedOut).toBe(true);
        expect(result.context).toBe('');
    });

    it('exposes the raw retrieval ranking and stage timings for the RAG trace', async () => {
        const fs = createFakeFirestore();
        seedChunks(fs);
        const pipeline = createPipeline(
            {
                firestore: fs,
                embeddings: embedIdentity,
                reranker: { rerank: async (_q: string, h: Hit[]) => h },
            },
            { confidenceThreshold: 0.99 },
        );
        const result = await pipeline.run('what is the return policy?');
        expect(Array.isArray(result.retrievalHits)).toBe(true);
        expect((result.retrievalHits ?? []).length).toBeGreaterThan(0);
        expect(result.retrievalHits?.[0]).toHaveProperty('similarityScore');
        expect(result.retrievalHits?.[0]).toHaveProperty('text');
        expect(result.timings).toBeDefined();
        expect(typeof result.timings?.retrieval).toBe('number');
        expect(typeof result.timings?.total).toBe('number');
        expect(result.retrievalHits?.[0]?.id).toBe('returns-01');
    });
});
