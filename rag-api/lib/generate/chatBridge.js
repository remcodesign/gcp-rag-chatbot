/**
 * OpenRouter chat adapter — Domain 5, Step 5.2.
 *
 * Thin, dependency-free wrapper around the streaming chat call. Applying the
 * project's injection pattern, the *real* `@openrouter/sdk` client is not a
 * hard dependency here: the factory accepts any object with a
 * `chat.send(params)` method (an async iterable producer). At runtime you wire
 * the real SDK; in tests you inject a fake async generator. This keeps Domain 5
 * testable with zero cloud deps and no new runtime dependency.
 *
 * The real SDK usage this mirrors (see `@openrouter/sdk` via Context7):
 *
 * ```js
 * const client = new OpenRouter({ apiKey });
 * const stream = await client.chat.send({ model, messages, stream: true });
 * for await (const chunk of stream) chunk.choices[0].delta.content
 * ```
 *
 * Errors: the SDK surfaces provider/HTTP failures as errors with a `statusCode`
 * (e.g. the `OpenRouterError` type). `wrapperError` normalizes ANY thrown value
 * into `{ message, statusCode?, retryable }` so the stream loop can branch on it.
 */

let _counter = 0;

/** Normalizes an unknown thrown error into a small, safe shape for logging/retry. */
export function normalizeError(err) {
  if (err && err.statusCode != null) {
    const status = Number(err.statusCode);
    return {
      message: err.message || `OpenRouter error ${status}`,
      statusCode: status,
      retryable: status === 429 || status >= 500,
    };
  }
  const msg = err && err.message ? err.message : String(err);
  return { message: msg, statusCode: null, retryable: true, unstructured: true };
}

/**
 * Creates a streaming chat bridge.
 *
 * @param {object} deps
 * @param {object} deps.chat  must expose `chat.stream(params)` returning an async iterable, OR
 *   `chat.send(params)` that returns an async iterable when `params.stream` is true.
 * @param {object} [options]
 * @param {string} [options.model]  default model id (overridable per request).
 * @param {() => object} [options.requestId]  correlation id factory (for logging).
 * @returns {{
 *   streamReply: (args: { messages: Array<object>, model?: string, signal?: AbortSignal }) =>
 *     Promise<{ requestId: object, stream: AsyncIterable<object>, model?: string }>,
 *   normalizeError: (err: unknown) => { message: string, statusCode: number|null, retryable: boolean },
 * }}
 */
export function createChatBridge(deps, options = {}) {
  const model = options.model;
  const requestId = options.requestId ?? (() => `gen-${++_counter}`);

  /**
   * @param {object} args
   * @param {Array<object>} args.messages
   * @param {string} [args.model]
   * @param {AbortSignal} [args.signal]
   */
  async function requestParams({ messages, model: m, signal }) {
    return {
      model: m ?? model,
      messages,
      stream: true,
      ...(signal ? { signal } : {}),
    };
  }

  /**
   * Opens a streaming reply for the given messages.
   *
   * @param {object} [args]
   * @param {Array<object>} [args.messages]  chat messages.
   * @param {string} [args.model]  per-request model override.
   * @param {AbortSignal} [args.signal]  optional abort signal.
   * @returns {Promise<{ requestId: object, stream: AsyncIterable<object>, model?: string }>} where `stream` is a `for await`-able
   *   async iterable of raw chunks. Throws a normalized error if the request cannot
   *   be opened; streamed errors are thrown from inside the iterator instead.
   */
  async function streamReply({ messages, model: modelOverride, signal } = {}) {
    const params = await requestParams({ messages, model: modelOverride, signal });
    const id = requestId();
    let stream;
    try {
      // Try a dedicated `stream` method, then fall back to `send` with stream:true.
      const chat = deps.chat;
      stream = typeof chat.stream === 'function'
        ? await chat.stream(params)
        : await chat.send(params);
    } catch (err) {
      throw normalizeError(err);
    }
    return { requestId: id, stream, model: params.model };
  }

  return { streamReply, normalizeError };
}