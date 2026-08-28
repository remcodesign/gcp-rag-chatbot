import { describe, it, expect } from 'vitest';
import { isProxy, isReactive } from 'vue';
import { createChatStore, STATUS, STAGES, STAGE_LABELS } from '../src/lib/chatStore';
import { parseSse } from '../src/lib/sseParser';
import type { RawTrace } from '../src/types/trace';
import type { SseFrame } from '../src/types/sse';
import type { SendParams } from '../src/types/chat';

type TestFrame = SseFrame;

/** Builds a fake transport that yields pre-built SSE frames as raw text. */
function makeSend(framesByCall: TestFrame[][]): (params: SendParams) => AsyncGenerator<string, void, unknown> {
    let call = 0;
    return async function* send() {
        const frames = framesByCall[Math.min(call, framesByCall.length - 1)];
        call += 1;
        for (const f of frames) {
            yield `id: ${f.id}\nevent: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`;
        }
    };
}

const token = (id: number, text: string, citations: unknown[] = []): TestFrame =>
    ({ id, event: 'token', data: { text, citations } });
const progress = (id: number, stage: string, p: number): TestFrame =>
    ({ id, event: 'progress', data: { stage, progress: p } });
const done = (id: number, sources: unknown[] = []): TestFrame =>
    ({ id, event: 'done', data: { sources, citations: [] } });
const doneLimit = (id: number): TestFrame =>
    ({ id, event: 'done', data: { sources: [], citations: [], limitReached: true } });
const err = (id: number, message: string): TestFrame =>
    ({ id, event: 'error', data: { message } });

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
        const send = makeSend([
            [progress(1, STAGES.RETRIEVAL, 40), token(2, 'Hello '), done(3)],
        ]);
        const store = createChatStore({ send, parser: { parseSse } });
        expect(isReactive(store.state)).toBe(true);
        expect(isProxy(store.state)).toBe(true);

        const { watchEffect } = await import('vue');
        let runs = 0;
        let lastAnswer: string | null = null;
        const stop = watchEffect(() => { runs += 1; lastAnswer = store.state.answer; });
        await store.sendMessage({ sessionId: 's1', query: 'q' });
        await Promise.resolve();
        stop();
        expect(store.state.answer).toBe('Hello ');
        expect(runs).toBeGreaterThan(1);
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
        expect(store.state.error?.message).toBe('generation interrupted');
        expect(store.state.answer).toBe('partial');
    });

    it('carries the backend error detail through to the UI (better reporting)', async () => {
        const frame = { id: 3, event: 'error', data: { message: 'generation interrupted', detail: { message: 'OpenRouter chat HTTP 400', statusCode: 400 } } } as TestFrame;
        const send = makeSend([[token(2, 'partial'), frame]]);
        const store = createChatStore({ send, parser: { parseSse } });
        await store.sendMessage({ sessionId: 's1', query: 'q' });
        expect(store.state.status).toBe(STATUS.ERROR);
        expect(store.state.error?.message).toBe('generation interrupted');
        expect(store.state.error?.detail).toMatchObject({ message: 'OpenRouter chat HTTP 400', statusCode: 400 });
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
        expect(store.state.progress).toBe(80);
    });

    it('advances to Generating when the first token arrives (Problem B)', async () => {
        const send = makeSend([
            [progress(1, STAGES.GENERATION, 80), token(2, 'Hello '), token(3, 'world')],
            [done(4)],
        ]);
        const store = createChatStore({ send, parser: { parseSse } });
        await store.sendMessage({ sessionId: 's1', query: 'q' });
        expect(store.state.stage).toBe(STAGES.GENERATING);
        expect(store.state.answer).toBe('Hello world');
    });

    it('maps the generating stage to a human label', () => {
        expect(STAGE_LABELS[STAGES.GENERATING]).toBe('Generating');
    });

    it('does not regress the stage to an earlier one once tokens flow (non-happy)', async () => {
        const send = makeSend([
            [token(1, 'Hello '), progress(2, STAGES.RETRIEVAL, 40)],
            [done(3)],
        ]);
        const store = createChatStore({ send, parser: { parseSse } });
        await store.sendMessage({ sessionId: 's1', query: 'q' });
        expect(store.state.stage).toBe(STAGES.GENERATING);
    });
});

describe('chatStore — reconnection (Step 6.3)', () => {
    it('resumes the stream after a network blip without duplicates', async () => {
        const send = makeSend([
            [progress(1, STAGES.RETRIEVAL, 40), token(2, 'Hello ')],
            [token(3, 'world'), done(4)],
        ]);
        const store = createChatStore({ send, parser: { parseSse } }, { maxRetries: 2, retryBaseMs: 1 });
        await store.sendMessage({ sessionId: 's1', query: 'q' });
        expect(store.state.answer).toBe('Hello world');
        expect(store.state.status).toBe(STATUS.DONE);
    });

    it('sends the last event id back on reconnect (Last-Event-ID)', async () => {
        const calls: Array<number | null> = [];
        const send = async function* (params: SendParams) {
            calls.push(params.lastEventId);
            const frames = params.lastEventId == null ? [token(2, 'a')] : [done(3)];
            for (const f of frames) yield `id: ${f.id}\nevent: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`;
        };
        const store = createChatStore({ send, parser: { parseSse } }, { maxRetries: 2, retryBaseMs: 1 });
        await store.sendMessage({ sessionId: 's1', query: 'q' });
        expect(calls[0]).toBeNull();
        expect(calls[1]).toBe(2);
    });

    it('retries with backoff then surfaces a manual retry (non-happy)', async () => {
        const send = makeSend([
            [token(1, 'a')],
            [token(2, 'b')],
            [token(3, 'c')],
            [token(4, 'd')],
        ]);
        const store = createChatStore({ send, parser: { parseSse } }, { maxRetries: 3, retryBaseMs: 1 });
        await store.sendMessage({ sessionId: 's1', query: 'q' });
        expect(store.state.status).toBe(STATUS.ERROR);
        expect(store.state.error?.message).toContain('retry manually');
    });

    it('manual retry after a terminal error can succeed', async () => {
        const send = makeSend([
            [err(1, 'generation interrupted')],
            [token(2, 'recovered'), done(3)],
        ]);
        const store = createChatStore({ send, parser: { parseSse } }, { maxRetries: 1, retryBaseMs: 1 });
        await store.sendMessage({ sessionId: 's1', query: 'q' });
        expect(store.state.status).toBe(STATUS.ERROR);
        await store.retry();
        expect(store.state.status).toBe(STATUS.DONE);
        expect(store.state.answer).toBe('recovered');
    });
});

describe('chatStore — RAG trace (POC sidebar)', () => {
    const traceData: RawTrace = {
        query: 'return policy',
        retrieved: [
            { id: 'a', title: 'Return', url: '/a', score: 0.9, textPreview: '...', chars: 20, keptInContext: true, rank: 1, category: null, text: '' },
            { id: 'b', title: 'Noise', url: '/b', score: 0.4, textPreview: '...', chars: 20, keptInContext: false, rank: 2, category: null, text: '' },
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
        expect(store.state.trace?.retrieved).toHaveLength(2);
    });

    it('clears trace when a new message starts', async () => {
        let call = 0;
        const send = async function* () {
            call += 1;
            if (call === 1) {
                yield `id: 2\nevent: trace\ndata: ${JSON.stringify(traceData)}\n\n`;
            }
            yield `id: 3\nevent: done\ndata: ${JSON.stringify({ sources: [] })}\n\n`;
        };
        const store = createChatStore({ send, parser: { parseSse } }, { trace: true });
        await store.sendMessage({ sessionId: 's1', query: 'q' });
        expect(store.state.trace).toBeDefined();
        const traceAtStart = store.state.trace;
        expect(traceAtStart).not.toBeNull();
        store.reset();
        expect(store.state.trace).toBeNull();
    });

    it('requests the trace flag on the transport when enabled', async () => {
        let sentTrace: boolean | undefined;
        const send = async function* (params: SendParams) {
            sentTrace = params.trace;
            yield `id: 1\nevent: done\ndata: ${JSON.stringify({ sources: [] })}\n\n`;
        };
        const store = createChatStore({ send, parser: { parseSse } }, { trace: true });
        await store.sendMessage({ sessionId: 's1', query: 'q' });
        expect(sentTrace).toBe(true);
    });

    it('caps the trace flag to false when disabled in options', async () => {
        let sentTrace: boolean | undefined;
        const send = async function* (params: SendParams) {
            sentTrace = params.trace;
            yield `id: 1\nevent: done\ndata: ${JSON.stringify({ sources: [] })}\n\n`;
        };
        const store = createChatStore({ send, parser: { parseSse } }, { trace: false });
        await store.sendMessage({ sessionId: 's1', query: 'q' });
        expect(sentTrace).toBe(false);
    });
});

describe('chatStore — conversation turns (Domain 10)', () => {
    it('increments the turn counter for each completed assistant reply', async () => {
        const frames = (call: number): TestFrame[] =>
            call === 0 ? [token(2, 'Antwoord een'), done(3)] : [token(4, 'Antwoord twee'), done(5)];
        const send = makeSend([frames(0), frames(1)]);
        const store = createChatStore({ send, parser: { parseSse } });
        await store.sendMessage({ sessionId: 's1', query: 'vraag 1' });
        expect(store.state.turnCount).toBe(1);
        await store.sendMessage({ sessionId: 's1', query: 'vraag 2' });
        expect(store.state.turnCount).toBe(2);
        expect(store.state.conversationEnded).toBe(false);
    });

    it('marks the conversation ended (and does not count a turn) on a limitReached done', async () => {
        const frames = (call: number): TestFrame[] =>
            call === 0 ? [token(2, 'Laatste antwoord'), done(3)] : [doneLimit(4)];
        const send = makeSend([frames(0), frames(1)]);
        const store = createChatStore({ send, parser: { parseSse } });
        await store.sendMessage({ sessionId: 's1', query: 'vraag' });
        expect(store.state.turnCount).toBe(1);
        await store.sendMessage({ sessionId: 's1', query: 'nog een' });
        expect(store.state.conversationEnded).toBe(true);
        // The end message is not a real turn.
        expect(store.state.turnCount).toBe(1);
    });

    it('resets the turn counter and ended flag on reset', async () => {
        const send = makeSend([[token(2, 'hi'), done(3)]]);
        const store = createChatStore({ send, parser: { parseSse } });
        await store.sendMessage({ sessionId: 's1', query: 'q' });
        expect(store.state.turnCount).toBe(1);
        store.reset();
        expect(store.state.turnCount).toBe(0);
        expect(store.state.conversationEnded).toBe(false);
    });

    it('builds a transcript of my messages + assistant replies', async () => {
        const send = makeSend([
            [token(2, 'Antwoord een'), done(3)],
            [token(4, 'Antwoord twee'), done(5)],
        ]);
        const store = createChatStore({ send, parser: { parseSse } });
        await store.sendMessage({ sessionId: 's1', query: 'vraag 1' });
        expect(store.state.messages).toHaveLength(2);
        expect(store.state.messages[0]).toMatchObject({ role: 'user', content: 'vraag 1' });
        expect(store.state.messages[1]).toMatchObject({ role: 'assistant', content: 'Antwoord een' });
        expect(typeof store.state.messages[0]?.createdAt).toBe('number');
        await store.sendMessage({ sessionId: 's1', query: 'vraag 2' });
        expect(store.state.messages).toHaveLength(4);
        expect(store.state.messages[3]).toMatchObject({ role: 'assistant', content: 'Antwoord twee' });
    });

    it('ends the conversation automatically on the last allowed turn', async () => {
        // 5 real answers -> after the 5th, conversationEnded is true without a 6th call.
        const frames = (call: number): TestFrame[] => [token(2 + call, `antwoord ${call + 1}`), done(3 + call)];
        const send = makeSend([frames(0), frames(1), frames(2), frames(3), frames(4)]);
        const store = createChatStore({ send, parser: { parseSse } });
        for (let i = 1; i <= 5; i += 1) {
            await store.sendMessage({ sessionId: 's1', query: `vraag ${i}` });
        }
        expect(store.state.turnCount).toBe(5);
        expect(store.state.conversationEnded).toBe(true);
        expect(store.state.messages).toHaveLength(10);
    });
});