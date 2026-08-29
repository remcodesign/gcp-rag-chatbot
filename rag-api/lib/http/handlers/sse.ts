/**
 * SSE streaming handler — `POST /sessions/:id/messages`.
 *
 * Reads the JSON body, extracts the query (accepting both `query` and
 * `question`), folds a top-level `trace` boolean into the options, and hands
 * the request to the generator's `streamAnswer`. Malformed bodies and missing
 * queries degrade to a typed SSE `error` frame (never an HTTP 500).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createSse } from '../../generate/sse.js';
import type { Cors } from '../../cors.js';
import type { Generator } from '../../generate/generator.js';
import type { SseRequestBody } from '../../types/http.js';

interface SseHandlerDeps {
    generator: Pick<Generator, 'streamAnswer'>;
    /** CORS helpers bound to the origin allowlist (for the SSE response head). */
    cors: Cors;
}

export interface SseHandler {
    handle(req: IncomingMessage, res: ServerResponse, sessionId: string): Promise<void>;
}

/**
 * Creates the SSE handler bound to a generator. The generator owns the
 * streaming loop; this handler only parses the request and frames the response.
 */
export function createSseHandler(deps: SseHandlerDeps): SseHandler {
    async function handle(
        req: IncomingMessage,
        res: ServerResponse,
        sessionId: string,
    ): Promise<void> {
        const origin = req.headers.origin as string | undefined;
        const sse = createSse(res, { extraHeaders: deps.cors.corsHeaders(origin) });
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

        await deps.generator.streamAnswer({ sse, sessionId, query, options: options as never });
    }

    return { handle };
}
