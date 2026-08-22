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
import { createOpenRouterEmbedder } from '../lib/openRouterEmbedder.js';

const CORPUS_DIR = process.env.CORPUS_DIR ?? '/corpus';

/**
 * Returns the production OpenRouter embedding adapter (Node fetch). The API key
 * comes from Secret Manager via the Cloud Run Job env (infra/cloud_run.tf),
 * never baked into the image.
 */
function getEmbedder() {
  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY is required to seed embeddings');
    throw new Error('OPENROUTER_API_KEY is required');
  }
  return createOpenRouterEmbedder({ apiKey });
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