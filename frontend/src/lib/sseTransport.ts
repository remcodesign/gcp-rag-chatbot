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

import type { SendParams } from '../types/chat';

/** Options for opening the stream. */
export interface OpenSseOptions {
  /** Backend origin (defaults to same-origin via the Vite dev proxy). */
  baseUrl?: string;
}

/**
 * Opens the SSE stream for a session and yields raw text chunks.
 *
 * @param params transport parameters from the store.
 * @param options connection options.
 */
export async function* openSseStream(params: SendParams, options: OpenSseOptions = {}): AsyncIterable<string> {
  const { sessionId, query, lastEventId, signal, trace } = params;
  const baseUrl = options.baseUrl ?? '';
  const url = `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(lastEventId != null ? { 'Last-Event-ID': String(lastEventId) } : {}),
    },
    body: JSON.stringify({ query, trace: !!trace }),
    signal,
  });

  if (!res.ok || !res.body) {
    const err: Error & { statusCode?: number } = new Error(`SSE request failed: HTTP ${res.status}`);
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