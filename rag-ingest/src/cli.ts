/**
 * CLI entry for the seed job (Cloud Run Job).
 *
 * Reads the corpus directory, seeds Firestore, and exits non-zero on failure so
 * the Job surfaces as failed. The OpenRouter embedding provider is injected via
 * `getEmbedder()` (backed by the official `@openrouter/sdk`); tests and any
 * manual run can provide a stub.
 */

import { fileURLToPath } from 'node:url';

import { Firestore } from '@google-cloud/firestore';

import { runSeed } from '../lib/orchestrate.js';
import { loadSources } from '../lib/loadSources.js';
import { createOpenRouterEmbedder } from '../lib/openRouterEmbedder.js';
import type { Firestore as FirestoreShaped } from '../lib/types/firestore.js';

const CORPUS_DIR = process.env.CORPUS_DIR ?? '/app/corpus';

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

export async function main(): Promise<number> {
    // The real Firestore client is structurally compatible with FirestoreShaped; this
    // is the single boundary cast for the seed job.
    const firestore = new Firestore() as unknown as FirestoreShaped;
    try {
        const sources = await loadSources(CORPUS_DIR);
        const result = await runSeed({ firestore, embeddings: getEmbedder() }, { sources });
        console.log(JSON.stringify(result));
        return 0; // both 'seeded' and 'already-seeded' are success
    } catch (err) {
        console.error('seed failed:', (err as Error | undefined)?.message ?? err);
        await terminate(firestore);
        return 1;
    }
}

/** Best-effort Firestore connection close. */
async function terminate(firestore: FirestoreShaped): Promise<void> {
    const t = (firestore as unknown as { terminate?: () => Promise<void> }).terminate;
    if (typeof t === 'function') {
        try {
            await t.call(firestore);
        } catch {
            // ignore close errors on the failure path
        }
    }
}

// Run when invoked directly (node src/cli.js), not when imported as a module.
const isDirectRun = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
    await main().then((code) => {
        process.exitCode = code;
    });
}
