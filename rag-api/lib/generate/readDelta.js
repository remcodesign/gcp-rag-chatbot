/**
 * Reading/parsing of an OpenRouter streaming chat chunk — Domain 5, Step 5.2.
 *
 * The OpenRouter SDK returns an async iterable from `chat.send({ stream:true })`;
 * each item is shaped like an OpenAI chat-completion chunk:
 *
 *   chunk.choices[0].delta.content      -> the incremental token text
 *   chunk.choices[0].finish_reason      -> null until the terminal frame
 *
 * `readDelta` isolates the tiny extraction so the generator's stream loop stays
 * trivial and is injectable (a StreamReader adapter) in tests. If a future SDK
 * or model returns the token under a different field, this is the single place
 * that changes.
 */

/**
 * Extracts the content delta from a streaming chunk.
 *
 * @param {object} chunk  a raw streaming chunk from the SDK.
 * @param {object} [options]
 * @param {string} [options.deltaPath]  dotted path to the delta (default `choices.0.delta.content`).
 * @returns {string} the token text, or `''` for frames with no token (tool calls,
 *   reasoning deltas left empty by the model, etc).
 */
export function readDelta(chunk, { delta = 'choices.0.delta.content' } = {}) {
  const parts = delta.split('.');
  let cur = chunk;
  for (let i = 0; cur != null && i < parts.length; i += 1) {
    const key = Number.isInteger(Number(parts[i])) ? Number(parts[i]) : parts[i];
    cur = cur[key];
  }
  return typeof cur === 'string' ? cur : '';
}