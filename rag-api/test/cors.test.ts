import { describe, it, expect } from 'vitest';
import { corsHeaders, isPreflight, handlePreflight, CORS_ALLOW_ORIGIN } from '../lib/cors.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const preflightReq = (): IncomingMessage =>
    ({ method: 'OPTIONS', headers: { 'access-control-request-method': 'POST' } }) as unknown as IncomingMessage;

const postReq = (): IncomingMessage =>
    ({ method: 'POST', headers: { 'content-type': 'application/json' } }) as unknown as IncomingMessage;

describe('cors', () => {
    it('returns the allow-origin header for the separate frontend origin', () => {
        const headers = corsHeaders();
        expect(headers['Access-Control-Allow-Origin']).toBe(CORS_ALLOW_ORIGIN);
        expect(headers['Access-Control-Allow-Methods']).toContain('POST');
        expect(headers['Access-Control-Allow-Headers']).toContain('Last-Event-ID');
    });

    it('detects a preflight OPTIONS request', () => {
        const req = preflightReq();
        expect(isPreflight(req)).toBe(true);
    });

    it('does not treat a normal POST as a preflight (non-happy)', () => {
        expect(isPreflight(postReq())).toBe(false);
    });

    it('answers a preflight with 204 + CORS headers (happy)', () => {
        const res = {
            status: 0,
            head: null as Record<string, string> | null,
            ended: false,
            writeHead(s: number, h: Record<string, string>) {
                this.status = s;
                this.head = h;
            },
            end() {
                this.ended = true;
            },
        };
        const handled = handlePreflight(preflightReq(), res as unknown as ServerResponse);
        expect(handled).toBe(true);
        expect(res.status).toBe(204);
        expect(res.head?.['Access-Control-Allow-Origin']).toBe('*');
        expect(res.ended).toBe(true);
    });

    it('does nothing for a non-preflight request (used by the SSE route)', () => {
        const res = { writeHead() { }, end() { } } as unknown as ServerResponse;
        expect(handlePreflight(postReq(), res)).toBe(false);
    });
});