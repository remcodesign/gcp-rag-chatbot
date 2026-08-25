import { describe, it, expect } from 'vitest';
import { createSse, SSE_EVENT } from '../../lib/generate/sse.js';
import type { Sse } from '../../lib/generate/sse.js';
import { createChatBridge, normalizeError } from '../../lib/generate/chatBridge.js';
import { readDelta } from '../../lib/generate/readDelta.js';
import { validateCitations, normalizeSourceToken, listSources } from '../../lib/generate/citations.js';
import {
  createGenerator,
  buildMessages,
  buildRegenMessages,
  STAGES,
  SYSTEM_PROMPT,
} from '../../lib/generate/generator.js';
import type { Pipeline, SourceMap } from '../../lib/types/rag.js';
import type { ChatStreamChunk, ChatStream } from '../../lib/types/chat.js';

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
  id?: string;
  event?: string;
  data: Record<string, unknown>;
}

/** Parses recorded raw SSE frames back into `{id, event, data}`. */
function parseFrames(frames: string[]): ParsedFrame[] {
  return frames.map((raw) => {
    const id = (raw.match(/^id: (\d+)/m) || [])[1];
    const event = (raw.match(/^event: (\w+)/m) || [])[1];
    const data = JSON.parse((raw.match(/^data: (.+)$/m) || [])[1] || 'null');
    return { id, event, data };
  });
}

/** The `sourceMap` shape produced by Domain 3's `buildContext`. */
const SOURCE_MAP: SourceMap = {
  1: { title: 'Return policy', url: '/help/returns', id: 'returns-01' },
  2: { title: 'Warranty overview', url: '/help/warranty', id: 'warranty-01' },
};

/** Builds a fake async-iterable OpenRouter stream. */
function streamOf(chunks: ChatStreamChunk[]): ChatStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

/** Wraps an arbitrary async generator as a `ChatStream`. */
function toStream(gen: () => AsyncGenerator<unknown, void, unknown>): ChatStream {
  return { [Symbol.asyncIterator]: gen } as unknown as ChatStream;
}

/** Default no-op RAG pipeline that returns empty context. */
function stalePipeline(): Pipeline {
  return {
    run: async () => ({ query: 'q', hits: [], sourceMap: {}, context: '', sources: [], retrievalHits: [], timedOut: false }),
    classifyQuery: () => ({ rewrite: false, reason: 'self-contained query; no rewrite needed' }),
  };
}

/** A bridge whose every call returns the given stream. */
function staticBridge(stream: ChatStream) {
  return {
    normalizeError,
    streamReply: async () => ({ requestId: 'r0', model: 'm', stream }),
  };
}

function tokenStream() {
  return streamOf([
    { choices: [{ delta: { content: 'Please' }, finish_reason: null }] },
    { choices: [{ delta: { content: ' return' }, finish_reason: null }] },
    { choices: [{ delta: { content: ' [Source 1]' }, finish_reason: 'stop' }] },
  ]);
}

describe('Step 5.1 — SSE endpoint framing', () => {
  it('writes typed events with monotonically increasing ids and correct headers', () => {
    const sink = makeSink();
    const sse = createSse(sink);
    sse.send('progress', { stage: 'retrieval', progress: 40 });
    sse.send('token', { text: 'hello' });
    sse.error({ message: 'boom' });

    expect(sink.head?.status).toBe(200);
    expect(sink.head?.headers['Content-Type']).toBe('text/event-stream');
    const frames = parseFrames(sink.frames);
    expect(frames.map((f) => f.id)).toEqual(['0', '1', '2']);
    expect(frames[0]?.event).toBe('progress');
    expect(frames[2]?.event).toBe('error');
  });

  it('streams progress then token events in order', () => {
    const sink = makeSink();
    const sse = createSse(sink);
    sse.send(SSE_EVENT.PROGRESS, { stage: STAGES.RETRIEVAL, progress: 40 });
    sse.send(SSE_EVENT.PROGRESS, { stage: STAGES.RERANK, progress: 60 });
    sse.send(SSE_EVENT.TOKEN, { text: 'A' });
    sse.send(SSE_EVENT.TOKEN, { text: 'B' });

    const frames = parseFrames(sink.frames);
    expect(frames.map((f) => f.event)).toEqual(['progress', 'progress', 'token', 'token']);
  });

  it('sends an error event, not a 500, after the stream started', () => {
    const sink = makeSink();
    const sse = createSse(sink);
    sse.send('progress', { stage: 'retrieval', progress: 40 });
    sse.error({ message: 'generation interrupted', detail: { statusCode: 500 } });

    expect(sink.head?.status).toBe(200);
    const frames = parseFrames(sink.frames);
    expect(frames.at(-1)?.event).toBe('error');
    expect(sink.ended).toBe(true);
  });

  it('end() terminates the response so the client stream closes (browser EOF)', () => {
    const sink = makeSink();
    const sse = createSse(sink);
    sse.send('token', { text: 'x' });
    sse.end();
    expect(sink.ended).toBe(true);
    expect(sse.isClosed()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 5.2 — OpenRouter streaming call
// ---------------------------------------------------------------------------

describe('Step 5.2 — OpenRouter streaming call', () => {
  it('forwards each delta as a token event (stream fully consumed)', async () => {
    const bridge = staticBridge(tokenStream());
    const sink = makeSink();
    const sse = createSse(sink);
    const gen = createGenerator({
      bridge,
      pipeline: stalePipeline(),
      store: { persistMessage: async () => {} },
    });

    await gen.generateOnce({ sse, messages: [], sourceMap: SOURCE_MAP, request: null });

    const tokens = parseFrames(sink.frames).filter((f) => f.event === 'token');
    expect(tokens.map((t) => (t.data as { text: string }).text)).toEqual(['Please', ' return', ' [Source 1]']);
  });

  it('reads deltas via readDelta, tolerating missing/empty deltas', () => {
    expect(readDelta({ choices: [{ delta: { content: 'x' } }] })).toBe('x');
    expect(readDelta({ choices: [{ delta: {} }] })).toBe('');
    expect(readDelta(null)).toBe('');
  });

  it('normalizes an OpenRouter error exposing statusCode (429/5xx retryable)', () => {
    expect(normalizeError({ message: 'rate limited', statusCode: 429 })).toMatchObject({ statusCode: 429, retryable: true });
    expect(normalizeError({ message: 'upstream', statusCode: 500 })).toMatchObject({ statusCode: 500, retryable: true });
    expect(normalizeError({ message: 'not found', statusCode: 404 })).toMatchObject({ statusCode: 404, retryable: false });
  });

  it('catches OpenRouterError mid-stream and throws a normalized error (non-happy)', async () => {
    const bridge = {
      normalizeError,
      streamReply: async () => ({
        requestId: 'r0',
        model: 'm',
        stream: toStream(async function* () {
          yield { choices: [{ delta: { content: 'partial' } }] };
          throw Object.assign(new Error('500'), { statusCode: 500 });
        }),
      }),
    };
    const gen = createGenerator({
      bridge,
      pipeline: stalePipeline(),
      store: { persistMessage: async () => {} },
    });
    await expect(
      gen.generateOnce({ sse: null, messages: [], sourceMap: {}, request: null }),
    ).rejects.toMatchObject({ message: '500' });
  });
});

// ---------------------------------------------------------------------------
// Step 5.3 — Inline citation generation + validation
// ---------------------------------------------------------------------------

describe('Step 5.3 — inline citation generation + validation', () => {
  it('keeps valid inline citations and canonicalizes case/whitespace', () => {
    const text = 'You can return within 30 days [Source 2]. See [source   1] too.';
    const { text: out, citations } = validateCitations(text, SOURCE_MAP);
    expect(out).toContain('[Source 2]');
    expect(out).toContain('[Source 1]');
    expect(out).not.toContain('[source');
    expect(citations.map((c) => c.n)).toEqual([2, 1]);
  });

  it('normalizes a single source token', () => {
    expect(normalizeSourceToken('[SOURCE 3]')).toEqual({ n: 3, token: '[Source 3]' });
    expect(normalizeSourceToken('no')).toBeNull();
  });

  it('strips a citation to a non-existent source (untrusted metadata)', () => {
    const { text: out, citations } = validateCitations('Answer [Source 9].', SOURCE_MAP);
    expect(out).not.toContain('[Source 9]');
    expect(citations).toEqual([]);
  });

  it('listSources maps the numbered map into an ordered list (for chips)', () => {
    const list = listSources(SOURCE_MAP);
    expect(list).toEqual([
      { n: 1, title: 'Return policy', url: '/help/returns', id: 'returns-01', text: '' },
      { n: 2, title: 'Warranty overview', url: '/help/warranty', id: 'warranty-01', text: '' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Step 5.4 — Mid-stream failure: context-assisted regeneration
// ---------------------------------------------------------------------------

describe('Step 5.4 — mid-stream failure: context-assisted regeneration', () => {
  it('regenerates consistently after interruption instead of re-splicing', async () => {
    let opened = 0;
    const bridge = {
      normalizeError,
      streamReply: async () => {
        opened += 1;
        const stream = opened === 1
          ? toStream(async function* () {
              yield { choices: [{ delta: { content: 'broken ' } }] };
              throw Object.assign(new Error('500'), { statusCode: 500 });
            })
          : streamOf([{ choices: [{ delta: { content: 'valid continuation' } }] }]);
        return { requestId: `r${opened}`, model: 'm', stream };
      },
    };
    const sink = makeSink();
    const sse = createSse(sink);
    const gen = createGenerator({
      bridge,
      pipeline: stalePipeline(),
      store: { persistMessage: async () => {} },
    });

    await gen.streamAnswer({ sse, sessionId: 's', query: 'q' });

    const frames = parseFrames(sink.frames);
    expect(frames.at(-1)?.event).toBe('done');
    const tokenTexts = frames
      .filter((f) => f.event === 'token')
      .map((f) => (f.data as { text: string }).text)
      .join('');
    expect(tokenTexts).toContain('valid continuation');
    expect(opened).toBe(2);
  });

  it('caps retries then emits a final error event (bounded, no infinite loop)', async () => {
    let attempts = 0;
    const failingStream = () => toStream(async function* () {
      yield { choices: [{ delta: { content: 'partial' } }] };
      throw Object.assign(new Error('500'), { statusCode: 500 });
    });
    const bridge = {
      normalizeError,
      streamReply: async () => {
        attempts += 1;
        return { requestId: `r${attempts}`, model: 'm', stream: failingStream() };
      },
    };
    const sink = makeSink();
    const sse = createSse(sink);
    const gen = createGenerator(
      {
        bridge,
        pipeline: stalePipeline(),
        store: { persistMessage: async () => {} },
      },
      { maxRegenRetries: 2 },
    );

    await gen.streamAnswer({ sse, sessionId: 's', query: 'q' });

    const frames = parseFrames(sink.frames);
    const errFrames = frames.filter((f) => f.event === 'error');
    expect(errFrames.length).toBe(1);
    expect(errFrames[0]?.data.message).toBe('generation interrupted');
    expect(attempts).toBe(3);
  });

  it('builds a regenerate message array that continues, not repeats', () => {
    const base = buildMessages({ systemPrompt: SYSTEM_PROMPT, context: 'ctx', user: 'q' });
    expect(base.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    const regen = buildRegenMessages(base, 'partial answer');
    expect(regen.map((m) => m.role)).toEqual(['system', 'user', 'user', 'assistant', 'user']);
    expect(regen.at(-1)?.content).toContain('Continue');
  });
});

// ---------------------------------------------------------------------------
// RAG trace event (POC supportability) — the frontend "inner workings" sidebar
// ---------------------------------------------------------------------------

describe('RAG trace event (POC sidebar data)', () => {
  it('emits a trace event with retrieval + final prompt when options.trace is set', async () => {
    const pipeline: Pipeline = {
      run: async () => ({
        query: 'return policy',
        retrievalHits: [
          { id: 'returns-01', title: 'Return', url: '/help/returns', text: 'You can return within 30 days.', similarityScore: 0.9 },
          { id: 'warranty-01', title: 'Warranty', url: '/help/warranty', text: 'The warranty covers defects.', similarityScore: 0.5 },
        ],
        sourceMap: { 1: { title: 'Return', url: '/help/returns', id: 'returns-01' } },
        context: '[Source 1] You can return within 30 days.',
        sources: [{ n: 1, title: 'Return', url: '/help/returns', id: 'returns-01', text: '' }],
        classification: { rewrite: false, reason: 'self-contained' },
        rerankInfo: { didRerank: false, reason: 'above threshold' },
        timings: { embed: 10, retrieval: 20, rerank: 5, total: 35 },
        timedOut: false,
      }),
      classifyQuery: () => ({ rewrite: false, reason: 'self-contained' }),
    };
    const sink = makeSink();
    const sse = createSse(sink);
    const gen = createGenerator({
      bridge: staticBridge(streamOf([{ choices: [{ delta: { content: 'answer' } }] }])),
      pipeline,
      store: { persistMessage: async () => {} },
    });
    await gen.streamAnswer({ sse, sessionId: 's', query: 'return policy', options: { trace: true } });

    const traceFrames = parseFrames(sink.frames).filter((f) => f.event === 'trace');
    expect(traceFrames).toHaveLength(1);
    const data = traceFrames[0]?.data as {
      retrieved: Array<{ keptInContext: boolean }>;
      finalPrompt?: string[];
    };
    expect(data.retrieved).toHaveLength(2);
    expect(data.retrieved[0]?.keptInContext).toBe(true);
    expect(data.retrieved[1]?.keptInContext).toBe(false);
    expect(data.finalPrompt).toBeDefined();
  });

  it('does not emit a trace event when options.trace is not requested', async () => {
    const sink = makeSink();
    const sse = createSse(sink);
    const gen = createGenerator({
      bridge: staticBridge(streamOf([])),
      pipeline: stalePipeline(),
      store: { persistMessage: async () => {} },
    });
    await gen.streamAnswer({ sse, sessionId: 's', query: 'q', options: {} });
    const traceFrames = parseFrames(sink.frames).filter((f) => f.event === 'trace');
    expect(traceFrames).toHaveLength(0);
  });

  it('emits a generating progress event before the first token (Problem B)', async () => {
    const sink = makeSink();
    const sse = createSse(sink);
    const gen = createGenerator({
      bridge: staticBridge(tokenStream()),
      pipeline: stalePipeline(),
      store: { persistMessage: async () => {} },
    });
    await gen.streamAnswer({ sse, sessionId: 's', query: 'q' });

    const frames = parseFrames(sink.frames);
    const genIdx = frames.findIndex((f) => f.event === 'progress' && f.data.stage === STAGES.GENERATING);
    const firstTokenIdx = frames.findIndex((f) => f.event === 'token');
    expect(genIdx).toBeGreaterThanOrEqual(0);
    expect(firstTokenIdx).toBeGreaterThan(genIdx);
  });

  it('includes the generation timing in the trace payload (Problem D)', async () => {
    const pipeline: Pipeline = {
      run: async () => ({
        query: 'q',
        hits: [],
        retrievalHits: [],
        sourceMap: {},
        context: '',
        sources: [],
        classification: { rewrite: false, reason: 'self-contained' },
        rerankInfo: { didRerank: false, reason: 'above threshold' },
        timings: { embed: 10, retrieval: 20, rerank: 5, total: 35 },
        timedOut: false,
      }),
      classifyQuery: () => ({ rewrite: false, reason: 'self-contained' }),
    };
    const sink = makeSink();
    const sse = createSse(sink);
    const gen = createGenerator({
      bridge: staticBridge(streamOf([{ choices: [{ delta: { content: 'answer' } }] }])),
      pipeline,
      store: { persistMessage: async () => {} },
    });
    await gen.streamAnswer({ sse, sessionId: 's', query: 'q', options: { trace: true } });

    const traceFrames = parseFrames(sink.frames).filter((f) => f.event === 'trace');
    expect(traceFrames).toHaveLength(1);
    const timings = (traceFrames[0]?.data as { timings?: { generation?: number; e2e?: number; total?: number; overhead?: number } }).timings;
    expect(timings).toBeDefined();
    expect(typeof timings?.generation).toBe('number');
    expect((timings?.generation ?? -1) >= 0).toBe(true);
    // E2E = pipeline total + generation.
    expect(timings?.e2e).toBe((timings?.total ?? 0) + (timings?.generation ?? 0));
    // Overhead = total - (embed + retrieval + rerank).
    expect(timings?.overhead).toBe((timings?.total ?? 0) - 10 - 20 - 5);
  });
});