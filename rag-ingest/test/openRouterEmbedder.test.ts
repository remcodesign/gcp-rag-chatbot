import { describe, it, expect, vi } from 'vitest';
import { createOpenRouterEmbedder, EMBED_MODEL, EMBED_DIMS } from '../lib/openRouterEmbedder.js';

/** A minimal fake `@openrouter/sdk` embeddings client that records requests. */
function fakeSdk(
    overrides: { result?: { data?: Array<{ embedding?: number[] | string }> }; error?: Error } = {},
) {
    const generate = vi.fn(async (_request: unknown) => {
        if (overrides.error) throw overrides.error;
        return overrides.result ?? { data: [] };
    });
    return { embeddings: { generate }, generate };
}

describe('rag-ingest openRouterEmbedder — happy path', () => {
    it('embeds a single string into a vector', async () => {
        const { generate } = fakeSdk({ result: { data: [{ embedding: [0.1] }] } });
        const embedder = createOpenRouterEmbedder({
            apiKey: 'k',
            sdk: { embeddings: { generate } },
        });
        const vec = await embedder.embed('hello');
        expect(vec).toEqual([0.1]);
        const request = generate.mock.calls[0]?.[0] as unknown as {
            requestBody: { model: string; input: string[]; dimensions: number };
        };
        expect(request.requestBody.model).toBe(EMBED_MODEL);
        expect(request.requestBody.input).toEqual(['hello']);
        expect(request.requestBody.dimensions).toBe(EMBED_DIMS);
    });

    it('embeds an array of strings as one batched call', async () => {
        const { generate } = fakeSdk({
            result: { data: [{ embedding: [0.1] }, { embedding: [0.2] }] },
        });
        const embedder = createOpenRouterEmbedder({
            apiKey: 'k',
            sdk: { embeddings: { generate } },
        });
        const vecs = await embedder.embed(['a', 'b']);
        expect(vecs).toEqual([[0.1], [0.2]]);
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it('exposes model + dimensions', () => {
        const embedder = createOpenRouterEmbedder({ apiKey: 'k', sdk: fakeSdk() });
        expect(embedder.model).toBe(EMBED_MODEL);
        expect(embedder.dimensions).toBe(EMBED_DIMS);
    });
});

describe('rag-ingest openRouterEmbedder — non-happy path', () => {
    it('maps a 429 SDK error to statusCode + retryable', async () => {
        const statusErr = new Error('rate limited') as Error & { statusCode: number };
        statusErr.statusCode = 429;
        const embedder = createOpenRouterEmbedder({
            apiKey: 'k',
            sdk: { embeddings: { generate: fakeSdk({ error: statusErr }).generate } },
        });
        await expect(embedder.embed('x')).rejects.toMatchObject({
            statusCode: 429,
            retryable: true,
        });
    });

    it('maps a 4xx SDK error to non-retryable', async () => {
        const statusErr = new Error('validation') as Error & { statusCode: number };
        statusErr.statusCode = 400;
        const embedder = createOpenRouterEmbedder({
            apiKey: 'k',
            sdk: { embeddings: { generate: fakeSdk({ error: statusErr }).generate } },
        });
        await expect(embedder.embed('x')).rejects.toMatchObject({
            statusCode: 400,
            retryable: false,
        });
    });

    it('returns an empty vectors list when the SDK returns no data (batch path)', async () => {
        const embedder = createOpenRouterEmbedder({ apiKey: 'k', sdk: fakeSdk() });
        const vecs = await embedder.embed(['a']);
        // single-string path throws on empty; array path returns an empty list
        expect(vecs).toEqual([]);
    });
});
