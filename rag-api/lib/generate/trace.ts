/**
 * RAG trace payload — the frontend "inner workings" sidebar.
 *
 * Domain 5 / POC supportability. Builds a client-safe, serializable summary of
 * what the pipeline did: the retrieval ranking, which sources were kept in the
 * context window, the rerank decision, stage timings, and (optionally) the
 * final prompt. Deliberately omits raw embeddings and full prompt internals.
 */

import type { Hit, RunOutcome } from '../types/rag.js';
import type { ChatMessage, TokenUsage } from '../types/chat.js';
import type { TraceHit, TracePayload } from '../types/trace.js';

const PREVIEW_CHARS = 180;
const QUERY_PREVIEW_CHARS = 120;

interface SerializeHitOptions {
    rank?: number;
    keptInContext?: boolean;
}

export function preview(text: unknown, maxChars = PREVIEW_CHARS): string {
    const s = String(text ?? '');
    if (s.length <= maxChars) return s;
    return `${s.slice(0, maxChars).trimEnd()}…`;
}

export function serializeHit(
    hit: Partial<Hit> = {},
    { rank = 0, keptInContext = false }: SerializeHitOptions = {},
): TraceHit {
    const score =
        typeof hit.similarityScore === 'number'
            ? hit.similarityScore
            : typeof hit.distance === 'number'
                ? 1 - hit.distance
                : null;

    return {
        id: hit.id,
        rank,
        title: hit.title || 'Untitled source',
        url: hit.url || '#',
        category: hit.category ?? null,
        score: score == null ? null : Number(score.toFixed(4)),
        textPreview: preview(hit.text),
        text: typeof hit.text === 'string' ? hit.text : '',
        chars: typeof hit.text === 'string' ? hit.text.length : 0,
        keptInContext,
    };
}

interface BuildTraceInput {
    messages?: ChatMessage[];
    /** LLM generation time (ms), measured by the generator around the stream. */
    generation?: number;
    /** Token usage from the final OpenRouter stream chunk (when reported). */
    usage?: TokenUsage | null;
    /** Time (ms) to first content token. */
    ttftMs?: number;
    /** Completion tokens per second (text emitted / generation time). */
    tokensPerSecond?: number | null;
}

export function buildTrace(
    outcome: Partial<RunOutcome> = {},
    { messages, generation, usage, ttftMs, tokensPerSecond }: BuildTraceInput = {},
): TracePayload {
    const hits = Array.isArray(outcome.retrievalHits) ? outcome.retrievalHits : [];
    const sourceMap = outcome.sourceMap || {};

    const entries = Object.entries(sourceMap);
    const inContextIds = new Set(entries.map(([, s]) => s && s.id).filter(Boolean));

    const retrieved = hits.map((h, idx) =>
        serializeHit(h, { rank: idx + 1, keptInContext: inContextIds.has(h.id) }),
    );

    const rerank = {
        didRerank: !!(outcome.rerankInfo && outcome.rerankInfo.didRerank),
        reason: (outcome.rerankInfo && outcome.rerankInfo.reason) || 'rerank skipped',
    };

    const context = {
        sources: entries.map(([n, s]) => ({ n: Number(n), id: s && s.id })),
        length: (outcome.context || '').length,
    };

    const timings = outcome.timings
        ? {
            ...outcome.timings,
            ...(typeof generation === 'number' ? { generation } : {}),
            ...(typeof generation === 'number' && typeof outcome.timings.total === 'number'
                ? { e2e: outcome.timings.total + generation }
                : {}),
        }
        : null;

    const payload: TracePayload = {
        query: preview(outcome.query ?? '', QUERY_PREVIEW_CHARS),
        retrieved,
        rerank,
        context,
        timings,
        timedOut: !!(outcome.timedOut || outcome.error),
        ...(ttftMs !== undefined ? { ttftMs } : {}),
        ...(tokensPerSecond != null ? { tokensPerSecond } : {}),
        ...(usage ? { usage } : {}),
    };

    if (outcome.error) {
        payload.error = { message: String(outcome.error.message || 'retrieval failed').slice(0, 300) };
    }

    if (messages) {
        payload.finalPrompt = messages
            .filter((m) => m && typeof m.content === 'string')
            .map((m, i) => `[${i + 1}] ${m.role}\n${m.content}`);
    }

    return payload;
}