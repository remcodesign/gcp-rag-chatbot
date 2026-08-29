/**
 * Nitro route — POST /api/sessions/:id/messages
 *
 * The Nitro BFF endpoint that the browser calls same-origin. It rate-limits
 * (per client IP + per session) and proxies the SSE stream to the private
 * rag-api server-to-server, using the Nitro service's identity (IAM) via an
 * OIDC token from the metadata server.
 *
 * The response is streamed back to the client as SSE, so the browser sees the
 * same progress/token/done frames as if it called rag-api directly.
 */

import { defineEventHandler, createError, getRouterParam, getRequestIP } from 'h3';
import { useRuntimeConfig } from '#imports';
import { getSharedRateLimiter } from '../../../utils/rateLimit';

const config = useRuntimeConfig();
// Shared singleton so the limits route sees the same counters this route
// increments (a per-route instance would always report count: 0).
const limiter = getSharedRateLimiter({
    windowMs: config.rateWindowMs,
    maxPerIp: config.rateMaxPerIp,
    maxPerSession: config.rateMaxPerSession,
});

export default defineEventHandler(async (event) => {
    const sessionId = getRouterParam(event, 'id') ?? '';
    const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown';

    // Rate-limit before proxying: the expensive LLM call must not run if the
    // caller is over budget.
    const verdict = limiter.check(ip, sessionId);
    if (!verdict.allowed) {
        throw createError({ statusCode: verdict.status, statusMessage: verdict.reason });
    }

    // Read the request body (the SSE POST carries a JSON payload).
    const body = await readBody(event).catch(() => ({}));

    const ragApiBase = config.ragApiBase;
    if (!ragApiBase) {
        throw createError({ statusCode: 500, statusMessage: 'RAG_API_BASE not configured' });
    }

    const url = `${ragApiBase}/sessions/${encodeURIComponent(sessionId)}/messages`;

    // On Cloud Run, proxy with the Nitro service's IAM identity (OIDC token).
    // Locally there is no metadata server and a local rag-api is not
    // IAM-protected, so no Authorization header is sent.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (isCloudRun()) {
        headers.Authorization = `Bearer ${await fetchIdToken(ragApiBase)}`;
    }

    const upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!upstream.ok && upstream.status !== 200) {
        throw createError({
            statusCode: upstream.status,
            statusMessage: `upstream ${upstream.status}`,
        });
    }

    // Stream the SSE response back to the client unchanged.
    const res = event.node.res;
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    if (upstream.body) {
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
        }
    }
    res.end();
});
