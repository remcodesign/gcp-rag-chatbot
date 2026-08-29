import { describe, it, expect, vi } from 'vitest';
import { createSseHandler } from '../../lib/http/handlers/sse.js';
import { createCors } from '../../lib/cors.js';
import { SSE_EVENT } from '../../lib/generate/sse.js';
import type { StreamAnswerInput } from '../../lib/generate/generator.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** A recording response sink standing in for a Node `ServerResponse`. */
interface Sink {
    frames: string[];
    head: { status: number; headers: Record<string, string> } | null;
    ended: boolean;
    destroyed: boolean;
    writeHead(status: number, headers: Record<string, string>): void;
    write(str: string): boolean;
    end(): void;
}

function makeSink(): Sink {
    const sink: Sink = {
        head: null,
        destroyed: false,
        ended: false,
        frames: [],
        writeHead(status, headers) {
            sink.head = { status, headers };
        },
        write(str) {
            sink.frames.push(String(str));
            return true;
        },
        end() {
            sink.ended = true;
        },
    };
    return sink;
}

interface ParsedFrame {
    event?: string;
    data: Record<string, unknown>;
}
function parseFrames(frames: string[]): ParsedFrame[] {
    return frames.map((raw) => {
        const event = (raw.match(/^event: (\w+)/m) || [])[1];
        const data = JSON.parse((raw.match(/^data: (.+)$/m) || [])[1] || 'null');
        return { event, data };
    });
}

/** Builds an async-iterable request body from a JSON string. */
function makeReq(body: string): IncomingMessage {
    return {
        method: 'POST',
        url: '/sessions/s1/messages',
        headers: { 'content-type': 'application/json' },
        [Symbol.asyncIterator]: async function* () {
            yield body;
        },
    } as unknown as IncomingMessage;
}

function makeDeps() {
    const streamAnswer = vi.fn(async (_input: StreamAnswerInput) => {});
    const cors = createCors({ allowedOrigins: ['http://localhost:5174'] });
    const { handle } = createSseHandler({ generator: { streamAnswer }, cors });
    return { handle, streamAnswer };
}

describe('SSE handler (POST /sessions/:id/messages)', () => {
    it('parses the body and forwards query + sessionId to the generator (happy)', async () => {
        const { handle, streamAnswer } = makeDeps();
        const res = makeSink();
        await handle(
            makeReq(JSON.stringify({ query: 'wat is de retourtermijn?' })),
            res as unknown as ServerResponse,
            's1',
        );
        expect(streamAnswer).toHaveBeenCalledTimes(1);
        const input = streamAnswer.mock.calls[0]?.[0] as unknown as {
            sessionId: string;
            query: string;
            options: Record<string, unknown>;
        };
        expect(input.sessionId).toBe('s1');
        expect(input.query).toBe('wat is de retourtermijn?');
        expect(input.options).toEqual({});
    });

    it('accepts `question` as an alias for `query`', async () => {
        const { handle, streamAnswer } = makeDeps();
        const res = makeSink();
        await handle(
            makeReq(JSON.stringify({ question: 'wat kost verzending?' })),
            res as unknown as ServerResponse,
            's1',
        );
        const input = streamAnswer.mock.calls[0]?.[0] as unknown as { query: string };
        expect(input.query).toBe('wat kost verzending?');
    });

    it('folds a top-level `trace` boolean into the options', async () => {
        const { handle, streamAnswer } = makeDeps();
        const res = makeSink();
        await handle(
            makeReq(JSON.stringify({ query: 'q', trace: true })),
            res as unknown as ServerResponse,
            's1',
        );
        const input = streamAnswer.mock.calls[0]?.[0] as unknown as {
            options: Record<string, unknown>;
        };
        expect(input.options.trace).toBe(true);
    });

    it('keeps explicit options and does not override an existing trace (non-happy)', async () => {
        const { handle, streamAnswer } = makeDeps();
        const res = makeSink();
        await handle(
            makeReq(JSON.stringify({ query: 'q', options: { trace: false }, trace: true })),
            res as unknown as ServerResponse,
            's1',
        );
        const input = streamAnswer.mock.calls[0]?.[0] as unknown as {
            options: Record<string, unknown>;
        };
        expect(input.options.trace).toBe(false);
    });

    it('emits an SSE error frame for an invalid JSON body (non-happy)', async () => {
        const { handle, streamAnswer } = makeDeps();
        const res = makeSink();
        await handle(makeReq('{not json'), res as unknown as ServerResponse, 's1');
        expect(streamAnswer).not.toHaveBeenCalled();
        const frames = parseFrames(res.frames);
        expect(frames[0]?.event).toBe(SSE_EVENT.ERROR);
        expect(frames[0]?.data).toEqual({ message: 'invalid json body' });
        expect(res.ended).toBe(true);
    });

    it('emits an SSE error frame when the query is missing (non-happy)', async () => {
        const { handle, streamAnswer } = makeDeps();
        const res = makeSink();
        await handle(makeReq(JSON.stringify({})), res as unknown as ServerResponse, 's1');
        expect(streamAnswer).not.toHaveBeenCalled();
        const frames = parseFrames(res.frames);
        expect(frames[0]?.event).toBe(SSE_EVENT.ERROR);
        expect(frames[0]?.data).toEqual({ message: 'query is required' });
        expect(res.ended).toBe(true);
    });

    it('emits an SSE error frame when the query is not a string (non-happy)', async () => {
        const { handle, streamAnswer } = makeDeps();
        const res = makeSink();
        await handle(
            makeReq(JSON.stringify({ query: 42 })),
            res as unknown as ServerResponse,
            's1',
        );
        expect(streamAnswer).not.toHaveBeenCalled();
        const frames = parseFrames(res.frames);
        expect(frames[0]?.event).toBe(SSE_EVENT.ERROR);
        expect(frames[0]?.data).toEqual({ message: 'query is required' });
    });
});
