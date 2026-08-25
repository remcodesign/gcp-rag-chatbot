import { describe, it, expect, vi, afterEach } from 'vitest';
import { readSseStream, createOpenRouterClient } from '../../lib/generate/openRouterClient.js';

/** Builds a fake browser-style ReadableStream from an array of string chunks. */
function readableFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return stream;
}

describe('readSseStream', () => {
  it('yields openai-style chunks from an SSE body', async () => {
    const controller = new AbortController();
    const body = readableFrom([
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const out: Array<{ choices: unknown }> = [];
    for await (const chunk of readSseStream(body, controller)) {
      out.push(chunk as { choices: unknown });
    }
    const contents = out.map(
      (c) => ((c as { choices: Array<{ delta: { content: string } }> }).choices[0]?.delta?.content ?? ''),
    );
    expect(contents).toEqual(['Hello', ' world']);
  });

  it('stops at [DONE] and aborts the controller', async () => {
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, 'abort');
    const body = readableFrom(['data: [DONE]\n\n']);
    const out = [];
    for await (const chunk of readSseStream(body, controller)) {
      out.push(chunk);
    }
    expect(out).toHaveLength(0);
    expect(abortSpy).toHaveBeenCalled();
  });

  it('tolerates a null body and does not throw', async () => {
    const controller = new AbortController();
    const out = [];
    for await (const chunk of readSseStream(null, controller)) {
      out.push(chunk);
    }
    expect(out).toHaveLength(0);
  });
});

describe('createOpenRouterClient — provider config', () => {
  it('sends the default provider (throughput + fallbacks) config in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(readableFrom(['data: [DONE]\n\n']), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenRouterClient({
      apiKey: 'k',
      provider: { sort: 'throughput', preferred_min_throughput: 60, allow_fallbacks: true },
    });
    await client.chat.send!({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { provider?: unknown };
    expect(body.provider).toEqual({ sort: 'throughput', preferred_min_throughput: 60, allow_fallbacks: true });
  });

  it('a per-request provider overrides the default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(readableFrom(['data: [DONE]\n\n']), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenRouterClient({ apiKey: 'k', provider: { sort: 'price' } });
    await client.chat.send!({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      provider: { sort: 'latency' },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { provider?: unknown };
    expect(body.provider).toEqual({ sort: 'latency' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});