/**
 * SSE type-set — the wire protocol between rag-api and the chat UI (Domain 5/6).
 *
 * The backend streams typed Server-Sent Events (`progress`, `token`, `error`,
 * `done`, plus the POC `trace`), each with a monotonic `id`. The parser turns a
 * raw text buffer into these frames; the store routes them by `event`.
 */

/** The event types the backend can emit (defaults to `message` when omitted). */
export type SseEvent = 'message' | 'progress' | 'token' | 'done' | 'trace' | 'error';

/** A single parsed SSE frame. `data` is JSON-parsed when possible, else kept raw. */
export interface SseFrame {
    id: number | null;
    event: SseEvent;
    data: unknown;
}

/** `progress` payload — advances the status indicator (never regresses). */
export interface SseProgress {
    stage: string;
    progress: number;
    note?: string;
}

/** `token` payload — a text delta plus the running validated citation list. */
export interface SseToken {
    text: string;
    citations: Citation[];
}

/** `done` payload — the final source list plus citations. */
export interface SseDone {
    sources: Source[];
    citations: Citation[];
    /** Set when the backend ended the session at the conversation limit. */
    limitReached?: boolean;
}

/** `error` payload — a terminal stream message. */
export interface SseError {
    message: string;
    detail?: unknown;
}

/** A source citation referenced by an inline `[Source N]` marker. */
export interface Citation {
    n: number;
    title: string;
}

/** A resolved source (carried to the UI for chips / the chunk modal). */
export interface Source {
    n: number;
    title: string;
    url: string | null;
    id: string;
    text?: string;
}
