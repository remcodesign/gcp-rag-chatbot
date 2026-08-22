/**
 * Domain 4 — Seed Corpus Job (Northwind Outfitters, one-time + idempotent).
 *
 * Public entry point for the rag-ingest package.
 */

export { runSeed, CURRENT_VERSION } from './orchestrate.js';
export { parseSource, REQUIRED_KEYS } from './frontmatter.js';
export { chunkText, hashText } from './chunker.js';
export { readManifest, checkSeedNeeded, writeManifest } from './manifest.js';
export { writeTextFields, writeVectors } from './seeder.js';
export { loadSources } from './loadSources.js';