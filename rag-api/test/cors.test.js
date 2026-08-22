import { describe, it, expect } from 'vitest';
import {
  corsHeaders,
  isPreflight,
  handlePreflight,
  CORS_ALLOW_ORIGIN,
} from '../lib/cors.js';

describe('cors', () => {
  it('returns the allow-origin header for the separate frontend origin', () => {
    const headers = corsHeaders();
    expect(headers['Access-Control-Allow-Origin']).toBe(CORS_ALLOW_ORIGIN);
    expect(headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(headers['Access-Control-Allow-Headers']).toContain('Last-Event-ID');
  });

  it('detects a preflight OPTIONS request', () => {
    const req = { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST' } };
    expect(isPreflight(req)).toBe(true);
  });

  it('does not treat a normal POST as a preflight (non-happy)', () => {
    const req = { method: 'POST', headers: { 'content-type': 'application/json' } };
    expect(isPreflight(req)).toBe(false);
  });

  it('answers a preflight with 204 + CORS headers (happy)', () => {
    const res = {
      status: null,
      head: null,
      ended: false,
      writeHead(s, h) { this.status = s; this.head = h; },
      end() { this.ended = true; },
    };
    const req = { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST' } };
    const handled = handlePreflight(req, res);
    expect(handled).toBe(true);
    expect(res.status).toBe(204);
    expect(res.head['Access-Control-Allow-Origin']).toBe('*');
    expect(res.ended).toBe(true);
  });

  it('does nothing for a non-preflight request (used by the SSE route)', () => {
    const res = { writeHead() {}, end() {} };
    const req = { method: 'POST', headers: { 'content-type': 'application/json' } };
    expect(handlePreflight(req, res)).toBe(false);
  });
});