/**
 * Chat store — Domain 6, Steps 6.1–6.4.
 *
 * Owns the client-side chat state machine and the SSE consumer. It is the
 * frontend counterpart of the backend generator contract
 * (`rag-api/lib/generate/generator.js`).
 *
 * Reconnection (Step 6.3) pairs with the backend's `Last-Event-ID` resume: the
 * store remembers the last event id it saw and sends it back on reconnect so
 * the backend replays from that point (no duplicates, no rewind).
 *
 * The transport is injected (`send`), so this runs in unit tests with a fake
 * async generator — no network, no DOM.
 */

import { reactive } from 'vue';
import { parseSse } from './sseParser';
import type {
  ChatState,
  ChatStore,
  ChatStoreOptions,
  ParsedFrame,
  SendTransport,
  SseParser,
} from '../types/chat';
import type { SseDone, SseError, SseProgress, SseToken } from '../types/sse';
import type { RawTrace } from '../types/trace';

/** Stage labels mirrored from the backend `STAGES`. */
export const STAGES = {
  RETRIEVAL: 'retrieval',
  RERANK: 'rerank',
  GENERATION: 'generation',
  GENERATING: 'generating',
} as const;

/** Human labels for the progress UI (Step 6.2). */
export const STAGE_LABELS: Record<string, string> = Object.freeze({
  [STAGES.RETRIEVAL]: 'Understanding',
  [STAGES.RERANK]: 'Searching',
  [STAGES.GENERATION]: 'Selecting',
  [STAGES.GENERATING]: 'Generating',
});

/** Client-side lifecycle states. */
export const STATUS = {
  IDLE: 'idle',
  STREAMING: 'streaming',
  DONE: 'done',
  ERROR: 'error',
} as const;

/** Status value type derived from the `STATUS` constant. */
export type StatusValue = (typeof STATUS)[keyof typeof STATUS];

const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

/** Default parser: the real SSE parser (a no-op stub here was a silent bug). */
const DEFAULT_PARSER: SseParser = { parseSse };

/**
 * Creates a chat store.
 *
 * @param deps injected dependencies (transport + optional parser).
 * @param options store options.
 */
export function createChatStore(deps: { send: SendTransport; parser?: SseParser }, options: ChatStoreOptions = {}): ChatStore {
  const { send } = deps;
  const parser: SseParser = deps.parser ?? DEFAULT_PARSER;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseMs = options.retryBaseMs ?? RETRY_BASE_MS;
  const traceEnabled = options.trace ?? true;

  // Reactive so the Vue components reading `store.state.*` re-render on every
  // mutation. A plain object here would NOT trigger updates.
  const state = reactive<ChatState>({
    status: 'idle',
    stage: null,
    progress: 0,
    answer: '',
    citations: [],
    sources: [],
    trace: null,
    error: null,
    lastEventId: null,
    retryCount: 0,
  });

  let controller: AbortController | null = null;
  let sessionId = '';
  let query = '';

  /** Reads the current lifecycle status through a function so TS does not
   *  over-narrow `state.status` after it is reassigned. */
  function getStatus(): ChatState['status'] {
    return state.status;
  }

  /** Appends a token delta and merges the running citation list (Step 6.1). */
  function appendToken(payload: SseToken): void {
    // First token -> tokens are flowing; leave "Selecting" and enter "Generating".
    if (payload.text && state.stage !== STAGES.GENERATING) {
      state.stage = STAGES.GENERATING;
    }
    if (payload.text) state.answer += payload.text;
    for (const c of payload.citations ?? []) {
      if (!state.citations.some((x) => x.n === c.n)) state.citations.push(c);
    }
  }

  /** Applies a progress event, never moving the indicator backward (Step 6.2). */
  function applyProgress(ev: SseProgress): void {
    // Once tokens are flowing we are "Generating" — a replayed progress frame
    // (e.g. after a reconnect) must not regress the stage to an earlier one.
    if (ev.stage && state.stage !== STAGES.GENERATING) {
      state.stage = ev.stage as ChatState['stage'];
    }
    if (typeof ev.progress === 'number' && ev.progress >= state.progress) {
      state.progress = ev.progress;
    }
  }

  /** Handles a single parsed frame from the stream. */
  function handleFrame(frame: ParsedFrame): void {
    if (frame.id != null && frame.id !== null) state.lastEventId = frame.id;
    switch (frame.event) {
      case 'progress':
        applyProgress(frame.data as SseProgress);
        break;
      case 'token':
        appendToken(frame.data as SseToken);
        break;
      case 'done':
        state.sources = (frame.data as SseDone).sources ?? [];
        state.status = 'done';
        break;
      case 'trace':
        state.trace = frame.data as RawTrace;
        break;
      case 'error':
        state.error = (frame.data as SseError).message ?? 'generation interrupted';
        state.status = 'error';
        break;
      default:
        break;
    }
  }

  /** Runs one streaming attempt, returning `ok` when a terminal event arrived. */
  async function runStream(): Promise<{ ok: boolean }> {
    controller = new AbortController();
    const iterable = send({
      sessionId,
      query,
      lastEventId: state.lastEventId,
      trace: traceEnabled,
      signal: controller.signal,
    });

    let buffer = '';
    for await (const chunk of iterable) {
      if (controller.signal.aborted) return { ok: false };
      const { frames, rest } = parser.parseSse(buffer + chunk);
      buffer = rest;
      for (const frame of frames) handleFrame(frame);
      if (state.status === 'done' || state.status === 'error') {
        return { ok: state.status === 'done' };
      }
    }
    // Stream ended without a terminal event -> treat as interrupted.
    return { ok: false };
  }

  /** Sends a user message and drives the stream with reconnection (Step 6.3). */
  async function sendMessage({ sessionId: sid, query: q }: { sessionId: string; query: string }): Promise<void> {
    sessionId = sid;
    query = q;
    state.status = 'streaming';
    state.stage = STAGES.RETRIEVAL;
    state.progress = 0;
    state.answer = '';
    state.citations = [];
    state.sources = [];
    state.trace = null;
    state.error = '';
    state.retryCount = 0;
    state.lastEventId = null;

    for (;;) {
      const { ok } = await runStream();
      if (ok) return;
      if (getStatus() === STATUS.ERROR) return; // terminal error surfaced
      if (state.retryCount >= maxRetries) {
        state.status = STATUS.ERROR;
        state.error = 'connection lost — retry manually';
        return;
      }
      state.retryCount += 1;
      await delay(retryBaseMs * 2 ** (state.retryCount - 1));
    }
  }

  /** Manual retry after a terminal error (Step 6.3 non-happy path). */
  async function retry(): Promise<void> {
    if (!sessionId || !query) return;
    state.status = STATUS.STREAMING;
    state.error = '';
    state.retryCount = 0;
    for (;;) {
      const { ok } = await runStream();
      if (ok) return;
      if (getStatus() === STATUS.ERROR) return;
      if (state.retryCount >= maxRetries) {
        state.status = STATUS.ERROR;
        state.error = 'connection lost — retry manually';
        return;
      }
      state.retryCount += 1;
      await delay(retryBaseMs * 2 ** (state.retryCount - 1));
    }
  }

  /** Aborts any in-flight stream and resets to idle. */
  function reset(): void {
    controller?.abort();
    controller = null;
    state.status = 'idle';
    state.stage = null;
    state.progress = 0;
    state.answer = '';
    state.citations = [];
    state.sources = [];
    state.trace = null;
    state.error = '';
    state.lastEventId = null;
    state.retryCount = 0;
  }

  return { state, sendMessage, retry, reset };
}

/** Promise-based delay for backoff. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}