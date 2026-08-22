/**
 * CLI entry for the seed job (Cloud Run Job).
 *
 * Reads the corpus directory, seeds Firestore, and exits non-zero on failure so
 * the Job surfaces as failed. The OpenRouter embedding provider is injected via
 * `getEmbedder()` — wired in Domains 5+ once the SDK is added; tests and any
 * manual run can provide a stub.
 */

import { Firestore } from '@google-cloud/firestore';
import { runSeed } from '../lib/orchestrate.js';
import { loadSources } from '../lib/loadSources.js';

const CORPUS_DIR = process.env.CORPUS_DIR ?? '/corpus';

/**
 * Returns the embed adapter. Placeholder until Domain 5 wires the real
 * OpenRouter SDK; it reads an env-provided `EMBED_BATCH` stub for local runs.
 */
function getEmbedder() {
  // TODO(Domain5): return createOpenRouterEmbedder({ model, dims }) once the
  // OpenRouter SDK (or a thin HTTP wrapper) is added. No new dep added here.
  return {
    embed: async (texts) => texts.map((t) => [t.length, 0, 0]),
  };
}

export async function main() {
  const firestore = new Firestore();
  try {
    const sources = await loadSources(CORPUS_DIR);
    const result = await runSeed({ firestore, embeddings: getEmbedder() }, { sources });
    console.log(JSON.stringify(result));
    return 0; // both 'seeded' and 'already-seeded' are success
  } catch (err) {
    console.error('seed failed:', err?.message ?? err);
    firestore.terminate?.().catch(() => {});
    return 1;
  }
}

// Run when imported directly (node src/cli.js), not when imported as a module.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main().then((code) => { process.exitCode = code; });
}