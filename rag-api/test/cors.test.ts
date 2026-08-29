import { describe, it, expect } from 'vitest';
import { createCors, CORS_ALLOW_METHODS, CORS_ALLOW_HEADERS } from '../lib/cors.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ALLOWED = ['https://rag-frontend-346411608497.europe-west4.run.app', 'http://localhost:5174'];

function makeCors(allowedOrigins: string[] = ALLOWED) {
    return createCors({ allowedOrigins });
}

const preflightReq = (origin?: string): IncomingMessage =>
    ({
        method: 'OPTIONS',
        headers: {
            'access-control-request-method': 'POST',
            ...(origin ? { origin } : {}),
        },
    }) as unknown as IncomingMessage;

const postReq = (origin?: string): IncomingMessage =>
    ({
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(origin ? { origin } : {}),
        },
    }) as unknown as IncomingMessage;

function makeRes() {
    return {
        status: 0,
        head: null as Record<string, string> | null,
        body: null as unknown,
        ended: false,
        writeHead(s: number, h: Record<string, string>) {
            this.status = s;
            this.head = h;
        },
        end(b: unknown) {
            this.ended = true;
            this.body = typeof b === 'string' ? JSON.parse(b) : b;
        },
    };
}

describe('cors', () => {
    it('echoes an allowed origin in the response headers (happy)', () => {
        const cors = makeCors();
        const headers = cors.corsHeaders('https://rag-frontend-346411608497.europe-west4.run.app');
        expect(headers['Access-Control-Allow-Origin']).toBe(
            'https://rag-frontend-346411608497.europe-west4.run.app',
        );
        expect(headers['Access-Control-Allow-Methods']).toBe(CORS_ALLOW_METHODS);
        expect(headers['Access-Control-Allow-Headers']).toBe(CORS_ALLOW_HEADERS);
    });

    it('allows the local dev origin (happy)', () => {
        const cors = makeCors();
        const headers = cors.corsHeaders('http://localhost:5174');
        expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:5174');
    });

    it('matches an origin with a trailing slash (happy)', () => {
        const cors = makeCors();
        const headers = cors.corsHeaders('http://localhost:5174/');
        expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:5174/');
    });

    it('omits the allow-origin header for a disallowed origin (non-happy)', () => {
        const cors = makeCors();
        const headers = cors.corsHeaders('https://evil.example.com');
        expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    });

    it('allows any origin when no Origin header is present (non-browser caller)', () => {
        const cors = makeCors();
        const headers = cors.corsHeaders();
        expect(headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('detects a preflight OPTIONS request', () => {
        const cors = makeCors();
        expect(
            cors.isPreflight(
                preflightReq('https://rag-frontend-346411608497.europe-west4.run.app'),
            ),
        ).toBe(true);
    });

    it('does not treat a normal POST as a preflight (non-happy)', () => {
        const cors = makeCors();
        expect(cors.isPreflight(postReq())).toBe(false);
    });

    it('answers an allowed preflight with 204 + the echoed origin (happy)', () => {
        const cors = makeCors();
        const res = makeRes();
        const handled = cors.handlePreflight(
            preflightReq('https://rag-frontend-346411608497.europe-west4.run.app'),
            res as unknown as ServerResponse,
        );
        expect(handled).toBe(true);
        expect(res.status).toBe(204);
        expect(res.head?.['Access-Control-Allow-Origin']).toBe(
            'https://rag-frontend-346411608497.europe-west4.run.app',
        );
        expect(res.ended).toBe(true);
    });

    it('rejects a disallowed preflight with 403 (non-happy)', () => {
        const cors = makeCors();
        const res = makeRes();
        const handled = cors.handlePreflight(
            preflightReq('https://evil.example.com'),
            res as unknown as ServerResponse,
        );
        expect(handled).toBe(true);
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'origin not allowed' });
        expect(res.ended).toBe(true);
    });

    it('does nothing for a non-preflight request (used by the SSE route)', () => {
        const cors = makeCors();
        const res = makeRes();
        expect(cors.handlePreflight(postReq(), res as unknown as ServerResponse)).toBe(false);
    });
});
