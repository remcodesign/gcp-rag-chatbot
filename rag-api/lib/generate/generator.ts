/**
 * Streaming answer generator — orchestrates the RAG pipeline + chat bridge
 * and emits typed SSE events (progress, token, trace, done, error).
 *
 * Domain 5. Owns the streaming loop and the mid-stream failure policy:
 * regeneration (context-assisted, capped), never a raw re-splice, never an
 * HTTP 500 after the stream has started.
 */

import { SSE_EVENT } from './sse.js';
import type { Sse } from './sse.js';
import { normalizeError } from './chatBridge.js';
import type { ChatBridge } from './chatBridge.js';
import { readDelta } from './readDelta.js';
import { validateCitations, listSources } from './citations.js';
import type { Citation } from './citations.js';
import { buildTrace } from './trace.js';
import type {
  Pipeline,
  RunOutcome,
  SourceInfo,
  SourceMap,
} from '../types/rag.js';
import type {
  AppLogger,
  ChatMessage,
  ChatStream,
  ChatStreamChunk,
  DeltaReader,
} from '../types/chat.js';
import type { StateStoreLike } from '../types/state.js';

export const STAGES = {
  RETRIEVAL: 'retrieval',
  RERANK: 'rerank',
  GENERATION: 'generation',
  GENERATING: 'generating',
} as const;

export const SYSTEM_PROMPT =
  'You are a helpful assistant for Northwind Outfitters. Answer from the provided context. ' +
  'When you use a specific source, cite it inline as [Source N], where N is the number in the source list.' +
  
  'If you cannot answer from the context, say "I don\'t know" and do not make up an answer.' +
  'Do not cite sources that are not in the context.' +
  'Do not invent sources or fabricate citations. Or just new text outside the context.' +

  '! Output in the Dutch language.';

const DEFAULT_MAX_REGEN_RETRIES = 2;

interface GeneratorDeps {
  bridge: Pick<ChatBridge, 'streamReply' | 'normalizeError'>;
  pipeline: Pipeline;
  store?: StateStoreLike;
  reader?: { step: DeltaReader };
  logger?: Partial<AppLogger>;
}

export interface GeneratorOptions {
  maxRegenRetries?: number;
  /** Default OpenRouter `reasoning` override applied to every generation call. */
  reasoning?: Record<string, unknown>;
}

interface TokenOutcome {
  text: string;
  citations: Citation[];
}

export interface GenerateOnceInput {
  sse?: Sse | null;
  messages: ChatMessage[];
  sourceMap: SourceMap;
  request?: { model?: string | null; signal?: AbortSignal; reasoning?: Record<string, unknown> } | null;
  onToken?: (out: TokenOutcome) => void;
}

export interface GenerateOnceResult {
  text: string;
  citations: Citation[];
  requestId: string;
  model: string | null;
}

export interface StreamAnswerInput {
  sse: Sse;
  sessionId: string;
  query: string;
  options?: StreamAnswerOptions;
}

export interface StreamAnswerOptions {
  history?: ChatMessage[];
  systemPrompt?: string;
  trace?: boolean;
  model?: string | null;
  signal?: AbortSignal;
  /** OpenRouter `reasoning` override for this request. */
  reasoning?: Record<string, unknown>;
}

export interface Generator {
  streamAnswer(input: StreamAnswerInput): Promise<void>;
  generateOnce(input: GenerateOnceInput): Promise<GenerateOnceResult>;
}

export function createGenerator(deps: GeneratorDeps, options: GeneratorOptions = {}): Generator {
  const { bridge, pipeline, store } = deps;
  const normErr = bridge.normalizeError ?? normalizeError;
  const reader: { step: DeltaReader } = deps.reader ?? { step: readDelta };
  const logger: AppLogger = {
    info: deps.logger?.info ?? (() => {}),
    warn: deps.logger?.warn ?? (() => {}),
    error: deps.logger?.error ?? (() => {}),
  };
  const maxRegenRetries = options.maxRegenRetries ?? DEFAULT_MAX_REGEN_RETRIES;
  const defaultReasoning = options.reasoning;

  async function generateOnce({
    sse,
    messages,
    sourceMap,
    request,
    onToken,
  }: GenerateOnceInput): Promise<GenerateOnceResult> {
    const opened = await bridge.streamReply({
      messages,
      model: request?.model ?? undefined,
      signal: request?.signal ?? undefined,
      reasoning: request?.reasoning ?? defaultReasoning,
    });
    const stream: ChatStream = opened.stream;

    // Tokens are about to flow — make the stage explicit on the wire so the
    // frontend can leave "Selecting" and enter "Generating".
    if (sse && !sse.isClosed()) sse.send(SSE_EVENT.PROGRESS, { stage: STAGES.GENERATING, progress: 90 });

    const partial: string[] = [];
    const seen = new Set<number>();
    let citations: Citation[] = [];

    for await (const chunk of stream) {
      const token: string = reader.step(chunk as ChatStreamChunk, { delta: 'choices.0.delta.content' });
      if (!token) continue;

      const { citations: fresh } = validateCitations(token, sourceMap);
      for (const c of fresh) {
        if (!seen.has(c.n)) {
          seen.add(c.n);
          citations.push(c);
        }
      }

      const out: TokenOutcome = { text: token, citations: [...citations] };
      if (sse && !sse.isClosed()) sse.send(SSE_EVENT.TOKEN, out);
      if (onToken) onToken(out);
      partial.push(token);
    }

    return {
      text: partial.join(''),
      citations,
      requestId: opened.requestId,
      model: opened.model ?? null,
    };
  }

  async function streamAnswer(input: StreamAnswerInput): Promise<void> {
    const sse: Sse = input.sse;
    const { sessionId, query } = input;
    const options: StreamAnswerOptions = input.options ?? {};
    sse.send(SSE_EVENT.PROGRESS, { stage: STAGES.RETRIEVAL, progress: 40 });

    let runOutcome: RunOutcome = {
      query,
      sourceMap: {},
      context: '',
      sources: [],
      retrievalHits: [],
      timedOut: false,
    };
    try {
      runOutcome = await pipeline.run(query, { history: options.history });
    } catch (err) {
      const e = err as { message?: string };
      logger.warn(`retrieval failed for ${sessionId}: ${e.message}`);
      runOutcome = {
        query,
        sourceMap: {},
        context: '',
        sources: [],
        retrievalHits: [],
        classification: null,
        error: { message: e.message ?? 'retrieval failed' },
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

    let partialText = '';
    let citations: Citation[] = [];
    let request: { model?: string | null; signal?: AbortSignal } | undefined;
    let attempt = 0;
    const genT0 = Date.now();
    let generationMs = 0;

    try {
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
      generationMs = Date.now() - genT0;
    } catch (err) {
      generationMs = Date.now() - genT0;
      const e = normErr(err);
      logger.error(`generation interrupted for ${sessionId}: ${e.message}`);
      if (options.trace) {
        try {
          sse.send(SSE_EVENT.TRACE, buildTrace(runOutcome, { messages, generation: generationMs }));
        } catch (traceErr) {
          const te = traceErr as { message?: string };
          logger.warn(`trace serialization failed for ${sessionId}: ${te.message}`);
        }
      }
      sse.error({ message: 'generation interrupted', detail: e });
      return;
    }

    if (options.trace) {
      try {
        sse.send(SSE_EVENT.TRACE, buildTrace(runOutcome, { messages, generation: generationMs }));
      } catch (err) {
        const e = err as { message?: string };
        logger.warn(`trace serialization failed for ${sessionId}: ${e.message}`);
      }
    }

    if (store && store.persistMessage) {
      const persistedSources = citations
        .map((c) => sourceMap[c.n])
        .filter((s): s is SourceInfo => s != null);
      await store.persistMessage(sessionId, {
        role: 'assistant',
        content: partialText,
        sources: persistedSources,
        complete: true,
      });
    }

    sse.send(SSE_EVENT.DONE, { sources: listSources(sourceMap), citations });
    sse.end();
  }

  return { streamAnswer, generateOnce };
}

export function buildMessages({
  systemPrompt,
  context,
  user,
}: {
  systemPrompt: string;
  context: string;
  user: string;
}): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  if (context) msgs.push({ role: 'user', content: `Context:\n${context}` });
  msgs.push({ role: 'user', content: user });
  return msgs;
}

export function buildRegenMessages(base: ChatMessage[], partialText: string): ChatMessage[] {
  return [
    ...base,
    { role: 'assistant', content: partialText },
    {
      role: 'user',
      content:
        'Continue from where you stopped, staying consistent with the answer above. Do not repeat what is already written.',
    },
  ];
}