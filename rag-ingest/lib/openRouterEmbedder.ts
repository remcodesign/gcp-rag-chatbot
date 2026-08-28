/**
 * OpenRouter embedder adapter — production wiring for the seed Job.
 *
 * Domain 4 / Domain 5 seam. The seed Job needs to compute
 * `openai/text-embedding-3-small` vectors from OpenRouter. This is the production
 * adapter that replaces the test/injected stubs. It is backed by the official
 * `@openrouter/sdk` (Domain 99) for better maintainability, future-proofing, and
 * structured error handling.
 */

import { OpenRouter } from '@openrouter/sdk';

import type { Embedder } from './types/embedder.js';

/** Model + dimensions are the locked choices for the demo corpus. */
export const EMBED_MODEL = 'openai/text-embedding-3-small';
export const EMBED_DIMS = 1536;

export interface OpenRouterEmbedderOptions {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    timeoutMs?: number;
    /**
     * Inject a pre-built SDK client (for tests). Defaults to a real `OpenRouter`
     * instance. Only the `embeddings.generate` surface is called.
     */
    sdk?: { embeddings: { generate(request: unknown): Promise<unknown> } };
}

type EmbeddingError = Error & { statusCode?: number; retryable?: boolean };

/** Extracts a normalized `{statusCode, retryable}` from any thrown error. */
function toEmbeddingError(err: unknown): EmbeddingError {
    const candidate = err as { statusCode?: unknown; message?: unknown };
    const status = Number(candidate?.statusCode);
    if (Number.isFinite(status) && status > 0) {
        const normalized = new Error(
            String(candidate?.message ?? `OpenRouter embeddings error ${status}`),
        ) as EmbeddingError;
        normalized.statusCode = status;
        normalized.retryable = status === 429 || status >= 500;
        return normalized;
    }
    return err instanceof Error ? err : new Error(String(err));
}

/**
 * Creates an OpenRouter embedding adapter.
 * @param opts `{ apiKey, model?, baseUrl?, timeoutMs? }`.
 * @returns an `Embedder` surface: `embed(input)` + `model` + `dimensions`.
 */
export function createOpenRouterEmbedder({
    apiKey,
    model = EMBED_MODEL,
    baseUrl = 'https://openrouter.ai/api/v1',
    timeoutMs = 30_000,
    sdk,
}: OpenRouterEmbedderOptions): Embedder {
    if (!apiKey) throw new Error('OpenRouterEmbedder: apiKey is required');

    const client =
        sdk ??
        new OpenRouter({
            apiKey,
            ...(baseUrl ? { serverURL: baseUrl } : {}),
            timeoutMs,
        });

    /** POST /embeddings with an array input (batched call per spec). */
    async function request(
        texts: string[],
        req: { model?: string; dimensions?: number } = {},
    ): Promise<number[][]> {
        try {
            const response = (await client.embeddings.generate({
                requestBody: {
                    model: req.model ?? model,
                    input: texts,
                    dimensions: req.dimensions ?? EMBED_DIMS,
                },
            })) as { data?: Array<{ embedding?: number[] | string }> };
            const data = response?.data;
            if (!Array.isArray(data)) return [];
            return data.map((d) => (Array.isArray(d.embedding) ? d.embedding : []));
        } catch (err) {
            throw toEmbeddingError(err);
        }
    }

    return {
        /**
         * Embeds one or many texts. Matches the seeder contract:
         *   - `embed(text: string)`        -> number[]
         *   - `embed(texts: string[])`     -> number[][]
         * One batched HTTP call for the array form (per spec).
         */
        embed: async (input: string | string[]): Promise<number[] | number[][]> => {
            const isArray = Array.isArray(input);
            const texts = isArray ? input : [String(input)];
            const vectors = await request(texts);
            return isArray ? vectors : (vectors[0] ?? []);
        },
        model,
        dimensions: EMBED_DIMS,
    };
}