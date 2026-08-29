/**
 * HTTP router — maps incoming requests to handlers.
 *
 * Kept deliberately framework-free: a tiny, testable dispatch over the Node
 * `http` request/response pair. It owns URL parsing, method matching, the CORS
 * preflight short-circuit, and the catch-all 404. Handlers are injected so the
 * router stays a pure function of its deps (no Firestore, no generator).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handlePreflight } from '../cors.js';

interface RouterDeps {
    /** SSE streaming handler for `POST /sessions/:id/messages`. */
    handleSse(req: IncomingMessage, res: ServerResponse, sessionId: string): Promise<void>;
    /** Liveness (`GET /livez`, `GET /`). */
    handleLiveness(req: IncomingMessage, res: ServerResponse): void;
    /** Readiness (`GET /readyz`, `GET /health`). */
    handleReadiness(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

export interface Router {
    route(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

/**
 * Creates the router bound to the given handlers. Returns a `route` function
 * the HTTP server calls for every request.
 */
export function createRouter(deps: RouterDeps): Router {
    async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

        // CORS preflight (browser sends OPTIONS before the SSE POST from the
        // separately-hosted frontend origin). Short-circuit with a 204.
        if (handlePreflight(req, res)) return;

        if (req.method === 'POST' && url.pathname.startsWith('/sessions/')) {
            const sessionId = url.pathname.replace(/^\/sessions\//, '').replace(/\/messages$/, '');
            return deps.handleSse(req, res, sessionId);
        }

        // Health (GET). Modern /livez + /readyz naming is used because it is NOT
        // reserved by Cloud Run's front-end (unlike /healthz), so the container
        // answers these publicly. `/health` and `/` are aliases (readiness/liveness).
        if (req.method === 'GET') {
            if (url.pathname === '/livez' || url.pathname === '/') {
                return deps.handleLiveness(req, res);
            }
            if (url.pathname === '/readyz' || url.pathname === '/health') {
                return deps.handleReadiness(req, res);
            }
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    }

    return { route };
}
