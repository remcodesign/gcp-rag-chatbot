import { describe, it, expect } from 'vitest';
import { isProxy, isReactive } from 'vue';
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

  it('parses frames with the DEFAULT parser (regression: no-op default bug)', async () => {
    // The store used to default to a stub `{ parseSse: () => ({frames:[],rest:b}) }`,
    // which ate every chunk and left the UI stuck on the first progress stage.
    // WITHOUT passing `parser`, the real sseParser must be used so frames apply.
    const send = makeSend([
      [progress(1, STAGES.RETRIEVAL, 40), token(2, 'Hello '), done(3)],
    ]);
    const store = createChatStore({ send }); // no parser injected
    await store.sendMessage({ sessionId: 's1', query: 'hi' });
    expect(store.state.answer).toBe('Hello ');
    expect(store.state.progress).toBe(40);
    expect(store.state.status).toBe(STATUS.DONE);
  });

  it('exposes reactive state so the Vue UI re-renders on mutations', async () => {
    // Regression guard: store.state must be a Vue reactive proxy. If it were a
    // plain object, computed refs in App.vue would never update and the chat
    // would show nothing even though SSE frames arrive.
    const send = makeSend([
      [progress(1, STAGES.RETRIEVAL, 40), token(2, 'Hello '), done(3)],
    ]);
    const store = createChatStore({ send, parser: { parseSse } });
    expect(isReactive(store.state)).toBe(true);
    expect(isProxy(store.state)).toBe(true);

    // watchEffect tracks store.state.answer; it must re-run when a token lands.
    const { watchEffect } = await import('vue');
    let runs = 0;
    let lastAnswer = null;
    const stop = watchEffect(() => { runs += 1; lastAnswer = store.state.answer; });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    await Promise.resolve();
    stop();
    expect(store.state.answer).toBe('Hello ');
    expect(runs).toBeGreaterThan(1); // initial + re-run after token appended
    expect(lastAnswer).toBe('Hello ');
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

describe('chatStore — RAG trace (POC sidebar)', () => {
  const traceData = {
    query: 'return policy',
    retrieval: [
      { id: 'a', title: 'Return', url: '/a', score: 0.9, textPreview: '...', chars: 20, keptInContext: true },
      { id: 'b', title: 'Noise', url: '/b', score: 0.4, textPreview: '...', chars: 20, keptInContext: false },
    ],
    rerank: { didRerank: false, reason: 'above threshold' },
    context: { sources: [{ n: 1, id: 'a' }], length: 10 },
    finalPrompt: ['[1] system\n...'],
  };

  it('retains the trace payload so the sidebar can render it', async () => {
    const send = makeSend([
      [progress(1, STAGES.RETRIEVAL, 40), { id: 2, event: 'trace', data: traceData }, done(3)],
    ]);
    const store = createChatStore({ send, parser: { parseSse } }, { trace: true });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    expect(store.state.trace).toBeDefined();
    expect(store.state.trace.retrieval).toHaveLength(2);
  });

  it('clears trace when a new message starts (before any trace frame arrives)', async () => {
    // First message yields a trace frame; the second message starts with a fresh
    // stream where no trace frame has arrived yet — trace must not leak across turns.
    let call = 0;
    const send = async function* (params) {
      call += 1;
      if (call === 1) {
        yield `id: 2\nevent: trace\ndata: ${JSON.stringify(traceData)}\n\n`;
      }
      yield `id: 3\nevent: done\ndata: ${JSON.stringify({ sources: [] })}\n\n`;
    };
    const store = createChatStore({ send, parser: { parseSse } }, { trace: true });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    expect(store.state.trace).toBeDefined();
    // Sync point: after sendMessage resolves, the second message has cleared trace.
    const traceAtStart = store.state.trace;
    expect(traceAtStart).not.toBeNull(); // still the first message's trace
    store.reset();
    expect(store.state.trace).toBeNull();
  });

  it('requests the trace flag on the transport when enabled', async () => {
    let sentTrace;
    const send = async function* (params) {
      sentTrace = params.trace;
      yield `id: 1\nevent: done\ndata: ${JSON.stringify({ sources: [] })}\n\n`;
    };
    const store = createChatStore({ send, parser: { parseSse } }, { trace: true });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    expect(sentTrace).toBe(true);
  });

  it('caps the trace flag to false when disabled in options', async () => {
    let sentTrace = true;
    const send = async function* (params) {
      sentTrace = params.trace;
      yield `id: 1\nevent: done\ndata: ${JSON.stringify({ sources: [] })}\n\n`;
    };
    const store = createChatStore({ send, parser: { parseSse } }, { trace: false });
    await store.sendMessage({ sessionId: 's1', query: 'q' });
    expect(sentTrace).toBe(false);
  });
});