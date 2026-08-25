/**
 * Chat type-set — the client-side store state machine, transport, and their
 * dependency contracts (Domain 6, Steps 6.1–6.4). No `any`; everything is
 * strongly typed and flows from SSE -> store -> UI.
 */

import type { Citation, Source, SseFrame } from './sse';
import type { RawTrace } from './trace';

/** Client-side lifecycle status. */
export type ChatStatus = 'idle' | 'streaming' | 'done' | 'error';

/** Backend progress stage keys (mirrors `rag-api/lib/generate/generator.js`). */
export type ProgressStage = 'retrieval' | 'rerank' | 'generation' | 'generating';

/** A parsed frame yielded by the SSE transport to the store. */
export type ParsedFrame = SseFrame;

/** Parameters the store passes to the injected `send` transport. */
export interface SendParams {
  sessionId: string;
  query: string;
  lastEventId: number | null;
  signal: AbortSignal;
  trace?: boolean;
}

/** The `send` transport contract (injected for unit tests). */
export type SendTransport = (params: SendParams) => AsyncIterable<string>;

/** SSE parser contract injectable into the store. */
export interface SseParser {
  parseSse(buffer: string): { frames: SseFrame[]; rest: string };
}

/** Options accepted by the chat store. */
export interface ChatStoreOptions {
  maxRetries?: number;
  retryBaseMs?: number;
  trace?: boolean;
}

/** The reactive chat state exposed to the UI. */
export interface ChatState {
  status: ChatStatus;
  stage: ProgressStage | null;
  progress: number;
  answer: string;
  citations: Citation[];
  sources: Source[];
  trace: RawTrace | null;
  error: string | null;
  lastEventId: number | null;
  retryCount: number;
}

/** Shape returned by the store factory. */
export interface ChatStore {
  state: ChatState;
  sendMessage(input: { sessionId: string; query: string }): Promise<void>;
  retry(): Promise<void>;
  reset(): void;
}

/** A token delta delivered by a `token` frame. */
export interface TokenEvent {
  text: string;
  citations: Citation[];
}

/** A `progress` event payload. */
export interface ProgressEvent {
  stage: ProgressStage;
  progress: number;
}