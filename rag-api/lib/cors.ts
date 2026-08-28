/**
 * CORS helper — allows the separately-hosted Vue 3 frontend
 * (`rag-frontend-*.run.app`) to call the SSE backend (`rag-api-*.run.app`).
 *
 * Two Cloud Run Services live on different origins, so the browser enforces
 * same-origin policy and, because the SSE POST uses `Content-Type:
 * application/json`, sends a CORS **preflight** `OPTIONS` request before the
 * real call. This module produces the headers both for the preflight reply and
 * the actual SSE response, and detects the preflight case so the router can
 * short-circuit it with a 204.
 *
 * Pure functions of the incoming request — unit-tested without a server.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/** Allow any origin for the demo (public Service). Tighten for prod. */
export const CORS_ALLOW_ORIGIN = '*';

/** Methods + headers the SSE caller needs. */
export const CORS_ALLOW_METHODS = 'POST, OPTIONS';
export const CORS_ALLOW_HEADERS = 'Content-Type, Last-Event-ID';

/** The CORS headers to attach to a response. */
export function corsHeaders(): Record<string, string> {
    return {
        'Access-Control-Allow-Origin': CORS_ALLOW_ORIGIN,
        'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
        'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    };
}

/** True when the request is a CORS preflight (`OPTIONS` with an Origin). */
export function isPreflight(req: IncomingMessage): boolean {
    return (
        (req.method ?? '').toUpperCase() === 'OPTIONS' &&
        (req.headers['access-control-request-method'] as string | undefined) != null
    );
}

/**
 * Writes a CORS preflight response (204) to `res`. Returns true when handled.
 * @returns true if this was a preflight (caller should stop).
 */
export function handlePreflight(req: IncomingMessage, res: ServerResponse): boolean {
    if (!isPreflight(req)) return false;
    res.writeHead(204, corsHeaders());
    res.end();
    return true;
}
