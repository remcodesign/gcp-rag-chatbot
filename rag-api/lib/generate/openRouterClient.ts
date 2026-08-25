/**
 * OpenRouter chat provider adapter — a standalone factory so other providers
 * (Anthropic, Gemini, local OSS, …) can be added later behind the same
 * `ChatProvider` shape.
 *
 * Domain 99: replaced the hand-rolled `fetch` + SSE stream with the official
 * `@openrouter/sdk`. The SDK's `chat.send({ chatRequest })` handles auth, the
 * `provider` routing config, typed errors, and streaming for us. The factory
 * still returns the shape `createChatBridge` expects:
 * `{ chat: { send(params) -> AsyncIterable<ChatStreamChunk> } }`.
 */

import { OpenRouter } from '@openrouter/sdk';

import type { ChatParams, ChatProvider, ChatStream, ChatStreamChunk } from '../types/chat.js';

export interface OpenRouterClientOptions {
  apiKey: string;
  base?: string;
  /**
   * Default OpenRouter `provider` routing config, merged into every request
   * unless the caller supplies its own. Biases toward fast, reliable routes
   * with automatic fallback.
   */
  provider?: Record<string, unknown>;
  /**
   * Inject a pre-built SDK client (for tests). Defaults to a real `OpenRouter`
   * instance. The injected value only needs the surface we call:
   * `chat.send({ chatRequest }) -> async-iterable`.
   */
  sdk?: { chat: { send(params: unknown): Promise<unknown> } };
}

/**
 * Bridges the SDK's streaming chunk (camelCase `finishReason`) into the app's
 * `ChatStreamChunk` shape (`finish_reason`), exposing only the fields the
 * generator's `readDelta` consumes, plus the final `usage` chunk (tokens/cost).
 */
async function *adaptSdkStream(
  sdkStream: AsyncIterable<{
    choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      cost?: number | null;
    } | null;
  }>,
): AsyncGenerator<ChatStreamChunk> {
  for await (const chunk of sdkStream) {
    const choice = chunk.choices?.[0];
    const usage = chunk.usage;
    yield {
      choices: [
        {
          delta: { content: choice?.delta?.content ?? '' },
          finish_reason: choice?.finish_reason ?? null,
        },
      ],
      // OpenRouter returns a token-usage "info chunk" (no content choice)
      // alongside the final content chunk; the SDK parses it to camelCase.
      ...(usage
        ? {
            usage: {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              cost: usage.cost ?? null,
            },
          }
        : {}),
    };
  }
}

/**
 * Builds an OpenRouter chat client backed by the official SDK.
 *
 * @param options API key + optional base URL + default provider routing config.
 * @returns a `{ chat }` provider adapter.
 */
export function createOpenRouterClient({
  apiKey,
  base,
  provider,
  sdk,
}: OpenRouterClientOptions): { chat: ChatProvider } {
  const client =
    sdk ??
    new OpenRouter({
      apiKey,
      ...(base ? { serverURL: base } : {}),
    });

  return {
    chat: {
      async send(params: ChatParams): Promise<ChatStream> {
        const request = {
          chatRequest: {
            model: params.model ?? undefined,
            messages: params.messages,
            stream: true,
            ...(params.reasoning ? { reasoning: params.reasoning } : {}),
            ...(params.provider ?? provider ? { provider: params.provider ?? provider } : {}),
          },
          ...(params.signal ? { signal: params.signal } : {}),
        };
        const sdkStream = (await client.chat.send(
          request as never,
        )) as AsyncIterable<{
          choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
        }>;
        return adaptSdkStream(sdkStream);
      },
    },
  };
}