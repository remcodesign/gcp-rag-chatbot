/**
 * Chat / SSE / generator provider contracts (Domain 5).
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  /** OpenRouter token usage, present on the final (usage) chunk of a stream. */
  usage?: TokenUsage | null;
}

/** OpenRouter token usage stats (from the SDK's `ChatUsage` shape). */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Cost in USD for the request, when reported by OpenRouter. */
  cost?: number | null;
}

export interface ChatStream {
  [Symbol.asyncIterator](): AsyncIterableIterator<ChatStreamChunk>;
}

export interface ChatParams {
  model?: string | null;
  messages: ChatMessage[];
  stream: boolean;
  signal?: AbortSignal;
  /** OpenRouter `reasoning` override (e.g. `{ effort: 'none' }` to disable thinking). */
  reasoning?: Record<string, unknown>;
  /** OpenRouter `provider` routing config (e.g. throughput sorting + fallbacks). */
  provider?: Record<string, unknown>;
}

export interface ChatProvider {
  send?(params: ChatParams): Promise<ChatStream>;
  stream?(params: ChatParams): Promise<ChatStream>;
}

export interface ChatResponse {
  requestId: string;
  model: string | null;
  stream: ChatStream;
}

export interface NormalizedError {
  message: string;
  statusCode: number | null;
  retryable: boolean;
  unstructured?: boolean;
}

export interface DeltaReader {
  (chunk: ChatStreamChunk | null | undefined, options?: { delta?: string }): string;
}

export interface AppLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}