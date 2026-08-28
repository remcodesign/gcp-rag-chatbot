import { describe, it, expect, vi } from 'vitest';
import {
    createOpenRouterEmbedder,
    EMBED_MODEL,
    EMBED_DIMS,
} from '../../lib/rag/openRouterEmbedder.js';

type SdkEmbeddingsResponse = { data?: Array<{ embedding?: number[] | string }> };

/** A minimal fake `@openrouter/sdk` embeddings client that records requests. */
function fakeSdk(overrides: { result?: SdkEmbeddingsResponse; error?: Error } = {}) {
    const generate = vi.fn(async (_request: unknown) => {
        if (overrides.error) throw overrides.error;
        return overrides.result ?? { data: [] };
    });
    return { embeddings: { generate }, generate };
}

describe('createOpenRouterEmbedder — happy path', () => {
    it('embeds a single text into a vector', async () => {
        const { generate } = fakeSdk({ result: { data: [{ embedding: [0.1, 0.2, 0.3] }] } });
        const embedder = createOpenRouterEmbedder({
            apiKey: 'k',
            sdk: { embeddings: { generate } },
        });
        const vec = await embedder.embed('hello');
        expect(vec).toEqual([0.1, 0.2, 0.3]);
        const request = generate.mock.calls[0]?.[0] as unknown as {
            requestBody: { model: string; input: string[]; dimensions: number };
        };
        expect(request.requestBody.model).toBe(EMBED_MODEL);
        expect(request.requestBody.input).toEqual(['hello']);
        expect(request.requestBody.dimensions).toBe(EMBED_DIMS);
    });

    it('embeds a batch of texts (one call)', async () => {
        const { generate } = fakeSdk({
            result: { data: [{ embedding: [0.1] }, { embedding: [0.2] }] },
        });
        const embedder = createOpenRouterEmbedder({
            apiKey: 'k',
            sdk: { embeddings: { generate } },
        });
        const vecs = await embedder.embedBatch!(['a', 'b']);
        expect(vecs).toEqual([[0.1], [0.2]]);
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it('exposes model + dimensions', () => {
        const embedder = createOpenRouterEmbedder({ apiKey: 'k', sdk: fakeSdk() });
        expect(embedder.model).toBe(EMBED_MODEL);
        expect(embedder.dimensions).toBe(EMBED_DIMS);
    });
});

describe('createOpenRouterEmbedder — non-happy path', () => {
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

    it('throws when the SDK returns no data', async () => {
        const embedder = createOpenRouterEmbedder({ apiKey: 'k', sdk: fakeSdk() });
        await expect(embedder.embed('x')).rejects.toThrow('empty embedding response');
    });
});
