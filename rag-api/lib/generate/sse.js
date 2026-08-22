/**
 * SSE framing helper — Domain 5, Step 5.1.
 *
 * Writes typed Server-Sent Events the client can route on (`progress`,
 * `token`, `error`, `done`), each with a monotonically increasing `id` so a
 * reconnecting client using `Last-Event-ID` can resume without duplicating or
 * rewinding (pairs with Domain 2 `listEventsAfter`).
 *
 * Bound to a `res`-compatible sink so it is testable without a live HTTP
 * server: the real Node `ServerResponse`, or a recording fake in tests. The
 * sink must expose `writeHead(status, headers)` (called once) and `write(str)`;
 * it may expose a `destroyed` flag so we stop writing after the socket closes.
 */

/** Default SSE event types produced by the generator flow. */
export const SSE_EVENT = Object.freeze({
  PROGRESS: 'progress',
  TOKEN: 'token',
  ERROR: 'error',
  DONE: 'done',
  TRACE: 'trace',
});

/**
 * Creates an SSE session bound to `res`.
 *
 * @param {object} res  response sink (see module header).
 * @param {object} [options]
 * @param {() => number} [options.idFactory]  returns the next event id (tests inject a fixed source).
 * @param {Record<string,string>} [options.extraHeaders]  extra response headers merged into the SSE head
 *        (e.g. CORS `Access-Control-Allow-Origin` when a separate frontend origin calls this endpoint).
 * @returns {object} `{ send, sendRaw, end, error, get nextId, get destroyed }`.
 */
export function createSse(res, options = {}) {
  let nextId = (options.idFactory ? options.idFactory() : 0);
  let writeHeadDone = false;
  let closed = false;

  function ensureHead() {
    if (writeHeadDone) return;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(options.extraHeaders || {}),
    });
    writeHeadDone = true;
  }

  function isClosed() {
    if (closed) return true;
    return !!(res && res.destroyed);
  }

  /**
   * Ends the underlying response exactly once. This is REQUIRED: without it the
   * HTTP connection stays open after the last `done`/`error` frame, and a
   * browser `ReadableStream` reader never receives its `done` signal — the
   * client hangs ("streaming" forever, tokens never render). Node's fetch
   * tolerates an unterminated body; browsers do not.
   */
  function close() {
    if (closed) return;
    closed = true;
    if (res && typeof res.end === 'function') {
      try { res.end(); } catch { /* response already destroyed */ }
    }
  }

  /**
   * Sends a typed frame with an auto-incremented id.
   */
  function send(event, data) {
    if (isClosed()) return null;
    ensureHead();
    const id = nextId; nextId += 1;
    const payload = typeof data === 'string' ? data : JSON.stringify(data ?? {});
    const frame = `id: ${id}\nevent: ${event}\ndata: ${payload}\n\n`;
    res.write(frame);
    return id;
  }

  /** Sends a raw pre-formatted SSE string (for replay/dedup tests). */
  function sendRaw(str) {
    if (isClosed()) return false;
    ensureHead();
    res.write(str);
    return true;
  }

  /** Gracefully finishes the stream and closes the response. */
  function end() {
    close();
  }

  /**
   * Sends an `error` event and closes — a mid-stream failure must surface as
   * an SSE error, never as an HTTP 500 (the response already started).
   */
  function error(payload) {
    send(SSE_EVENT.ERROR, payload);
    close();
  }

  return {
    send,
    sendRaw,
    end,
    error,
    get nextId() { return nextId; },
    isClosed,
  };
}