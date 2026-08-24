/**
 * OpenRouter chat bridge — streaming chat provider adapter.
 *
 * Domain 5. Wraps an injected provider (`chat.stream` preferred, `chat.send`
 * fallback) so the generator depends only on a `ChatProvider` shape, and
 * normalizes provider errors into a typed `{message, statusCode, retryable}`
 * contract.
 */

import type { ChatMessage, ChatParams, ChatProvider, ChatStream, NormalizedError } from '../types/chat.js';

let _counter = 0;

export function normalizeError(err: unknown): NormalizedError {
  const candidate = err as { message?: unknown; statusCode?: unknown };
  if (candidate && candidate.statusCode != null) {
    const status = Number(candidate.statusCode);
    return {
      message: String(candidate.message || `OpenRouter error ${status}`),
      statusCode: status,
      retryable: status === 429 || status >= 500,
    };
  }
  const msg =
    candidate && typeof candidate.message === 'string'
      ? candidate.message
      : String(err);
  return { message: msg, statusCode: null, retryable: true, unstructured: true };
}

interface ChatBridgeDeps {
  chat: ChatProvider;
}

interface ChatBridgeOptions {
  model?: string;
  requestId?: () => string;
}

export interface StreamReplyInput {
  messages: ChatMessage[];
  model?: string | null;
  signal?: AbortSignal;
}

export interface ChatBridge {
  streamReply(input: StreamReplyInput): Promise<{
    requestId: string;
    model?: string | null;
    stream: ChatStream;
  }>;
  normalizeError(err: unknown): NormalizedError;
}

export function createChatBridge(deps: ChatBridgeDeps, options: ChatBridgeOptions = {}): ChatBridge {
  const model = options.model;
  const requestId = options.requestId ?? (() => `gen-${++_counter}`);

  async function requestParams({
    messages,
    model: m,
    signal,
  }: StreamReplyInput): Promise<ChatParams> {
    return {
      model: m ?? model,
      messages,
      stream: true,
      ...(signal ? { signal } : {}),
    };
  }

  async function streamReply(input: StreamReplyInput = { messages: [] }): Promise<{
    requestId: string;
    model?: string | null;
    stream: ChatStream;
  }> {
    const params = await requestParams(input);
    const id = requestId();
    let stream: ChatStream;
    try {
      const chat = deps.chat;
      stream = typeof chat.stream === 'function'
        ? await chat.stream(params)
        : await chat.send!(params);
    } catch (err) {
      throw normalizeError(err);
    }
    return { requestId: id, stream, model: params.model ?? null };
  }

  return { streamReply, normalizeError };
}