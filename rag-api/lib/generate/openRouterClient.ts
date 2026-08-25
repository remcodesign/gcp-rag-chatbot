/**
 * OpenRouter chat provider adapter — a standalone factory so other providers
 * (Anthropic, Gemini, local OSS, …) can be added later behind the same
 * `ChatProvider` shape.
 *
 * Uses Node's built-in `fetch` + streaming (no SDK dependency) for a zero-deps,
 * Cloud Run-friendly footprint. The unified OpenRouter `reasoning` parameter is
 * forwarded when present; when omitted the model keeps its native behavior.
 *
 * The factory returns the shape `createChatBridge` expects:
 * `{ chat: { send(params) -> AsyncIterable<ChatStreamChunk> } }`.
 */

import type { ChatParams, ChatProvider, ChatStream, ChatStreamChunk } from '../types/chat.js';

/** Error with the OpenRouter HTTP status + retryable classification. */
type ProviderError = Error & { statusCode?: number; retryable?: boolean };

export interface OpenRouterClientOptions {
  apiKey: string;
  base?: string;
  /**
   * Default OpenRouter `provider` routing config, merged into every request
   * unless the caller supplies its own. Biases toward fast, reliable routes
   * with automatic fallback.
   */
  provider?: Record<string, unknown>;
}

/**
 * Builds an OpenRouter chat client backed by Node fetch + streaming.
 *
 * @param options API key + optional base URL + default provider routing config.
 * @returns a `{ chat }` provider adapter.
 */
export function createOpenRouterClient({
  apiKey,
  base,
  provider,
}: OpenRouterClientOptions): { chat: ChatProvider } {
  const baseUrl = base ?? 'https://openrouter.ai/api/v1';
  return {
    chat: {
      async send(params: ChatParams): Promise<ChatStream> {
        const controller = new AbortController();
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: params.model,
            messages: params.messages,
            stream: true,
            ...(params.reasoning ? { reasoning: params.reasoning } : {}),
            ...(params.provider ?? provider ? { provider: params.provider ?? provider } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const status = res.status;
          const err: ProviderError = new Error(`OpenRouter chat HTTP ${status}`);
          err.statusCode = status;
          err.retryable = status === 429 || status >= 500;
          throw err;
        }
        return readSseStream(res.body, controller);
      },
    },
  };
}

/**
 * Reads an SSE body from the OpenRouter streaming response and yields openai-
 * style chunks `{ choices:[{ delta:{content}, finish_reason }] }`.
 */
export async function *readSseStream(
  body: ReadableStream<Uint8Array> | null,
  controller: AbortController,
): AsyncGenerator<ChatStreamChunk> {
  try {
    const decoder = new TextDecoder();
    let buffer = '';
    const reader = body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = -1;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = block.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data) as ChatStreamChunk;
          } catch {
            // skip malformed
          }
        }
      }
    }
  } finally {
    controller.abort();
  }
}