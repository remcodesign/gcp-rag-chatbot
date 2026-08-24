/**
 * Domain 5 — Streaming generation + source attribution.
 *
 * Public entry point for the generate module. Exposes the SSE helper, the chat
 * bridge, delta reader, citation validation, RAG trace builder, and the
 * generator factory + prompt helpers.
 */

export { createSse, SSE_EVENT } from './sse.js';
export type { Sse, SseEvent } from './sse.js';
export { createChatBridge, normalizeError } from './chatBridge.js';
export type { ChatBridge, StreamReplyInput } from './chatBridge.js';
export { readDelta } from './readDelta.js';
export { validateCitations, normalizeSourceToken, listSources } from './citations.js';
export type { Citation, ValidateCitationsResult } from './citations.js';
export { buildTrace, serializeHit, preview } from './trace.js';
export {
  createGenerator,
  buildMessages,
  buildRegenMessages,
  STAGES,
  SYSTEM_PROMPT,
} from './generator.js';
export type {
  Generator,
  GeneratorOptions,
  StreamAnswerInput,
  StreamAnswerOptions,
  GenerateOnceInput,
  GenerateOnceResult,
} from './generator.js';