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
}

export interface ChatStream {
  [Symbol.asyncIterator](): AsyncIterableIterator<ChatStreamChunk>;
}

export interface ChatParams {
  model?: string | null;
  messages: ChatMessage[];
  stream: boolean;
  signal?: AbortSignal;
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