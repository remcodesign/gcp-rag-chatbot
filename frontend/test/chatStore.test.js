import { describe, it, expect } from 'vitest';
import { createChatStore, STATUS, STAGES } from '../src/lib/chatStore.js';
import { parseSse } from '../src/lib/sseParser.js';

/** Builds a fake transport that yields pre-built SSE frames as raw text. */
function makeSend(framesByCall) {
  const calls = [];
  let call = 0;
  return async function* send(params) {
    calls.push({ ...params, lastEventId: params.lastEventId });
    const frames = framesByCall[Math.min(call, framesByCall.length - 1)];
    call += 1;
    for (const f of frames) {
      yield `id: ${f.id}\nevent: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`;
    }
  };
}

const token = (id, text, citations = []) => ({ id, event: 'token', data: { text, citations } });
const progress = (id, stage, p) => ({ id, event: 'progress', data: { stage, progress: p } });
const done = (id, sources = []) => ({ id, event: 'done', data: { sources, citations: [] } });
const err = (id, message) => ({ id, event: 'error', data: { message } });

describe('chatStore — streaming (Step 6.1)', () => {
  it('renders tokens as they arrive — answer grows live', async () => {
    const send = makeSend([
      [progress(1, STAGES.RETRIEVAL, 40), token(2, 'Hello '), token(3, 'world')],
      [done(4)],
    ]);
    const store = createChatStore({ send, parser: { parseSse } });
    await store.sendMessage({ sessionId: 's1', query: 'hi' });
    expect(store.state.answer).toBe('Hello world');
    expect(store.state.status).toBe(STATUS.DONE);
  });

  it('merges the running citation list from token events', async () => {
    const send = makeSend([
      [token(1, 'See ', [{ n: 1, title: 'Return policy' }])],
      [token(2, 'policy', [{ n: 1, title: 'Return policy' }, { n: 2, title: 'Warranty' }])],
      [done(3, [{ n: 1, title: 'Return policy', url: '/r', id: 'r' }])],
    ]);
    const store = createChatStore({ send, parser: { parseSse } });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    expect(store.state.citations.map((c) => c.n)).toEqual([1, 2]);
    expect(store.state.sources).toHaveLength(1);
  });

  it('shows a retry banner on an error event (non-happy)', async () => {
    const send = makeSend([[progress(1, STAGES.GENERATION, 80), token(2, 'partial'), err(3, 'generation interrupted')]]);
    const store = createChatStore({ send, parser: { parseSse } });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    expect(store.state.status).toBe(STATUS.ERROR);
    expect(store.state.error).toBe('generation interrupted');
    expect(store.state.answer).toBe('partial'); // partial output preserved
  });
});

describe('chatStore — progress UI (Step 6.2)', () => {
  it('advances the status indicator per stage', async () => {
    const send = makeSend([
      [progress(1, STAGES.RETRIEVAL, 40), progress(2, STAGES.RERANK, 60), progress(3, STAGES.GENERATION, 80)],
      [done(4)],
    ]);
    const store = createChatStore({ send, parser: { parseSse } });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    expect(store.state.stage).toBe(STAGES.GENERATION);
    expect(store.state.progress).toBe(80);
  });

  it('does not jump backward on a replayed progress event (non-happy)', async () => {
    const send = makeSend([
      [progress(1, STAGES.GENERATION, 80), progress(2, STAGES.RETRIEVAL, 40)],
      [done(3)],
    ]);
    const store = createChatStore({ send, parser: { parseSse } });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    // stage may be overwritten by the replayed event, but progress never regresses.
    expect(store.state.progress).toBe(80);
  });
});

describe('chatStore — reconnection (Step 6.3)', () => {
  it('resumes the stream after a network blip without duplicates', async () => {
    // First attempt: tokens then the stream dies (no terminal event).
    // Second attempt: backend replays from lastEventId=2 (no duplicate token 2).
    const send = makeSend([
      [progress(1, STAGES.RETRIEVAL, 40), token(2, 'Hello ')],
      [token(3, 'world'), done(4)],
    ]);
    const store = createChatStore({ send, parser: { parseSse }, maxRetries: 2, retryBaseMs: 1 });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    expect(store.state.answer).toBe('Hello world'); // no doubled text
    expect(store.state.status).toBe(STATUS.DONE);
  });

  it('sends the last event id back on reconnect (Last-Event-ID)', async () => {
    const calls = [];
    const send = makeSend([
      [token(2, 'a')],
      [done(3)],
    ]);
    const store = createChatStore({
      send: async function* (params) {
        calls.push(params.lastEventId);
        const frames = params.lastEventId == null ? [token(2, 'a')] : [done(3)];
        for (const f of frames) yield `id: ${f.id}\nevent: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`;
      },
      parser: { parseSse },
      maxRetries: 2,
      retryBaseMs: 1,
    });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    expect(calls[0]).toBeNull();
    expect(calls[1]).toBe(2); // resume point sent back
  });

  it('retries with backoff then surfaces a manual retry (non-happy)', async () => {
    const send = makeSend([
      [token(1, 'a')], // dies
      [token(2, 'b')], // dies
      [token(3, 'c')], // dies
      [token(4, 'd')], // dies (4th attempt exceeds maxRetries=3)
    ]);
    const store = createChatStore({ send, parser: { parseSse }, maxRetries: 3, retryBaseMs: 1 });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    expect(store.state.status).toBe(STATUS.ERROR);
    expect(store.state.error).toContain('retry manually');
  });

  it('manual retry after a terminal error can succeed', async () => {
    const send = makeSend([
      [err(1, 'generation interrupted')],
      [token(2, 'recovered'), done(3)],
    ]);
    const store = createChatStore({ send, parser: { parseSse }, maxRetries: 1, retryBaseMs: 1 });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    expect(store.state.status).toBe(STATUS.ERROR);
    await store.retry();
    expect(store.state.status).toBe(STATUS.DONE);
    expect(store.state.answer).toBe('recovered');
  });
});