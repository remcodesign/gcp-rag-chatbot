/**
 * SSE frame parser — Domain 6, Step 6.1.
 *
 * The backend streams typed Server-Sent Events (`progress`, `token`, `error`,
 * `done`), each with a monotonic `id` (see `rag-api/lib/generate/sse.js`). This
 * module turns a raw SSE text chunk into discrete frames so the consumer can
 * route them. It is a pure function of the accumulated buffer, so it is fully
 * unit-testable without a network.
 *
 * Frame shape returned:
 *   { id: number|null, event: string, data: any }
 * `data` is JSON-parsed when possible; otherwise kept as the raw string.
 */

/**
 * Parses a raw SSE text buffer into frames, returning the leftover buffer.
 *
 * @param {string} buffer  accumulated SSE text (may contain partial frames).
 * @returns {{ frames: Array<{id:number|null,event:string,data:any}>, rest: string }}
 */
export function parseSse(buffer) {
  const frames = [];
  let rest = buffer;
  let idx;
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const frame = parseBlock(block);
    if (frame) frames.push(frame);
  }
  return { frames, rest };
}

/**
 * Parses a single SSE block (fields separated by `\n`) into a frame.
 * Ignores comment lines (`:`), keeps the last `id`/`event`/`data` per spec.
 */
function parseBlock(block) {
  let id = null;
  let event = 'message';
  let data = '';
  let hasData = false;

  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id') id = Number(value);
    else if (field === 'event') event = value;
    else if (field === 'data') {
      data = data === '' ? value : `${data}\n${value}`;
      hasData = true;
    }
  }

  if (!hasData) return null;
  return { id, event, data: tryJson(data) };
}

/** JSON-parses `data` when possible; otherwise returns the raw string. */
function tryJson(data) {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}