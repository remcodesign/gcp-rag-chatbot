/**
 * Domain 5 — Streaming Generation + Source Attribution (OpenRouter).
 *
 * Public entry point for the generate module. Exposes the SSE writer, the
 * OpenRouter chat bridge adapter, the untrusted-citation validator, the stream
 * reader, and the generator orchestrator so later domains (the SSE HTTP route,
 * and finally Domain 7 hardening) can compose them.
 */

export { createSse, SSE_EVENT } from './sse.js';
export { createChatBridge, normalizeError } from './chatBridge.js';
export { readDelta } from './readDelta.js';
export { validateCitations, normalizeSourceToken, listSources } from './citations.js';
export {
  createGenerator,
  buildMessages,
  buildRegenMessages,
  STAGES,
  SYSTEM_PROMPT,
} from './generator.js';