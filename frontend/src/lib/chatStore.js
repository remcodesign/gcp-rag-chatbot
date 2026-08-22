/**
 * Chat store — Domain 6, Steps 6.1–6.4.
 *
 * Owns the client-side chat state machine and the SSE consumer. It is the
 * frontend counterpart of the backend generator contract
 * (`rag-api/lib/generate/generator.js`):
 *
 *   - `progress` events `{ stage, progress }` -> advance the status indicator
 *   - `token` events `{ text, citations }` -> append to the answer, update chips
 *   - `done` events `{ sources, citations }` -> finalize
 *   - `error` events `{ message, detail }` -> surface a retry banner
 *
 * Reconnection (Step 6.3) pairs with the backend's `Last-Event-ID` resume: the
 * store remembers the last event id it saw and sends it back on reconnect so
 * the backend replays from that point (no duplicates, no rewind).
 *
 * The transport is injected (`send`), so this runs in unit tests with a fake
 * async generator — no network, no DOM.
 */

import { reactive } from 'vue';

/** Stage labels mirrored from the backend `STAGES`. */
export const STAGES = Object.freeze({
  RETRIEVAL: 'retrieval',
  RERANK: 'rerank',
  GENERATION: 'generation',
});

/** Human labels for the progress UI (Step 6.2). */
export const STAGE_LABELS = Object.freeze({
  [STAGES.RETRIEVAL]: 'Understanding',
  [STAGES.RERANK]: 'Searching',
  [STAGES.GENERATION]: 'Selecting',
});

/** Client-side lifecycle states. */
export const STATUS = Object.freeze({
  IDLE: 'idle',
  STREAMING: 'streaming',
  DONE: 'done',
  ERROR: 'error',
});

const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

/**
 * Creates a chat store.
 *
 * @param {object} deps
 * @param {(params:{sessionId:string, query:string, lastEventId:number|null, signal:AbortSignal}) => AsyncIterable<{id:number|null,event:string,data:any}>} deps.send
 *        transport that opens the SSE stream and yields parsed frames.
 * @param {object} [deps.parser]  `{ parseSse(buffer) }` (defaults to sseParser).
 * @param {object} [options]
 * @param {number} [options.maxRetries]  reconnect attempts before surfacing a manual retry (default 3).
 * @param {number} [options.retryBaseMs]  exponential backoff base (default 500).
 * @returns {object} store with `state`, `sendMessage`, `retry`, `reset`.
 */
export function createChatStore(deps, options = {}) {
  const { send } = deps;
  const parser = deps.parser ?? { parseSse: (b) => ({ frames: [], rest: b }) };
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseMs = options.retryBaseMs ?? RETRY_BASE_MS;

  // Reactive so the Vue components reading `store.state.*` re-render on every
  // mutation. A plain object here would NOT trigger updates — the root cause of
  // "SSE arrives but nothing renders".
  const state = reactive({
    status: STATUS.IDLE,
    stage: null,
    progress: 0,
    answer: '',
    citations: [], // running validated citations [{ n, title }]
    sources: [], // final source list [{ n, title, url, id }]
    error: null,
    lastEventId: null,
    retryCount: 0,
  });

  let controller = null;
  let sessionId = null;
  let query = null;

  /** Appends a token delta and merges the running citation list (Step 6.1). */
  function appendToken({ text = '', citations = [] } = {}) {
    if (text) state.answer += text;
    for (const c of citations) {
      if (!state.citations.some((x) => x.n === c.n)) state.citations.push(c);
    }
  }

  /** Applies a progress event, never moving the indicator backward (Step 6.2). */
  function applyProgress({ stage, progress = 0 } = {}) {
    if (stage) state.stage = stage;
    if (typeof progress === 'number' && progress >= state.progress) {
      state.progress = progress;
    }
  }

  /** Handles a single parsed frame from the stream. */
  function handleFrame(frame) {
    if (frame.id != null) state.lastEventId = frame.id;
    switch (frame.event) {
      case 'progress':
        applyProgress(frame.data);
        break;
      case 'token':
        appendToken(frame.data);
        break;
      case 'done':
        state.sources = frame.data && frame.data.sources ? frame.data.sources : [];
        state.status = STATUS.DONE;
        break;
      case 'error':
        state.error = frame.data && frame.data.message ? frame.data.message : 'generation interrupted';
        state.status = STATUS.ERROR;
        break;
      default:
        break;
    }
  }

  /** Runs one streaming attempt, returning `{ ok, interrupted }`. */
  async function runStream() {
    controller = new AbortController();
    const iterable = send({
      sessionId,
      query,
      lastEventId: state.lastEventId,
      signal: controller.signal,
    });

    let buffer = '';
    for await (const chunk of iterable) {
      if (controller.signal.aborted) return { ok: false, interrupted: true };
      const { frames, rest } = parser.parseSse(buffer + chunk);
      buffer = rest;
      for (const frame of frames) handleFrame(frame);
      if (state.status === STATUS.DONE || state.status === STATUS.ERROR) {
        return { ok: state.status === STATUS.DONE, interrupted: false };
      }
    }
    // Stream ended without a terminal event -> treat as interrupted.
    return { ok: false, interrupted: true };
  }

  /** Sends a user message and drives the stream with reconnection (Step 6.3). */
  async function sendMessage({ sessionId: sid, query: q }) {
    sessionId = sid;
    query = q;
    state.status = STATUS.STREAMING;
    state.stage = STAGES.RETRIEVAL;
    state.progress = 0;
    state.answer = '';
    state.citations = [];
    state.sources = [];
    state.error = null;
    state.retryCount = 0;
    state.lastEventId = null;

    for (;;) {
      const { ok, interrupted } = await runStream();
      if (ok) return;
      if (state.status === STATUS.ERROR) return; // terminal error surfaced
      // Interrupted (network blip / stream ended early): reconnect with backoff.
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
  async function retry() {
    if (!sessionId || !query) return;
    state.status = STATUS.STREAMING;
    state.error = null;
    state.retryCount = 0;
    for (;;) {
      const { ok } = await runStream();
      if (ok) return;
      if (state.status === STATUS.ERROR) return;
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
  function reset() {
    controller && controller.abort();
    controller = null;
    state.status = STATUS.IDLE;
    state.stage = null;
    state.progress = 0;
    state.answer = '';
    state.citations = [];
    state.sources = [];
    state.error = null;
    state.lastEventId = null;
    state.retryCount = 0;
  }

  return { state, sendMessage, retry, reset };
}

/** Promise-based delay for backoff (injectable for tests via options). */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}