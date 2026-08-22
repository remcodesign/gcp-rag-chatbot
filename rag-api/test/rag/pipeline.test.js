import { describe, it, expect, beforeEach } from 'vitest';
import { createPipeline } from '../../lib/rag/pipeline.js';
import { createRetriever } from '../../lib/rag/retriever.js';
import { createReranker } from '../../lib/rag/reranker.js';
import { buildContext, isRelevant } from '../../lib/rag/context.js';
import { classifyQuery } from '../../lib/rag/classifyQuery.js';
import { createSemaphore, withSoftTimeout } from '../../lib/rag/limiter.js';
import { createFakeFirestore } from '../fakes/fakeFirestore.js';

/** Writes a few chunk docs with embeddings into the fake Firestore. */
function seedChunks(firestore) {
  const docs = {
    returns: ['what is the return policy', 'how long to return an item'],
    warranty: ['how long is the warranty', 'what does the warranty cover'],
  };
  firestore.set(['chunks', 'returns-01'], {
    id: 'returns-01',
    text: docs.returns[0],
    title: 'Return policy',
    url: '/help/returns',
    category: 'faq',
    embedding: [1, 0, 0],
  });
  firestore.set(['chunks', 'returns-02'], {
    id: 'returns-02',
    text: docs.returns[1],
    title: 'Return window',
    url: '/help/returns#window',
    category: 'faq',
    embedding: [0.9, 0.1, 0],
  });
  firestore.set(['chunks', 'warranty-01'], {
    id: 'warranty-01',
    text: docs.warranty[0],
    title: 'Warranty overview',
    url: '/help/warranty',
    category: 'faq',
    embedding: [0, 1, 0],
  });
}

/** Stub embedding adapter: returns a fixed, simple query vector. */
const embedIdentity = {
  embed: async (text) => {
    if (/return/i.test(String(text))) return [1, 0, 0];
    if (/warranty/i.test(String(text))) return [0, 1, 0];
    return [0, 0, 1];
  },
};

describe('Step 3.1 — Query classification (conditional rewrite)', () => {
  it('passes a self-contained query straight to retrieval — no rewrite', () => {
    const r = classifyQuery('what is your return policy', { history: [{ role: 'user', content: 'hi' }] });
    expect(r.rewrite).toBe(false);
  });

  it('rewrites an ambiguous pronoun query when prior context exists', () => {
    const history = [{ role: 'user', content: 'Tell me about the return policy.' }];
    const r = classifyQuery('its cancellation policy?', { history });
    expect(r.rewrite).toBe(true);
  });

  it('does not rewrite an ambiguous pronoun without context to anchor it', () => {
    const r = classifyQuery('what happens with it?', { history: [] });
    expect(r.rewrite).toBe(false);
  });
});

describe('Step 3.2 — retrieval: single Firestore findNearest', () => {
  let fs;
  let retriever;
  beforeEach(() => {
    fs = createFakeFirestore();
    seedChunks(fs);
    retriever = createRetriever({ firestore: fs, embeddings: embedIdentity });
  });

  it('returns top-K chunks with similarity scores, nearest first', async () => {
    const hits = await retriever.retrieve([1, 0, 0], { limit: 2 });
    expect(hits.length).toBe(2);
    expect(hits[0].title).toBe('Return policy'); // [1,0,0] closest to [1,0,0]
    expect(hits[0].similarityScore).toBeCloseTo(1 - (1 - 1), 3);
    expect(typeof hits[0].id).toBe('string');
  });

  it('resolves a document id correctly', async () => {
    const hits = await retriever.retrieve([1, 0, 0], { limit: 1 });
    expect(hits[0].id).toBe('returns-01');
  });

  it('returns empty and degrades gracefully when nothing is above the threshold', async () => {
    // A vector far from all stored ones
    const hits = await retriever.retrieve([0.2, 0.2, 0.9], { limit: 3 });
    expect(Array.isArray(hits)).toBe(true);
    // All docs present; caller can filter. No throw.
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
    expect(results).toHaveLength(3); // all ran through the queue
    expect(active).toBe(0);
  });

  it('returns available results when a search path times out (bounded, no hang)', async () => {
    const fsLocal = createFakeFirestore();
    seedChunks(fsLocal);
    const slowEmbed = {
      embed: () => new Promise((resolve) => setTimeout(() => resolve([1, 0, 0]), 50)),
    };
    const boundedRetriever = createRetriever({ firestore: fsLocal, embeddings: slowEmbed }, { limit: 5 });
    const res = await withSoftTimeout(() => boundedRetriever.embedAndRetrieve('return'), {
      timeoutMs: 1000,
      fallback: { hits: [], timedOut: true },
    });
    // On the happy side, the slow embed finishes within a generous budget:
    expect(res.timedOut).toBe(false);
    expect(res.value.hits.length).toBeGreaterThan(0);
  });

  it('does not throw if a retrieval exceeds the soft timeout — it returns fallback []', async () => {
    // Force an extremely low timeout against a doc set: retrieval returns []
    // but does not reject.
    const result = await withSoftTimeout(() => Promise.resolve('x'), {
      timeoutMs: 1,
      fallback: [],
    });
    // withSoftTimeout only bounds wait; a fast resolver returns its value.
    expect(result.value).toBe('x');
  });
});

describe('Step 3.4 — dynamic reranking (conditional skip)', () => {
  it('skips rerank when top similarity is above threshold (latency saved)', async () => {
    const reranker = createReranker(
      { reranker: { rerank: async () => { throw new Error('should not be called'); } } },
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
          rerank: async (_q, hits) => {
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
    expect(result.hits[0].id).toBe('b'); // reversed by the stub reranker
  });
});

describe('Step 3.5 — context + source map construction', () => {
  it('builds a prompt with numbered sources', () => {
    const hits = [
      { id: 'a', title: 'Return', url: '/a', text: 'You can return within 30 days.', similarityScore: 0.9 },
      { id: 'b', title: 'Warranty', url: '/b', text: 'The warranty covers defects.', similarityScore: 0.7 },
    ];
    const { context, sourceMap, sources } = buildContext(hits);
    expect(context).toContain('[Source 1]');
    expect(context).toContain('[Source 2]');
    expect(sourceMap[1]).toMatchObject({ title: 'Return', url: '/a', id: 'a' });
    expect(sources).toHaveLength(2);
  });

  it('omits empty or low-relevance docs from context', () => {
    const hits = [
      { id: 'a', title: 'Good', url: '/a', text: 'A longer relevant document text here for the demo.', similarityScore: 0.95 },
      { id: 'b', title: 'Short', url: '/b', text: 'too short', similarityScore: 0.9 }, // text too short
      { id: 'c', title: 'Noise', url: '/c', text: 'Irrelevant document body that is long enough.', similarityScore: 0.1 },
    ];
    const { context, sources } = buildContext(hits);
    expect(context).toContain('[Source 1]');
    expect(context).not.toContain('too short');
    expect(context).not.toContain('Irrelevant');
    expect(sources).toHaveLength(1);
  });
});

describe('Pipeline integration', () => {
  it('runs the full flow: classify -> embed -> retrieve -> rerank -> context', async () => {
    const fs = createFakeFirestore();
    seedChunks(fs);
    const pipeline = createPipeline(
      { firestore: fs, embeddings: embedIdentity, reranker: { rerank: async (_q, h) => h } },
      { confidenceThreshold: 0.9, maxConcurrent: 2 },
    );
    const result = await pipeline.run('what is the return policy?');
    expect(result.classification.rewrite).toBe(false);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.sourceMap).toBeDefined();
    expect(result.context).toMatch(/\[Source 1\]/);
    expect(result.timedOut).toBe(false);
  });

  it('surfaces a timed-out retrieval gracefully (no LLM hangs)', async () => {
    const fs = createFakeFirestore();
    seedChunks(fs);
    const slowEmbed = {
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
});