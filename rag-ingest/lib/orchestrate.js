/**
 * Seeder orchestration — turns source files into seeded `chunks`.
 *
 * Domain 4. Coordinates Steps 4.1-4.5:
 *   source files -> parse front-matter -> chunk (hashed ids) -> write text
 *   (Location 1) -> embed + write vectors (Location 2) -> finalize manifest.
 *
 * Dependency-injected so the real OpenRouter client (or a stub in tests) can be
 * swapped in.
 */

import { parseSource } from './frontmatter.js';
import { chunkText } from './chunker.js';
import { readManifest, checkSeedNeeded, writeManifest } from './manifest.js';
import { writeTextFields, writeVectors } from './seeder.js';

/** Bumped whenever the corpus content or embedding contract changes. */
export const CURRENT_VERSION = '1';

/**
 * Runs the seed job.
 *
 * @param {object} deps
 * @param {object} deps.firestore    Firestore instance.
 * @param {object} deps.embeddings   adapter: `embed(texts) -> Array<number[]>`.
 * @param {object} [options]
 * @param {Array<{id:string, content:string}>|Function} [options.sources]  source
 *   entries or a `readSources()` loader returning them.
 * @param {number} [options.batchSize=32]  chunks per embed batch.
 * @param {string} [options.currentVersion=CURRENT_VERSION]
 * @param {(line:string)=>void} [options.log]  logger.
 * @returns {Promise<{status:'seeded'|'already-seeded', chunkCount:number, reason?:string, skipped:Array<{id:string,reason:string}>}>}
 */
export async function runSeed(deps, options = {}) {
  const { firestore, embeddings } = deps;
  const log = options.log ?? console.log;
  const batchSize = options.batchSize ?? 32;
  const currentVersion = options.currentVersion ?? CURRENT_VERSION;

  const manifest = await readManifest(firestore);
  const gate = checkSeedNeeded(manifest, currentVersion);
  if (!gate.needsSeed) {
    log(gate.reason);
    return { status: 'already-seeded', chunkCount: 0, skipped: [] };
  }
  log(gate.reason);

  const sources = await resolveSources(options.sources);
  const skipped = [];
  const allChunks = [];

  for (const src of sources) {
    const parsed = parseSource(src.content);
    if (!parsed.ok) {
      skipped.push({ id: src.id, reason: parsed.reason });
      log(`[skip] ${src.id}: ${parsed.reason}`);
      continue;
    }
    const chunks = chunkText(parsed.body).map((c, i) => ({
      ...c,
      index: i,
      sourceId: parsed.id,
      category: parsed.category,
      title: parsed.title,
      url: parsed.url,
    }));
    allChunks.push(...chunks);
  }

  // Write text (L1) then embed + vectors (L2) in batches.
  let writtenTotal = 0;
  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    await writeTextFields(firestore, batch); // Location 1
    writtenTotal += await writeVectors(firestore, batch, embeddings); // Location 2
  }

  await writeManifest(firestore, {
    version: currentVersion,
    chunkCount: writtenTotal,
    model: 'openai/text-embedding-3-small',
    dims: 1536,
    createdAt: Date.now(),
  });

  log(`seeded ${writtenTotal} chunks`);
  return { status: 'seeded', chunkCount: writtenTotal, skipped };
}

/** Reads sources from an array/iterable or a loader function. */
async function resolveSources(sources) {
  if (typeof sources === 'function') return sources();
  return Array.isArray(sources) ? sources : [];
}