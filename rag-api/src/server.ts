/**
 * rag-api HTTP server — wires Domains 2, 3 & 5 into a runnable Cloud Run Service.
 *
 * Thin composition root: builds the DI runtime (state, pipeline, generator,
 * health) and mounts the HTTP router + handlers. Routing and request handling
 * live in `lib/http/`; this file only wires them together and starts the
 * listener. Uses only Node's built-in `http` module — no framework dependency.
 * This is the container entry point the Cloud Run Service (`rag-api:latest`)
 * calls on port 8080.
 *
 * Security note: OPENROUTER_API_KEY is injected from Secret Manager by Cloud Run
 * (infra/cloud_run.tf env), never baked into the image.
 */

import http from 'node:http';
import { Firestore } from '@google-cloud/firestore';

import { createPipeline } from '../lib/rag/pipeline.js';
import { createStateStore } from '../lib/state/sessionStore.js';
import { createGenerator } from '../lib/generate/generator.js';
import { createChatBridge } from '../lib/generate/chatBridge.js';
import { createOpenRouterClient } from '../lib/generate/openRouterClient.js';
import { createOpenRouterEmbedder } from '../lib/rag/openRouterEmbedder.js';
import { createHealth } from '../lib/health.js';
import { createRouter } from '../lib/http/router.js';
import { createSseHandler } from '../lib/http/handlers/sse.js';
import type { Firestore as FirestoreShaped } from '../lib/types/firestore.js';

const PORT = Number(process.env.PORT ?? 8080);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? '';
const CHAT_MODEL = process.env.CHAT_MODEL ?? 'openai/gpt-oss-20b';

// Enables model reasoning. Default off = the model's NATIVE behavior.
// We only send a `reasoning` override when thinking is explicitly ON.
// The value uses `enabled: true` (the modern OpenRouter shape).
const THINKING_MODE_ON = (process.env.THINKING_MODE_ON ?? '') === 'true';
const reasoning: Record<string, unknown> | undefined = THINKING_MODE_ON
    ? { enabled: true, effort: 'low' }
    : undefined;

// Minimum retrieval relevance (0..1) for a chunk to be kept in the LLM context.
const MIN_SCORE = Number(process.env.MIN_SCORE ?? 0.35);

// 1. Core performance configuration (Throughput + Fallbacks). Tells OpenRouter
// to prefer the fastest provider for the requested model, require a minimum
// throughput, and fall back automatically if the chosen route underperforms.
const providerConfig: Record<string, unknown> = {
    sort: 'throughput',
    preferred_min_throughput: 60,
    allow_fallbacks: true,
};

function createRuntime(): {
    server: http.Server;
    state: ReturnType<typeof createStateStore>;
    pipeline: ReturnType<typeof createPipeline>;
    generator: ReturnType<typeof createGenerator>;
} {
    // The real Firestore client is structurally compatible with the FirestoreShaped
    // interface lib/test code is typed against. This is the single boundary cast.
    const firestore = new Firestore() as unknown as FirestoreShaped;
    const embeddings = createOpenRouterEmbedder({ apiKey: OPENROUTER_API_KEY });
    const state = createStateStore(firestore);
    const pipeline = createPipeline(
        { firestore, embeddings },
        { embedTimeoutMs: 8000, retrieveTimeoutMs: 4000, minScore: MIN_SCORE, maxSources: 10 },
    );
    const bridge = createChatBridge(
        createOpenRouterClient({ apiKey: OPENROUTER_API_KEY, provider: providerConfig }),
        { model: CHAT_MODEL },
    );
    const generator = createGenerator({ bridge, pipeline, store: state }, { reasoning });
    const { handleLiveness, handleReadiness } = createHealth({ firestore });

    // Mount the HTTP surface: the SSE streaming handler + the router. The
    // router owns URL/method dispatch; the server is just a thin listener.
    const { handle } = createSseHandler({ generator });
    const { route } = createRouter({ handleSse: handle, handleLiveness, handleReadiness });

    const server = http.createServer((req, res) => {
        route(req, res).catch((err) => {
            const e = err as Error;
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        });
    });

    return { server, state, pipeline, generator };
}

export interface StartOptions {
    port?: number;
}

export function start({ port = PORT }: StartOptions = {}): http.Server {
    const { server } = createRuntime();
    server.listen(port, () => {
        console.log(`rag-api listening on :${port} (${CHAT_MODEL})`);
    });
    return server;
}

// Run when invoked directly (node dist/src/server.js, after tsc emit).
if (import.meta.url === `file://${process.argv[1]}`) {
    start();
}
