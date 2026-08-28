import { describe, it, expect, vi } from 'vitest';
import { createOpenRouterClient } from '../../lib/generate/openRouterClient.js';

type SdkChunk = { choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; cost?: number | null } };

/** A minimal fake `@openrouter/sdk` client that records the request. */
function fakeSdk(overrides: { stream?: SdkChunk[]; error?: Error } = {}) {
    const send = vi.fn(async (request: unknown) => {
        if (overrides.error) throw overrides.error;
        const chunks = overrides.stream ?? [];
        return { [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c; } };
    });
    return { chat: { send }, send };
}

describe('createOpenRouterClient — streaming', () => {
    it('yields openai-style chunks via the SDK stream', async () => {
        const { send } = fakeSdk({
            stream: [
                { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
                { choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] },
            ],
        });
        const client = createOpenRouterClient({ apiKey: 'k', sdk: { chat: { send } } });
        const out: string[] = [];
        const stream = await client.chat.send!({
            model: 'm',
            messages: [{ role: 'user', content: 'hi' }],
            stream: true,
        });
        for await (const chunk of stream) {
            out.push(chunk.choices?.[0]?.delta?.content ?? '');
        }
        expect(out).toEqual(['Hello', ' world']);
    });

    it('exposes a stable requestId-agnostic shape to readDelta (finish_reason preserved)', async () => {
        const { send } = fakeSdk({
            stream: [{ choices: [{ delta: { content: 'bye' }, finish_reason: 'stop' }] }],
        });
        const client = createOpenRouterClient({ apiKey: 'k', sdk: { chat: { send } } });
        const stream = await client.chat.send!({
            model: 'm',
            messages: [{ role: 'user', content: 'hi' }],
            stream: true,
        });
        const first = await stream[Symbol.asyncIterator]().next();
        expect(first.value.choices?.[0]?.finish_reason).toBe('stop');
    });

    it('forwards the SDK usage chunk (tokens + cost) to readDelta consumers', async () => {
        const { send } = fakeSdk({
            stream: [
                { choices: [{ delta: { content: 'Hi' }, finish_reason: null }] },
                {
                    choices: [{ delta: { content: ' there' }, finish_reason: 'stop' }],
                    usage: { promptTokens: 120, completionTokens: 42, totalTokens: 162, cost: 0.0001 },
                },
            ],
        });
        const client = createOpenRouterClient({ apiKey: 'k', sdk: { chat: { send } } });
        const stream = await client.chat.send!({
            model: 'm',
            messages: [{ role: 'user', content: 'hi' }],
            stream: true,
        });
        let lastUsage: unknown;
        for await (const chunk of stream) {
            if (chunk.usage) lastUsage = chunk.usage;
        }
        expect(lastUsage).toEqual({ promptTokens: 120, completionTokens: 42, totalTokens: 162, cost: 0.0001 });
    });
});

describe('createOpenRouterClient — provider config', () => {
    it('forwards the default provider (throughput + fallbacks) config to the SDK', async () => {
        const { send } = fakeSdk({ stream: [] });
        const client = createOpenRouterClient({
            apiKey: 'k',
            provider: { sort: 'throughput', preferred_min_throughput: 60, allow_fallbacks: true },
            sdk: { chat: { send } },
        });
        await client.chat.send!({
            model: 'm',
            messages: [{ role: 'user', content: 'hi' }],
            stream: true,
        });
        const request = send.mock.calls[0]?.[0] as { chatRequest: { provider?: unknown } };
        expect(request.chatRequest.provider).toEqual({
            sort: 'throughput',
            preferred_min_throughput: 60,
            allow_fallbacks: true,
        });
    });

    it('a per-request provider overrides the default', async () => {
        const { send } = fakeSdk({ stream: [] });
        const client = createOpenRouterClient({
            apiKey: 'k',
            provider: { sort: 'price' },
            sdk: { chat: { send } },
        });
        await client.chat.send!({
            model: 'm',
            messages: [{ role: 'user', content: 'hi' }],
            stream: true,
            provider: { sort: 'latency' },
        });
        const request = send.mock.calls[0]?.[0] as { chatRequest: { provider?: unknown } };
        expect(request.chatRequest.provider).toEqual({ sort: 'latency' });
    });
});

describe('createOpenRouterClient — error handling', () => {
    it('normalizes a 429 (too many requests) error for retry/backoff', async () => {
        const statusErr = new Error('rate limited') as Error & { statusCode: number };
        statusErr.statusCode = 429;
        const { send } = fakeSdk({ error: statusErr });
        const client = createOpenRouterClient({ apiKey: 'k', sdk: { chat: { send } } });
        await expect(
            client.chat.send!({ model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true }),
        ).rejects.toMatchObject({ statusCode: 429 });
    });
});