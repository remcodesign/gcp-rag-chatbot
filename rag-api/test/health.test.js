import { describe, it, expect } from 'vitest';
import { createHealth } from '../lib/health.js';

/** Minimal response double capturing status + JSON body. */
function makeRes() {
  return {
    status: null,
    body: null,
    writeHead(s, h) { this.status = s; this.head = h; },
    end(b) { this.body = typeof b === 'string' ? JSON.parse(b) : b; },
  };
}

describe('Health endpoints (/livez, /readyz)', () => {
  it('liveness returns 200 while the process is up', () => {
    const { handleLiveness } = createHealth({ firestore: {} });
    const res = makeRes();
    handleLiveness(null, res);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, live: true, service: 'rag-api' });
  });

  it('readiness returns 200 when Firestore is reachable', async () => {
    const firestore = { listCollections: async () => [] };
    const { handleReadiness } = createHealth({ firestore });
    const res = makeRes();
    await handleReadiness(null, res);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: 'rag-api', ready: true });
  });

  it('readiness returns 503 when Firestore is down (non-happy)', async () => {
    const firestore = {
      listCollections: async () => { throw new Error('datastore unavailable'); },
    };
    const { handleReadiness } = createHealth({ firestore });
    const res = makeRes();
    await handleReadiness(null, res);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, service: 'rag-api', ready: false });
  });

  it('readiness times out (503) when the probe exceeds the budget (non-happy)', async () => {
    const firestore = {
      listCollections: () => new Promise(() => { /* never resolves */ }),
    };
    const { handleReadiness } = createHealth({ firestore }, { readyTimeoutMs: 20 });
    const res = makeRes();
    await handleReadiness(null, res);
    expect(res.status).toBe(503);
    expect(res.body.ready).toBe(false);
  });
});