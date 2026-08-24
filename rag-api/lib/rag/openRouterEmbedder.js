/**
 * OpenRouter HTTP embedder adapter — real provider wiring for runtime.
 *
 * Domain 4 / Domain 5 seam. Both the seed Job and the query-time retrieval need
 * to compute `openai/text-embedding-3-small` vectors from OpenRouter. This is
 * the production adapter that replaces the test/injected stubs. It uses Node's
 * built-in `fetch` (Node >= 20), so **no new runtime dependency** is added.
 *
 * Contract it satisfies (used by `retriever.js` / `seeder.js`):
 *     embed(text: string)                       -> number[]
 *     embedBatch?(texts: string[], opts?)       -> number[][]   (seed, batched)
 */

/** Model + dimensions are the locked choices for the demo corpus. */
export const EMBED_MODEL = 'openai/text-embedding-3-small';
export const EMBED_DIMS = 1536;

/**
 * Creates an OpenRouter embedding adapter.
 *
 * @param {object} opts
 * @param {string} opts.apiKey       OpenRouter API key (Secret Manager at runtime).
 * @param {string} [opts.model]      model id (default EMBED_MODEL).
 * @param {string} [opts.baseUrl]    default OpenRouter API base.
 * @param {number} [opts.timeoutMs]  per-request timeout (default 30_000).
 * @returns {{
 *   embed: (text: string, opts?: { model?: string }) => Promise<number[]>,
 *   embedBatch: (texts: Array<string>, opts?: object) => Promise<number[][]>,
 *   model: string,
 *   dimensions: number,
 * }}
 */
export function createOpenRouterEmbedder({
  apiKey,
  model = EMBED_MODEL,
  baseUrl = 'https://openrouter.ai/api/v1',
  timeoutMs = 30_000,
}) {
  if (!apiKey) throw new Error('OpenRouterEmbedder: apiKey is required');

  /**
   * POST /embeddings with an array input (batched call per spec).
   * @param {string[]} texts
   * @param {object} [options]
   * @param {string} [options.model]
   * @param {number} [options.dimensions]
   * @returns {Promise<number[][]>} one embedding per input text.
   */
  async function request(texts, { model: m = model, dimensions = EMBED_DIMS } = {}) {
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
        let body;
        try { body = await res.text(); } catch { body = ''; }
        // Enrich the Error with the OpenRouter status for retry/backoff logic
        // (the same `.statusCode`/`.retryable` shape the chat bridge uses).
        const err = /** @type {Error & { statusCode?: number, retryable?: boolean }} */ (new Error(`OpenRouter embeddings HTTP ${status}: ${body.slice(0, 200)}`));
        err.statusCode = status;
        err.retryable = status === 429 || status >= 500;
        throw err;
      }
      // OpenRouter returns `{ data: [{ embedding: number[] }, ...] }`.
      const payload = /** @type {{ data?: Array<{ embedding?: number[] }> }} */ (await res.json());
      const data = payload.data;
      return Array.isArray(data) ? data.map((d) => d.embedding ?? []) : [];
    } finally {
      clearTimeout(t);
    }
  }

  return {
    /** Single-text embed (used by the retrieval path). */
    embed: async (text) => {
      const [vec] = await request([String(text)]);
      if (!vec) throw new Error('OpenRouterEmbedder: empty embedding response');
      return vec;
    },
    /** Batched embed (used by the seed job — one call per batch per spec). */
    embedBatch: (texts, opts) => request(Array.isArray(texts) ? texts : [texts], opts),
    model,
    dimensions: EMBED_DIMS,
  };
}