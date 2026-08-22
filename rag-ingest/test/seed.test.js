import { describe, it, expect, beforeEach } from 'vitest';
import { parseSource } from '../lib/frontmatter.js';
import { chunkText, hashText } from '../lib/chunker.js';
import { readManifest, checkSeedNeeded, writeManifest } from '../lib/manifest.js';
import { runSeed } from '../lib/orchestrate.js';
import { createFakeFirestore } from './fakes/fakeFirestore.js';

const SAMPLE = `---
id: faq-returns-01
category: faq
title: "Return policy"
url: /help/returns
---

### How long do I have to return an item?
You can return most items within 30 days of delivery.`;
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
    expect(r.body).toContain('How long do I have to return');
  });

  it('skips a file with a missing required key and reports the reason', () => {
    const bad = '---\nid: x\ncategory: faq\ntitle: "No url"\n---\nbody here';
    const r = parseSource(bad);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('url');
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
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].id).toBe(hashText(a[0].text));
  });
});

describe('Step 4.2 / 4.5 — manifest gate', () => {
  let fs;
  beforeEach(() => {
    fs = createFakeFirestore();
  });

  it('exits immediately when manifest version matches (no re-embed)', async () => {
    await writeManifest(fs, { version: '1', chunkCount: 5 });
    const manifest = await readManifest(fs);
    const gate = checkSeedNeeded(manifest, '1');
    expect(gate.needsSeed).toBe(false);
  });

  it('re-seeds when the version is bumped', async () => {
    await writeManifest(fs, { version: '1', chunkCount: 5 });
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
    const textEmbed = { embed: async (texts) => texts.map((t) => [t.length, 0, 0]) };
    const res = await runSeed(
      { firestore: fs, embeddings: textEmbed },
      { sources: [{ id: 's1', content: SAMPLE }], batchSize: 4 },
    );
    expect(res.status).toBe('seeded');
    // At least one chunk written, with text and embedding present.
    const docs = [...fs.store.entries()].filter(([k]) => k.includes('chunks'));
    expect(docs.length).toBeGreaterThan(0);
    const [, chunkDoc] = docs.length ? docs[0] : [];
    if (chunkDoc) {
      expect(chunkDoc.text).toBeDefined();
      expect(chunkDoc.embedding).toBeDefined();
    }
  });

  it('handles an embedding retry then succeeds (job continues)', async () => {
    const fsLocal = createFakeFirestore();
    let calls = 0;
    const flaky = {
      embed: async (texts) => {
        calls += 1;
        if (calls < 2) {
          const e = new Error('429 rate limited');
          e.code = 'RATE_LIMITED';
          throw e;
        }
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
    const embed = { embed: async (texts) => texts.map((t) => [t.length, 0, 0]) };
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
    const embed = { embed: async (texts) => texts.map((t) => [1, 0, 0]) };
    await runSeed({ firestore: fs, embeddings: embed }, { sources: [
      { id: 'a', content: SAMPLE },
      { id: 'b', content: SAMPLE },
    ] });
    const manifest = await readManifest(fs);
    expect(manifest.version).toBe('1');
    expect(manifest.chunkCount).toBeGreaterThan(0);
    expect(manifest.dims).toBe(1536);
    expect(manifest.model).toBe('openai/text-embedding-3-small');
  });

  it('exits non-zero (throws) on fatal failure to alert', async () => {
    const fs = createFakeFirestore();
    const broken = { embed: async () => { throw new Error('boom'); } };
    await expect(
      runSeed({ firestore: fs, embeddings: broken }, { sources: [{ id: 's1', content: SAMPLE }] }),
    ).rejects.toThrow('boom');
  });
});