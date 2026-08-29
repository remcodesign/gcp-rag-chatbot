/**
 * rag-api HTTP server — wires Domains 2, 3 & 5 into a runnable Cloud Run Service.
 *
 * Exposes the SSE streaming endpoint (`POST /sessions/:id/messages`) using only
 * Node's built-in `http` module — no framework dependency. This is the container
 * entry point the Cloud Run Service (`rag-api:latest`) calls on port 8080.
 *
 * Security note: OPENROUTER_API_KEY is injected from Secret Manager by Cloud Run
 * (infra/cloud_run.tf env), never baked into the image.
 */

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Firestore } from '@google-cloud/firestore';

import { createPipeline } from '../lib/rag/pipeline.js';
import { createStateStore } from '../lib/state/sessionStore.js';
import { createGenerator } from '../lib/generate/generator.js';
import { createSse } from '../lib/generate/sse.js';
import { createChatBridge } from '../lib/generate/chatBridge.js';
import { createOpenRouterClient } from '../lib/generate/openRouterClient.js';
import { createOpenRouterEmbedder } from '../lib/rag/openRouterEmbedder.js';
import { createHealth } from '../lib/health.js';
import { corsHeaders, handlePreflight } from '../lib/cors.js';
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

interface SseRequestBody {
    query?: unknown;
    question?: unknown;
    options?: Record<string, unknown>;
    trace?: unknown;
}

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

    /**
     * Minimal SSE handler for POST /sessions/:id/messages.
     */
    async function handleSse(
        req: IncomingMessage,
        res: ServerResponse,
        sessionId: string,
    ): Promise<void> {
        const sse = createSse(res, { extraHeaders: corsHeaders() });
        let body = '';
        for await (const chunk of req) body += chunk as string;
        let payload: SseRequestBody;
        try {
            payload = JSON.parse(body || '{}') as SseRequestBody;
        } catch {
            sse.error({ message: 'invalid json body' });
            return;
        }
        const rawQuery = payload.query ?? payload.question;
        const query = typeof rawQuery === 'string' ? rawQuery : '';
        if (!query) {
            sse.error({ message: 'query is required' });
            return;
        }
        // Merge the caller's explicit options; a top-level `trace` boolean (sent by
        // the frontend transport) is folded in so the generator can emit the RAG
        // trace event for the "inner workings" sidebar.
        const options: Record<string, unknown> = { ...(payload.options ?? {}) };
        if (payload.trace !== undefined && options.trace === undefined) {
            options.trace = payload.trace;
        }
        await generator.streamAnswer({ sse, sessionId, query, options: options as never });
    }

    async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

        // CORS preflight (browser sends OPTIONS before the SSE POST from the
        // separately-hosted frontend origin). Short-circuit with a 204.
        if (handlePreflight(req, res)) return;

        if (req.method === 'POST' && url.pathname.startsWith('/sessions/')) {
            const sessionId = url.pathname.replace(/^\/sessions\//, '').replace(/\/messages$/, '');
            return handleSse(req, res, sessionId);
        }
        // Health (GET). Modern /livez + /readyz naming is used because it is NOT
        // reserved by Cloud Run's front-end (unlike /healthz), so the container
        // answers these publicly. `/health` and `/` are aliases (readiness/liveness).
        if (req.method === 'GET') {
            if (url.pathname === '/livez' || url.pathname === '/') {
                return handleLiveness(req, res);
            }
            if (url.pathname === '/readyz' || url.pathname === '/health') {
                return handleReadiness(req, res);
            }
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    }

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
