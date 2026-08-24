/**
 * OpenRouter HTTP embedder adapter — production wiring for the seed Job.
 *
 * Domain 4 / Domain 5 seam. The seed Job needs to compute
 * `openai/text-embedding-3-small` vectors from OpenRouter. This is the production
 * adapter that replaces the test/injected stubs. It uses Node's built-in `fetch`
 * (Node >= 20), so **no new runtime dependency** is added.
 */

import type { Embedder } from './types/embedder.js';

/** Model + dimensions are the locked choices for the demo corpus. */
export const EMBED_MODEL = 'openai/text-embedding-3-small';
export const EMBED_DIMS = 1536;

export interface OpenRouterEmbedderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

type EmbeddingError = Error & { statusCode?: number; retryable?: boolean };

interface EmbeddingsPayload {
  data?: Array<{ embedding?: number[] }>;
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
}: OpenRouterEmbedderOptions): Embedder {
  if (!apiKey) throw new Error('OpenRouterEmbedder: apiKey is required');

  /** POST /embeddings with an array input (batched call per spec). */
  async function request(
    texts: string[],
    req: { model?: string; dimensions?: number } = {},
  ): Promise<number[][]> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: req.model ?? model, input: texts, dimensions: req.dimensions ?? EMBED_DIMS }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const status = res.status;
        let body: string;
        try {
          body = await res.text();
        } catch {
          body = '';
        }
        // Enrich the Error with the OpenRouter status for retry/backoff logic
        // (the same `.statusCode`/`.retryable` shape the chat bridge uses).
        const err = new Error(`OpenRouter embeddings HTTP ${status}: ${body.slice(0, 200)}`) as EmbeddingError;
        err.statusCode = status;
        err.retryable = status === 429 || status >= 500;
        throw err;
      }
      // OpenRouter returns `{ data: [{ embedding: number[] }, ...] }`.
      const payload = (await res.json()) as EmbeddingsPayload;
      const data = payload.data;
      return Array.isArray(data) ? data.map((d) => d.embedding ?? []) : [];
    } finally {
      clearTimeout(t);
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