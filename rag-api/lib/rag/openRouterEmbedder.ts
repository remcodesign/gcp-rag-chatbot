/**
 * OpenRouter HTTP embedder adapter — production provider wiring.
 *
 * Contract it satisfies (used by `retriever.ts` / the ingest `seeder`):
 *     embed(text: string)                       -> number[]
 *     embedBatch?(texts: string[], opts?)       -> number[][]
 */

import type { Embedder } from '../types/rag.js';

export const EMBED_MODEL = 'openai/text-embedding-3-small';
export const EMBED_DIMS = 1536;

interface EmbedderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface OpenRouterEmbedder extends Embedder {
  model: string;
  dimensions: number;
}

interface EmbedRequestOptions {
  model?: string;
  dimensions?: number;
}

interface EmbedResponsePayload {
  data?: Array<{ embedding?: number[] }>;
}

type ErrorWithStatus = Error & { statusCode?: number; retryable?: boolean };

export function createOpenRouterEmbedder({
  apiKey,
  model = EMBED_MODEL,
  baseUrl = 'https://openrouter.ai/api/v1',
  timeoutMs = 30_000,
}: EmbedderOptions): OpenRouterEmbedder {
  if (!apiKey) throw new Error('OpenRouterEmbedder: apiKey is required');

  async function request(
    texts: string[],
    { model: m = model, dimensions = EMBED_DIMS }: EmbedRequestOptions = {},
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
        body: JSON.stringify({ model: m, input: texts, dimensions }),
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
        const err: ErrorWithStatus = new Error(
          `OpenRouter embeddings HTTP ${status}: ${body.slice(0, 200)}`,
        );
        err.statusCode = status;
        err.retryable = status === 429 || status >= 500;
        throw err;
      }
      const payload = (await res.json()) as EmbedResponsePayload;
      const data = payload.data;
      return Array.isArray(data) ? data.map((d) => d.embedding ?? []) : [];
    } finally {
      clearTimeout(t);
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