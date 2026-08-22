/**
 * SSE transport — Domain 6, Step 6.1.
 *
 * The backend endpoint is `POST /sessions/:id/messages`, so the native
 * `EventSource` API cannot be used (it only supports GET). This module opens
 * the stream with `fetch` + a `ReadableStream` body reader, decodes the bytes,
 * and yields raw SSE text chunks to the parser. It is the injected `send`
 * transport the chat store consumes.
 *
 * Reconnection (Step 6.3) is handled by the store: it passes the last event id
 * back here as `lastEventId`, which the backend uses to resume from Firestore.
 */

/**
 * Opens the SSE stream for a session and yields raw text chunks.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.query
 * @param {number|null} params.lastEventId  resume point (Last-Event-ID).
 * @param {AbortSignal} params.signal
 * @param {object} [options]
 * @param {string} [options.baseUrl]  backend origin (defaults to same-origin).
 * @returns {AsyncIterable<string>} raw SSE text chunks.
 */
export async function* openSseStream(params, options = {}) {
  const { sessionId, query, lastEventId, signal } = params;
  const baseUrl = options.baseUrl ?? '';
  const url = `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(lastEventId != null ? { 'Last-Event-ID': String(lastEventId) } : {}),
    },
    body: JSON.stringify({ query }),
    signal,
  });

  if (!res.ok || !res.body) {
    const err = new Error(`SSE request failed: HTTP ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}