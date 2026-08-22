/**
 * OpenRouter HTTP embedder adapter — production wiring for the seed Job.
 *
 * Domain 4 / Domain 5 seam. The seed Job needs to compute
 * `openai/text-embedding-3-small` vectors from OpenRouter. This is the production
 * adapter that replaces the test/injected stubs. It uses Node's built-in `fetch`
 * (Node >= 20), so **no new runtime dependency** is added.
 *
 * Contract it satisfies (used by `seeder.js` / `orchestrate.js`):
 *     embedBatch?(texts: string[], opts?) -> number[][]   (batched, per spec)
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
 * @returns {{ embedBatch: (texts:string[], opts?) => Promise<number[][]>, model, dimensions }}
 */
export function createOpenRouterEmbedder({
  apiKey,
  model = EMBED_MODEL,
  baseUrl = 'https://openrouter.ai/api/v1',
  timeoutMs = 30_000,
}) {
  if (!apiKey) throw new Error('OpenRouterEmbedder: apiKey is required');

  /** POST /embeddings with an array input (batched call per spec). */
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
        const err = new Error(`OpenRouter embeddings HTTP ${status}: ${body.slice(0, 200)}`);
        err.statusCode = status;
        err.retryable = status === 429 || status >= 500;
        throw err;
      }
      const data = await res.json();
      // data.data[] each have `.embedding` (float array length = dimensions).
      return Array.isArray(data.data) ? data.data.map((d) => d.embedding) : [];
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
    embed: async (input) => {
      const isArray = Array.isArray(input);
      const texts = isArray ? input : [String(input)];
      const vectors = await request(texts);
      return isArray ? vectors : vectors[0];
    },
    model,
    dimensions: EMBED_DIMS,
  };
}