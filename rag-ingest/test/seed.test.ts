import { describe, it, expect, beforeEach } from 'vitest';

import { parseSource, parseTags } from '../lib/frontmatter.js';
import { chunkText, hashText } from '../lib/chunker.js';
import { readManifest, checkSeedNeeded, writeManifest } from '../lib/manifest.js';
import { runSeed, CURRENT_VERSION } from '../lib/orchestrate.js';
import { writeTextFields, embedTextForChunk } from '../lib/seeder.js';
import type { Embedder } from '../lib/types/embedder.js';
import type { ManifestSummary, Chunk } from '../lib/types/corpus.js';
import { createFakeFirestore } from './fakes/fakeFirestore.js';

const SAMPLE = `---
id: faq-returns-01
category: faq
title: "Return policy"
url: /help/returns
tags: retouren, retour, terugbetaling, ruilen
---

### How long do I have to return an item?
You can return most items within 30 days of delivery.`;

/** A stub embedder that maps each text to a tiny vector keyed off its length. */
function stubEmbedder(): Embedder {
    return {
        model: 'stub',
        dimensions: 3,
        embed: async (input: string | string[]) => {
            const texts = Array.isArray(input) ? input : [input];
            return texts.map((t) => [t.length, 0, 0]);
        },
    };
}

describe('Step 4.1 — source corpus (front-matter parsing)', () => {
    it('parses front-matter into title, category, url, sourceId', () => {
        const r = parseSource(SAMPLE);
        expect(r.ok).toBe(true);
        expect(r).toMatchObject({
            id: 'faq-returns-01',
            category: 'faq',
            title: 'Return policy',
            url: '/help/returns',
        });
        if (r.ok) {
            expect(r.body).toContain('How long do I have to return');
            // Option B: tags parsed into the source and carried to chunks.
            expect(r.tags).toEqual(['retouren', 'retour', 'terugbetaling', 'ruilen']);
        }
    });

    it('parses an optional tags key and defaults to empty when absent', () => {
        expect(parseTags('hoofdlamp, koplamp,  lamp ,, verlichting')).toEqual([
            'hoofdlamp', 'koplamp', 'lamp', 'verlichting',
        ]);
        expect(parseTags(undefined)).toEqual([]);
        expect(parseTags('')).toEqual([]);
    });

    it('returns empty tags when no tags front-matter is present', () => {
        const noTags = '---\nid: x\ncategory: faq\ntitle: "T"\nurl: /x\n---\nbody';
        const r = parseSource(noTags);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.tags).toEqual([]);
    });

    it('skips a file with a missing required key and reports the reason', () => {
        const bad = '---\nid: x\ncategory: faq\ntitle: "No url"\n---\nbody here';
        const r = parseSource(bad);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain('url');
    });

    it('reports a file that is not front-matter (no opening delimiter)', () => {
        const r = parseSource('# just a heading\nno frontmatter');
        expect(r.ok).toBe(false);
    });
});

describe('Step 4.3 — chunk with content-hash IDs', () => {
    it('chunks a document with overlap and sets sizes', () => {
        const body = 'a'.repeat(2000); // 2000 chars
        const chunks = chunkText(body, { size: 100, overlap: 20 });
        // step = 80 -> chunks at 0,80,160,... -> ceil((2000)/80) = 25
        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) {
            expect(c.id).toMatch(/^[a-f0-9]{64}$/);
            expect(c.text.length).toBeGreaterThanOrEqual(100 - 20);
        }
    });

    it('produces a stable hash id for identical text (idempotent)', () => {
        const a = chunkText('hello world repeat text', { size: 50, overlap: 10 });
        const b = chunkText('hello world repeat text', { size: 50, overlap: 10 });
        expect(a[0]?.id).toBe(b[0]?.id);
        if (a[0]) expect(a[0].id).toBe(hashText(a[0].text));
    });
});

describe('Step 4.2 / 4.5 — manifest gate', () => {
    let fs: ReturnType<typeof createFakeFirestore>;
    beforeEach(() => {
        fs = createFakeFirestore();
    });

    it('exits immediately when manifest version matches (no re-embed)', async () => {
        await writeManifest(fs, { version: '1', chunkCount: 5, model: 'm', dims: 3, createdAt: 0 });
        const manifest = await readManifest(fs);
        const gate = checkSeedNeeded(manifest, '1');
        expect(gate.needsSeed).toBe(false);
    });

    it('re-seeds when the version is bumped', async () => {
        await writeManifest(fs, { version: '1', chunkCount: 5, model: 'm', dims: 3, createdAt: 0 });
        const manifest = await readManifest(fs);
        const gate = checkSeedNeeded(manifest, '2');
        expect(gate.needsSeed).toBe(true);
    });

    it('seeds when manifest is missing', async () => {
        const gate = checkSeedNeeded(null, '1');
        expect(gate.needsSeed).toBe(true);
    });
});

describe('Step 4.4 — write Location 1 then embed + Location 2', () => {
    it('upserts text then merges the vector field, retrievable', async () => {
        const fs = createFakeFirestore();
        const res = await runSeed(
            { firestore: fs, embeddings: stubEmbedder() },
            { sources: [{ id: 's1', content: SAMPLE }], batchSize: 4 },
        );
        expect(res.status).toBe('seeded');
        // At least one chunk written, with text and embedding present.
        const chunkDocs = [...fs.store.entries()].filter(([k]) => k.includes('chunks'));
        expect(chunkDocs.length).toBeGreaterThan(0);
        const [, chunkDoc] = chunkDocs[0] ?? [];
        if (chunkDoc) {
            expect(chunkDoc.text).toBeDefined();
            expect(chunkDoc.embedding).toBeDefined();
            // Option B: tags are stored on the Firestore chunk doc.
            expect(chunkDoc.tags).toEqual(['retouren', 'retour', 'terugbetaling', 'ruilen']);
        }
    });

    it('prepends tags to the embedded text so every chunk carries the synonyms', () => {
        const chunk: Chunk = {
            index: 0,
            id: 'abc',
            sourceId: 's1',
            category: 'product',
            title: 'T',
            url: '/t',
            tags: ['hoofdlamp', 'koplamp'],
            text: 'De Poolster is een koplamp.',
        };
        // The injected embedder receives the enriched text (tags + body).
        const embedded = embedTextForChunk(chunk);
        expect(embedded).toContain('hoofdlamp, koplamp');
        expect(embedded).toContain('De Poolster is een koplamp.');
        // Without tags, the text is unchanged (no bogus prefix).
        expect(embedTextForChunk({ ...chunk, tags: [] })).toBe('De Poolster is een koplamp.');
    });

    it('writes the stored text unchanged (no tag prefix) — citations stay intact', async () => {
        const fs = createFakeFirestore();
        await writeTextFields(fs, [{
            index: 0,
            id: 'abc',
            sourceId: 's1',
            category: 'product',
            title: 'T',
            url: '/t',
            tags: ['hoofdlamp'],
            text: 'De Poolster is een koplamp.',
        }]);
        const doc = fs.store.get('chunks\u0000abc');
        // The stored `text` is the pure body, NOT the tag-prefixed embed input.
        expect(doc?.text).toBe('De Poolster is een koplamp.');
        expect(doc?.tags).toEqual(['hoofdlamp']);
    });

    it('handles an embedding retry then succeeds (job continues)', async () => {
        const fsLocal = createFakeFirestore();
        let calls = 0;
        const flaky: Embedder = {
            model: 'flaky',
            dimensions: 3,
            embed: async (input: string | string[]) => {
                calls += 1;
                if (calls < 2) {
                    const e = new Error('429 rate limited') as Error & { code?: string };
                    e.code = 'RATE_LIMITED';
                    throw e;
                }
                const texts = Array.isArray(input) ? input : [input];
                return texts.map((t) => [1, 1, t.length]);
            },
        };
        const res = await runSeed(
            { firestore: fsLocal, embeddings: flaky },
            { sources: [{ id: 's1', content: SAMPLE }], batchSize: 4 },
        );
        expect(res.status).toBe('seeded');
        expect(calls).toBeGreaterThanOrEqual(2);
    });

    it('is idempotent end-to-end: second run skips (already seeded)', async () => {
        const fsLocal = createFakeFirestore();
        const embed = stubEmbedder();
        await runSeed({ firestore: fsLocal, embeddings: embed }, { sources: [{ id: 's1', content: SAMPLE }] });
        const before = fsLocal.store.size;
        const res2 = await runSeed({ firestore: fsLocal, embeddings: embed }, { sources: [{ id: 's1', content: SAMPLE }] });
        expect(res2.status).toBe('already-seeded');
        expect(fsLocal.store.size).toBe(before); // no additional writes
    });
});

describe('Step 4.5 — manifest finalization', () => {
    it('writes a manifest with the final chunk count', async () => {
        const fs = createFakeFirestore();
        await runSeed({ firestore: fs, embeddings: stubEmbedder() }, {
            sources: [
                { id: 'a', content: SAMPLE },
                { id: 'b', content: SAMPLE },
            ]
        });
        const manifest = await readManifest(fs);
        expect(manifest?.version).toBe(CURRENT_VERSION);
        expect((manifest as ManifestSummary | null)?.chunkCount ?? 0).toBeGreaterThan(0);
        expect((manifest as ManifestSummary | null)?.dims).toBe(1536);
        expect((manifest as ManifestSummary | null)?.model).toBe('openai/text-embedding-3-small');
    });

    it('exits non-zero (throws) on fatal failure to alert', async () => {
        const fs = createFakeFirestore();
        const broken: Embedder = {
            model: 'broken',
            dimensions: 3,
            embed: async () => {
                throw new Error('boom');
            },
        };
        await expect(
            runSeed({ firestore: fs, embeddings: broken }, { sources: [{ id: 's1', content: SAMPLE }] }),
        ).rejects.toThrow('boom');
    });
});