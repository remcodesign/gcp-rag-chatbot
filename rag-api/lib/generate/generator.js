/**
 * Streaming generator orchestrator — Domain 5, Steps 5.1–5.4.
 *
 * Owns the full generation lifecycle exposed through the SSE endpoint
 * (`POST /sessions/:id/messages` -> `res`):
 *
 *   5.1  SSE framing via `createSse` (typed, monotonic-id events)
 *   5.2  open the OpenRouter streaming chat via `createChatBridge.streamReply`
 *   5.3  validate inline `[Source N]` citations against the source map
 *   5.4  mid-stream failure -> context-assisted regeneration, bounded retries
 *
 * Every outbound dependency is injected (RAG pipeline, state store, chat bridge,
 * stream reader, logger) so this runs in unit tests with null I/O.
 *
 * Contract with the client:
 *   - `progress` events with `{ stage, progress }`
 *   - `token` events with `{ text, citations }` — the delta plus the running
 *     validated citation list so the client can render chips live.
 *   - a terminal `done` event with `{ sources, citations }`.
 *   - a terminal `error` event (never an HTTP 500) on mid-stream failure.
 */

import { SSE_EVENT } from './sse.js';
import { normalizeError } from './chatBridge.js';
import { readDelta } from './readDelta.js';
import { validateCitations, listSources } from './citations.js';
import { buildTrace } from './trace.js';

/** Stage labels mirrored to the client for the progress UI. */
export const STAGES = Object.freeze({
  RETRIEVAL: 'retrieval',
  RERANK: 'rerank',
  GENERATION: 'generation',
});

/** Default system prompt — instructs the model to cite inline. */
export const SYSTEM_PROMPT =
  'You are a helpful assistant for Northwind Outfitters. Answer from the provided context. ' +
  'When you use a specific source, cite it inline as [Source N], where N is the number in the source list.';

const DEFAULT_MAX_REGEN_RETRIES = 2;

/**
 * Creates the generator.
 *
 * @param {object} deps
 * @param {object} deps.bridge        chat bridge (see chatBridge.js, has `.streamReply`).
 * @param {object} deps.pipeline      RAG pipeline from Domain 3 (`.run(query, opts)`).
 * @param {object} deps.store         session/event state store from Domain 2 (`.persistMessage`).
 * @param {object} [deps.reader]      `{ step(chunk) -> string }` (default readDelta).
 * @param {object} [deps.logger]      `{ info, warn, error }` (default no-op).
 * @param {object} [options]
 * @param {number} [options.maxRegenRetries]  cap on mid-stream regenerations (default 2).
 * @returns {{ streamAnswer: Function, generateOnce: Function }}
 */
export function createGenerator(deps, options = {}) {
  const { bridge, pipeline, store } = deps;
  const normErr = bridge.normalizeError ?? normalizeError;
  const reader = deps.reader ?? { step: readDelta };
  const logger = deps.logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  const maxRegenRetries = options.maxRegenRetries ?? DEFAULT_MAX_REGEN_RETRIES;

  /**
   * A single streaming generation attempt. Streams each validated delta through
   * `sse` as a `token` event and resolves with
   * `{ text, citations, requestId, model }`. Throws (normalized) on mid-stream
   * failure — the caller decides whether to regenerate.
   */
  async function generateOnce({ sse, messages, sourceMap, request, onToken }) {
    const opened = await bridge.streamReply({
      messages,
      model: request && request.model,
      signal: request && request.signal,
    });
    const stream = opened.stream;

    const partial = [];
    const seen = new Set();
    let citations = [];

    for await (const chunk of stream) {
      const token = reader.step(chunk);
      if (!token) continue;

      // Step 5.3 — live-validate inline citations against the source map.
      const { citations: fresh } = validateCitations(token, sourceMap);
      for (const c of fresh) {
        if (!seen.has(c.n)) {
          seen.add(c.n);
          citations.push(c);
        }
      }

      const out = { text: token, citations: [...citations] };
      if (sse && !sse.isClosed()) sse.send(SSE_EVENT.TOKEN, out);
      if (onToken) onToken(out);
      partial.push(token);
    }

    return {
      text: partial.join(''),
      citations,
      requestId: opened.requestId,
      model: opened.model,
    };
  }

  /**
   * Full streaming flow for one user message against an existing session.
   * Emits progress events, streams tokens, and — on a mid-stream failure —
   * drives context-aware regeneration up to `maxRegenRetries`, never
   * re-splicing the stream and never returning HTTP 500 once started.
   */
  async function streamAnswer({ sse, sessionId, query, options = {} }) {
    sse.send(SSE_EVENT.PROGRESS, { stage: STAGES.RETRIEVAL, progress: 40 });

    let runOutcome = { query, sourceMap: {}, context: '', sources: [], retrievalHits: [] };
    try {
      runOutcome = await pipeline.run(query, { history: options.history });
    } catch (err) {
      // Retrieval failure: still answer, just without context (graceful degrade).
      // Keep the query + a diagnosis in the trace so the sidebar shows WHY no
      // context was found, instead of an empty query.
      logger.warn(`retrieval failed for ${sessionId}: ${err.message}`);
      runOutcome = {
        query,
        sourceMap: {},
        context: '',
        sources: [],
        retrievalHits: [],
        classification: null,
        error: { message: err.message },
        timings: null,
        timedOut: true,
      };
    }

    sse.send(SSE_EVENT.PROGRESS, { stage: STAGES.RERANK, progress: 60 });
    sse.send(SSE_EVENT.PROGRESS, { stage: STAGES.GENERATION, progress: 80 });

    const sourceMap = runOutcome.sourceMap || {};

    const messages = buildMessages({
      systemPrompt: options.systemPrompt || SYSTEM_PROMPT,
      context: runOutcome.context || '',
      user: query,
    });

    // POC supportability: surface the RAG "inner workings" to the client — the
    // raw retrieval ranking, the rerank decision, the resulting context, and the
    // final prompt sent to the LLM. Optional and best-effort.
    if (options.trace) {
      try {
        sse.send(SSE_EVENT.TRACE, buildTrace(runOutcome, { messages }));
      } catch (err) {
        logger.warn(`trace serialization failed for ${sessionId}: ${err.message}`);
      }
    }

    let partialText = '';
    let citations = [];
    let request;
    let attempt = 0;

    try {
      // Initial attempt, then context-aware generation on mid-stream error.
      for (;;) {
        const msgs = attempt === 0 ? messages : buildRegenMessages(messages, partialText);
        try {
          const res = await generateOnce({
            sse,
            messages: msgs,
            sourceMap,
            request,
            onToken: (out) => {
              partialText += out.text;
              citations = out.citations;
            },
          });
          partialText = res.text;
          citations = res.citations;
          request = { model: res.model };
          break;
        } catch (err) {
          const e = normErr(err);
          logger.warn(`generation attempt ${attempt} failed for ${sessionId}: ${e.message}`);
          if (attempt >= maxRegenRetries) throw err;
          attempt += 1;
          sse.send(SSE_EVENT.PROGRESS, { stage: STAGES.GENERATION, progress: 80, note: 'regenerating' });
        }
      }
    } catch (err) {
      sse.error({ message: 'generation interrupted', detail: normErr(err) });
      return;
    }

    // Persist the completed assistant message + sources (Domain 2 store).
    if (store && store.persistMessage) {
      await store.persistMessage(sessionId, {
        role: 'assistant',
        content: partialText,
        sources: citations.map((c) => sourceMap[c.n]),
        complete: true,
      });
    }

    sse.send(SSE_EVENT.DONE, { sources: listSources(sourceMap), citations });
    sse.end();
  }

  return { streamAnswer, generateOnce };
}

/** Builds the initial system + context + user message array. */
export function buildMessages({ systemPrompt, context, user }) {
  const msgs = [{ role: 'system', content: systemPrompt }];
  if (context) msgs.push({ role: 'user', content: `Context:\n${context}` });
  msgs.push({ role: 'user', content: user });
  return msgs;
}

/** Builds the "continue" message array for context-aware regeneration. */
export function buildRegenMessages(base, partialText) {
  return [
    ...base,
    { role: 'assistant', content: partialText },
    {
      role: 'user',
      content:
        'Continue from where you stopped, staying consistent with the answer above. ' +
        'Do not repeat what is already written.',
    },
  ];
}