/**
 * rag-api HTTP server — wires Domains 2, 3 & 5 into a runnable Cloud Run Service.
 *
 * Exposes the SSE streaming endpoint (`POST /sessions/:id/messages`) using only
 * Node's built-in `http` module — no framework dependency. This is the container
 * entry point the Cloud Run Service (`rag-api:latest`) calls on port 8080.
 *
 * Dependency graph assembled here (the runtime "wiring" the injection points in
 * Domains 2/3/5 anticipated):
 *   - Firestore client (real @google-cloud/firestore)
 *   - OpenRouter embedder  (lib/rag/openRouterEmbedder.js, Node fetch)
 *   - RAG pipeline (Domain 3)
 *   - State store (Domain 2)
 *   - OpenRouter chat bridge (Domain 5, Node fetch streaming)
 *   - Generator (Domain 5)
 *
 * Security note: OPENROUTER_API_KEY is injected from Secret Manager by Cloud Run
 * (infra/cloud_run.tf env), never baked into the image.
 */

import http from 'node:http';
import { Firestore } from '@google-cloud/firestore';

import { createPipeline } from '../lib/rag/pipeline.js';
import { createStateStore } from '../lib/state/sessionStore.js';
import { createGenerator } from '../lib/generate/generator.js';
import { createSse } from '../lib/generate/sse.js';
import { createChatBridge } from '../lib/generate/chatBridge.js';
import { createOpenRouterEmbedder } from '../lib/rag/openRouterEmbedder.js';
import { createHealth } from '../lib/health.js';
import { corsHeaders, handlePreflight } from '../lib/cors.js';

const PORT = Number(process.env.PORT ?? 8080);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? '';
// const CHAT_MODEL = process.env.CHAT_MODEL ?? 'openai/gpt-oss-120b';
const CHAT_MODEL = process.env.CHAT_MODEL ?? 'openai/gpt-oss-20b';

function createRuntime() {
  const firestore = new Firestore();
  const embeddings = createOpenRouterEmbedder({ apiKey: OPENROUTER_API_KEY });
  const state = createStateStore(firestore);
  const pipeline = createPipeline({ firestore, embeddings });
  const bridge = createChatBridge(createOpenRouterClient(), { model: CHAT_MODEL });
  const generator = createGenerator({ bridge, pipeline, store: state });
  const { handleLiveness, handleReadiness } = createHealth({ firestore });

  /**
   * Minimal SSE handler for POST /sessions/:id/messages.
   */
  async function handleSse(req, res, sessionId) {
    const sse = createSse(res, { extraHeaders: corsHeaders() });
    let body = '';
    for await (const chunk of req) body += chunk;
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      sse.error({ message: 'invalid json body' });
      return;
    }
    const query = payload.query || payload.question;
    if (!query) {
      sse.error({ message: 'query is required' });
      return;
    }
    // Merge the caller's explicit options; a top-level `trace` boolean (sent by
    // the frontend transport) is folded in so the generator can emit the RAG
    // trace event for the "inner workings" sidebar.
    const options = { ...(payload.options ?? {}) };
    if (payload.trace !== undefined && options.trace === undefined) {
      options.trace = payload.trace;
    }
    await generator.streamAnswer({ sse, sessionId, query, options });
  }

  async function route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

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
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
  });

  return { server, state, pipeline, generator };
}

/**
 * Builds a chat bridge client from the OpenRouter REST API using Node fetch with
 * streaming. Mirrors the shape `createChatBridge` expects: `chat.send(params)`
 * returns an async iterable of openai-style chunks.
 */
function createOpenRouterClient() {
  const base = 'https://openrouter.ai/api/v1';
  return {
    chat: {
      async send(params) {
        const controller = new AbortController();
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: params.model,
            messages: params.messages,
            stream: true,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const status = res.status;
          const err = new Error(`OpenRouter chat HTTP ${status}`);
          err.statusCode = status;
          err.retryable = status === 429 || status >= 500;
          throw err;
        }
        return readSseStream(res.body, controller);
      },
    },
  };

  /**
   * Reads an SSE body from the OpenRouter streaming response and yields openai-
   * style chunks `{ choices:[{ delta:{content}, finish_reason }] }`.
   */
  async function *readSseStream(body, controller) {
    try {
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const raw of body) {
        buffer += decoder.decode(raw, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = block
            .split('\n')
            .find((l) => l.startsWith('data:'));
          if (!line) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data);
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      controller.abort?.();
    }
  }
}

export function start({ port = PORT } = {}) {
  const { server } = createRuntime();
  server.listen(port, () => {
    console.log(`rag-api listening on :${port} (${CHAT_MODEL})`);
  });
  return server;
}

// Run when invoked directly (node src/server.js).
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}