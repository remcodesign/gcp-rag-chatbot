/**
 * Chat type-set — the client-side store state machine, transport, and their
 * dependency contracts (Domain 6, Steps 6.1–6.4). No `any`; everything is
 * strongly typed and flows from SSE -> store -> UI.
 */

import type { Citation, Source, SseFrame } from './sse';
import type { RawTrace } from './trace';

/** Client-side lifecycle status. */
export type ChatStatus = 'idle' | 'streaming' | 'done' | 'error';

/** Backend progress stage keys (mirrors `rag-api/lib/generate/generator.ts`). */
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

/** A structured error surfaced to the UI (from the SSE `error` event). */
export interface ChatError {
    message: string;
    /** Raw `error.detail` from the backend (normalized provider error). */
    detail?: unknown;
}

/**
 * One completed turn bubble in the WhatsApp-style transcript. `role` picks the
 * layout: my messages are right-aligned bubbles, assistant replies are
 * full-width without a bubble.
 */
export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    /** epoch ms when the message was completed/sent. */
    createdAt: number;
    /** Resolved sources cited by an assistant reply (empty for user messages). */
    sources: Source[];
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
    error: ChatError | null;
    lastEventId: number | null;
    retryCount: number;
    /** Completed conversation transcript (my messages + assistant replies). */
    messages: ConversationMessage[];
    /** Number of completed assistant turns in this conversation (X in "X / 5"). */
    turnCount: number;
    /** Whether the conversation limit was reached (server sent the end message). */
    conversationEnded: boolean;
}

/** Shape returned by the store factory. */
export interface ChatStore {
    state: ChatState;
    sendMessage(input: { sessionId: string; query: string }): Promise<void>;
    retry(): Promise<void>;
    reset(): void;
}