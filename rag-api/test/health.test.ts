import { describe, it, expect } from 'vitest';
import { createHealth } from '../lib/health.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function makeRes() {
  return {
    status: 0,
    body: null as unknown,
    head: null as Record<string, string> | null,
    writeHead(s: number, h: Record<string, string>) {
      this.status = s;
      this.head = h;
    },
    end(b: unknown) {
      this.body = typeof b === 'string' ? JSON.parse(b) : b;
    },
  };
}

describe('Health endpoints (/livez, /readyz)', () => {
  it('liveness returns 200 while the process is up', () => {
    const { handleLiveness } = createHealth({ firestore: { listCollections: async () => [] } });
    const res = makeRes();
    handleLiveness({} as IncomingMessage, res as unknown as ServerResponse);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, live: true, service: 'rag-api' });
  });

  it('readiness returns 200 when Firestore is reachable', async () => {
    const firestore = { listCollections: async () => [] };
    const { handleReadiness } = createHealth({ firestore });
    const res = makeRes();
    await handleReadiness({} as IncomingMessage, res as unknown as ServerResponse);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: 'rag-api', ready: true });
  });

  it('readiness returns 503 when Firestore is down (non-happy)', async () => {
    const firestore = {
      listCollections: async () => {
        throw new Error('datastore unavailable');
      },
    };
    const { handleReadiness } = createHealth({ firestore });
    const res = makeRes();
    await handleReadiness({} as IncomingMessage, res as unknown as ServerResponse);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, service: 'rag-api', ready: false });
  });

  it('readiness times out (503) when the probe exceeds the budget (non-happy)', async () => {
    const firestore = { listCollections: () => new Promise(() => {}) };
    const { handleReadiness } = createHealth({ firestore }, { readyTimeoutMs: 20 });
    const res = makeRes();
    await handleReadiness({} as IncomingMessage, res as unknown as ServerResponse);
    expect(res.status).toBe(503);
    expect((res.body as { ready: boolean }).ready).toBe(false);
  });
});