/**
 * OpenRouter embedder adapter — production provider wiring backed by the
 * official `@openrouter/sdk`.
 *
 * Contract it satisfies (used by `retriever.ts` / the ingest `seeder`):
 *     embed(text: string)                       -> number[]
 *     embedBatch?(texts: string[], opts?)       -> number[][]
 *
 * Domain 99: replaced the hand-rolled `fetch` POST with `openRouter.embeddings.
 * generate(...)` for better maintainability, future-proofing, and structured
 * error handling. The `Embedder` contract is unchanged.
 */

import { OpenRouter } from '@openrouter/sdk';

import type { Embedder } from '../types/rag.js';

export const EMBED_MODEL = 'openai/text-embedding-3-small';
export const EMBED_DIMS = 1536;

interface EmbedderOptions {
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

export interface OpenRouterEmbedder extends Embedder {
    model: string;
    dimensions: number;
}

interface EmbedRequestOptions {
    model?: string;
    dimensions?: number;
}

type ErrorWithStatus = Error & { statusCode?: number; retryable?: boolean };

/** Extracts a normalized `{statusCode, retryable}` from any thrown error. */
function toErrorWithStatus(err: unknown): ErrorWithStatus {
    const candidate = err as { statusCode?: unknown; message?: unknown };
    const status = Number(candidate?.statusCode);
    if (Number.isFinite(status) && status > 0) {
        const normalized: ErrorWithStatus = new Error(
            String(candidate?.message ?? `OpenRouter embeddings error ${status}`),
        );
        normalized.statusCode = status;
        normalized.retryable = status === 429 || status >= 500;
        return normalized;
    }
    return err instanceof Error ? err : new Error(String(err));
}

export function createOpenRouterEmbedder({
    apiKey,
    model = EMBED_MODEL,
    baseUrl = 'https://openrouter.ai/api/v1',
    timeoutMs = 30_000,
    sdk,
}: EmbedderOptions): OpenRouterEmbedder {
    if (!apiKey) throw new Error('OpenRouterEmbedder: apiKey is required');

    // One SDK client per embedder; `serverURL` aligns the base and `timeoutMs`
    // bounds every request (SDK RequestOptions also honor per-call overrides).
    const client =
        sdk ??
        new OpenRouter({
            apiKey,
            ...(baseUrl ? { serverURL: baseUrl } : {}),
            timeoutMs,
        });

    async function request(
        texts: string[],
        { model: m = model, dimensions = EMBED_DIMS }: EmbedRequestOptions = {},
    ): Promise<number[][]> {
        try {
            const response = (await client.embeddings.generate({
                requestBody: {
                    model: m,
                    input: texts,
                    dimensions,
                },
            })) as { data?: Array<{ embedding?: number[] | string }> };
            const data = response?.data;
            if (!Array.isArray(data)) return [];
            return data.map((d) => (Array.isArray(d.embedding) ? d.embedding : []));
        } catch (err) {
            throw toErrorWithStatus(err);
        }
    }

    return {
        embed: async (text: string) => {
            const [vec] = await request([String(text)]);
            if (!vec) throw new Error('OpenRouterEmbedder: empty embedding response');
            return vec;
        },
        embedBatch: (texts: string[], opts?: EmbedRequestOptions) =>
            request(Array.isArray(texts) ? texts : [texts], opts),
        model,
        dimensions: EMBED_DIMS,
    };
}