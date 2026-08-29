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
 * Origin allowlist: instead of `Access-Control-Allow-Origin: *`, the service
 * only echoes an origin that is in the configured allowlist. This is the
 * "domain based filtering" control for a public demo — it stops *other
 * websites* from calling the API from a user's browser. It is browser-enforced
 * (not server-enforced): a non-browser client (curl, a script) sends no Origin
 * header and is unaffected. Real server-side auth would require a frontend
 * backend to mint tokens — out of scope here.
 *
 * Pure functions of the incoming request — unit-tested without a server.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/** Methods + headers the SSE caller needs. */
export const CORS_ALLOW_METHODS = 'POST, OPTIONS';
export const CORS_ALLOW_HEADERS = 'Content-Type, Last-Event-ID';

/** Strips a trailing slash so `https://host/` and `https://host` match. */
function normalizeOrigin(origin: string): string {
    return origin.replace(/\/+$/, '');
}

export interface Cors {
    /** CORS headers for a response, echoing the origin only when allowed. */
    corsHeaders(origin?: string): Record<string, string>;
    /** True when the request is a CORS preflight (`OPTIONS` with an Origin). */
    isPreflight(req: IncomingMessage): boolean;
    /**
     * Writes a CORS preflight response to `res`. Returns true when handled.
     * Allowed origins get a 204 echoing their origin; disallowed origins get a
     * 403 so the browser blocks the follow-up request.
     */
    handlePreflight(req: IncomingMessage, res: ServerResponse): boolean;
}

/**
 * Creates the CORS helpers bound to an origin allowlist. When no Origin header
 * is present (non-browser / same-origin callers) CORS does not apply, so the
 * response allows `*` and the request proceeds.
 */
export function createCors({ allowedOrigins }: { allowedOrigins: string[] }): Cors {
    const allowed = new Set(allowedOrigins.map(normalizeOrigin));

    function isAllowed(origin: string): boolean {
        return allowed.has(normalizeOrigin(origin));
    }

    function corsHeaders(origin?: string): Record<string, string> {
        const base: Record<string, string> = {
            'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
            'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
        };
        if (!origin) {
            // Non-browser / same-origin: CORS does not apply; allow.
            return { ...base, 'Access-Control-Allow-Origin': '*' };
        }
        if (isAllowed(origin)) {
            // Echo the specific origin (not `*`) so the browser accepts it.
            return { ...base, 'Access-Control-Allow-Origin': origin };
        }
        // Disallowed origin: omit the allow-origin header so the browser blocks.
        return base;
    }

    function isPreflight(req: IncomingMessage): boolean {
        return (
            (req.method ?? '').toUpperCase() === 'OPTIONS' &&
            (req.headers['access-control-request-method'] as string | undefined) != null
        );
    }

    function handlePreflight(req: IncomingMessage, res: ServerResponse): boolean {
        if (!isPreflight(req)) return false;
        const origin = req.headers.origin as string | undefined;
        if (origin && !isAllowed(origin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'origin not allowed' }));
            return true;
        }
        res.writeHead(204, corsHeaders(origin));
        res.end();
        return true;
    }

    return { corsHeaders, isPreflight, handlePreflight };
}
