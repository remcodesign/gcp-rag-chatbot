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

/** Max conversation turns (user+assistant pairs) before the session ends. */
export const MAX_CONVERSATION_TURNS = 5;

/** Friendly Dutch message shown when the conversation limit is reached. */
export const SESSION_LIMIT_MESSAGE =
    'Dit was de laatste vraag van dit gesprek. Bedankt voor het gesprek over je outdoor uitrusting! ' +
    'Start gerust een nieuw gesprek als je nog een vraag hebt.';

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
    /** Token usage from the final OpenRouter stream chunk (when reported). */
    usage?: GenerateUsage | null;
    /** Time (ms) to first content token. */
    ttftMs?: number;
    /** Completion tokens per second (text emitted / generation time). */
    tokensPerSecond?: number | null;
    /** Generation wall-clock time (ms) for this call. */
    generationMs?: number;
}

export interface GenerateUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cost?: number | null;
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
        info: deps.logger?.info ?? (() => { }),
        warn: deps.logger?.warn ?? (() => { }),
        error: deps.logger?.error ?? (() => { }),
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
        const genStart = Date.now();
        let ttftMs: number | undefined;
        let usage: GenerateUsage | undefined;

        for await (const chunk of stream) {
            // First (non-empty) content token marks the generation start -> TTFT.
            if (ttftMs === undefined && chunk?.usage === undefined) {
                const probe: string = reader.step(chunk as ChatStreamChunk, { delta: 'choices.0.delta.content' });
                if (probe.length > 0) ttftMs = Date.now() - genStart;
            }
            // Capture token usage from the final usage chunk (no content choice).
            if (chunk?.usage) {
                usage = {
                    promptTokens: chunk.usage.promptTokens,
                    completionTokens: chunk.usage.completionTokens,
                    totalTokens: chunk.usage.totalTokens,
                    cost: chunk.usage.cost ?? null,
                };
            }

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

        const generationMs = Math.max(Date.now() - genStart, 1);
        const completionTokens = usage?.completionTokens;
        const tokensPerSecond =
            typeof completionTokens === 'number' && completionTokens > 0 && generationMs > 0
                ? completionTokens / (generationMs / 1000)
                : null;

        return {
            text: partial.join(''),
            citations,
            requestId: opened.requestId,
            model: opened.model ?? null,
            usage,
            ttftMs,
            tokensPerSecond,
            generationMs,
        };
    }

    async function streamAnswer(input: StreamAnswerInput): Promise<void> {
        const sse: Sse = input.sse;
        const { sessionId, query } = input;
        const options: StreamAnswerOptions = input.options ?? {};
        sse.send(SSE_EVENT.PROGRESS, { stage: STAGES.RETRIEVAL, progress: 40 });

        // Load the stored transcript (older turns) + persist this user turn so a
        // follow-up question can use it, and so messages survive a reconnect.
        const stored = await loadMessages(store, sessionId);
        const storedHistory = stored.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }));
        if (store && store.persistMessage) {
            try {
                await store.persistMessage(sessionId, { role: 'user', content: query, complete: true });
            } catch (err) {
                const e = err as { message?: string };
                logger.warn(`user message persist failed for ${sessionId}: ${e.message}`);
            }
        }

        // Enforce a friendly conversation limit: after MAX_CONVERSATION_TURNS
        // assistant replies, end the session instead of calling the LLM.
        const assistantTurns = storedHistory.filter((m) => m.role === 'assistant').length;
        if (assistantTurns >= MAX_CONVERSATION_TURNS) {
            logger.info(`conversation limit reached for ${sessionId}`);
            if (sse && !sse.isClosed()) {
                sse.send(SSE_EVENT.TOKEN, { text: SESSION_LIMIT_MESSAGE, citations: [] });
                sse.send(SSE_EVENT.DONE, { sources: [], citations: [], limitReached: true });
            }
            sse.end();
            return;
        }

        const history: ChatMessage[] = options.history ?? storedHistory;

        let runOutcome: RunOutcome = {
            query,
            sourceMap: {},
            context: '',
            sources: [],
            retrievalHits: [],
            timedOut: false,
        };
        try {
            runOutcome = await pipeline.run(query, { history });
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
            history,
        });

        let partialText = '';
        let citations: Citation[] = [];
        let request: { model?: string | null; signal?: AbortSignal } | undefined;
        let attempt = 0;
        const genT0 = Date.now();
        let generationMs = 0;
        let usage: GenerateUsage | undefined;
        let ttftMs: number | undefined;
        let tokensPerSecond: number | null = null;

        try {
            for (; ;) {
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
                    // Keep the last generation's usage + timing; regeneration calls add
                    // their own, so prefer the most recent complete call.
                    if (res.usage) usage = res.usage;
                    if (res.ttftMs !== undefined) ttftMs = res.ttftMs;
                    if (res.tokensPerSecond !== undefined) tokensPerSecond = res.tokensPerSecond;
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
                    sse.send(SSE_EVENT.TRACE, buildTrace(runOutcome, { messages, generation: generationMs, usage, ttftMs, tokensPerSecond }));
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
                sse.send(SSE_EVENT.TRACE, buildTrace(runOutcome, { messages, generation: generationMs, usage, ttftMs, tokensPerSecond }));
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
    history = [],
}: {
    systemPrompt: string;
    context: string;
    user: string;
    /** Prior user/assistant turns to include so the LLM can answer follow-ups. */
    history?: ChatMessage[];
}): ChatMessage[] {
    const msgs: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    // Compact the prior transcript (oldest first, role-alternating) so the LLM
    // sees the conversation, capped to a bounded window to protect the prompt.
    const prior = compactHistory(history);
    for (const m of prior) msgs.push(m);
    if (context) msgs.push({ role: 'user', content: `Context:\n${context}` });
    msgs.push({ role: 'user', content: user });
    return msgs;
}

/** Keeps a bounded, alternating user/assistant transcript (oldest first). */
export function compactHistory(history: ChatMessage[] | undefined, maxTurns = 5): ChatMessage[] {
    if (!Array.isArray(history) || history.length === 0) return [];
    // Keep both the user question and its assistant reply per turn -> 2 msgs/turn.
    const bounded = history.slice(-maxTurns * 2);
    // Collapse any consecutive same-role messages (safety, should not happen).
    const out: ChatMessage[] = [];
    for (const m of bounded) {
        if (out.length && out[out.length - 1]?.role === m.role) continue;
        out.push(m);
    }
    return out;
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

/** Safely loads the stored transcript for a session (empty when no store). */
async function loadMessages(
    store: StateStoreLike | undefined,
    sessionId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    if (!store || typeof store.listMessages !== 'function') return [];
    try {
        const records = await store.listMessages(sessionId);
        return (Array.isArray(records) ? records : [])
            .map((r) => ({ role: r.role, content: r.content ?? '' }))
            .filter((r) => typeof r.content === 'string');
    } catch (err) {
        const e = err as { message?: string };
        console.warn(`listMessages failed for ${sessionId}: ${e.message}`);
        return [];
    }
}