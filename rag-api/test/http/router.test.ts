import { describe, it, expect, vi } from 'vitest';
import { createRouter } from '../../lib/http/router.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** A recording response sink standing in for a Node `ServerResponse`. */
interface Sink {
    status: number;
    body: unknown;
    head: Record<string, string> | null;
    writeHead(status: number, headers: Record<string, string>): void;
    end(body?: unknown): void;
}

function makeSink(): Sink {
    const sink: Sink = {
        status: 0,
        body: null,
        head: null,
        writeHead(status, headers) {
            sink.status = status;
            sink.head = headers;
        },
        end(body) {
            sink.body = typeof body === 'string' ? JSON.parse(body) : body;
        },
    };
    return sink;
}

function makeReq(
    method: string,
    url: string,
    headers: Record<string, string> = {},
): IncomingMessage {
    return { method, url, headers } as unknown as IncomingMessage;
}

function makeDeps() {
    const handleSse = vi.fn(async () => {});
    const handleLiveness = vi.fn(() => {});
    const handleReadiness = vi.fn(async () => {});
    const { route } = createRouter({ handleSse, handleLiveness, handleReadiness });
    return { route, handleSse, handleLiveness, handleReadiness };
}

describe('HTTP router', () => {
    it('routes POST /sessions/:id/messages to the SSE handler with the session id', async () => {
        const { route, handleSse } = makeDeps();
        const res = makeSink();
        await route(
            makeReq('POST', '/sessions/abc-123/messages'),
            res as unknown as ServerResponse,
        );
        expect(handleSse).toHaveBeenCalledTimes(1);
        expect(handleSse).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'abc-123');
    });

    it('routes GET /livez to liveness (happy)', async () => {
        const { route, handleLiveness } = makeDeps();
        const res = makeSink();
        await route(makeReq('GET', '/livez'), res as unknown as ServerResponse);
        expect(handleLiveness).toHaveBeenCalledTimes(1);
    });

    it('routes GET / to liveness (alias)', async () => {
        const { route, handleLiveness } = makeDeps();
        const res = makeSink();
        await route(makeReq('GET', '/'), res as unknown as ServerResponse);
        expect(handleLiveness).toHaveBeenCalledTimes(1);
    });

    it('routes GET /readyz to readiness (happy)', async () => {
        const { route, handleReadiness } = makeDeps();
        const res = makeSink();
        await route(makeReq('GET', '/readyz'), res as unknown as ServerResponse);
        expect(handleReadiness).toHaveBeenCalledTimes(1);
    });

    it('routes GET /health to readiness (alias)', async () => {
        const { route, handleReadiness } = makeDeps();
        const res = makeSink();
        await route(makeReq('GET', '/health'), res as unknown as ServerResponse);
        expect(handleReadiness).toHaveBeenCalledTimes(1);
    });

    it('answers a CORS preflight with 204 and does not call a handler', async () => {
        const { route, handleSse, handleLiveness, handleReadiness } = makeDeps();
        const res = makeSink();
        await route(
            makeReq('OPTIONS', '/sessions/x/messages', {
                'access-control-request-method': 'POST',
            }),
            res as unknown as ServerResponse,
        );
        expect(res.status).toBe(204);
        expect(res.head?.['Access-Control-Allow-Origin']).toBe('*');
        expect(handleSse).not.toHaveBeenCalled();
        expect(handleLiveness).not.toHaveBeenCalled();
        expect(handleReadiness).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown path (non-happy)', async () => {
        const { route, handleSse, handleLiveness, handleReadiness } = makeDeps();
        const res = makeSink();
        await route(makeReq('GET', '/nope'), res as unknown as ServerResponse);
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: 'not found' });
        expect(handleSse).not.toHaveBeenCalled();
        expect(handleLiveness).not.toHaveBeenCalled();
        expect(handleReadiness).not.toHaveBeenCalled();
    });

    it('returns 404 for a non-matching method on a known path (non-happy)', async () => {
        const { route, handleSse } = makeDeps();
        const res = makeSink();
        await route(makeReq('GET', '/sessions/x/messages'), res as unknown as ServerResponse);
        expect(res.status).toBe(404);
        expect(handleSse).not.toHaveBeenCalled();
    });
});
