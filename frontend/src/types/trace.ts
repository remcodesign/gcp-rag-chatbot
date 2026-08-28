/**
 * RAG trace type-set — the POC "inner workings" payload (Domain 7/Domain 6 sidebar).
 *
 * Shares the shape of `rag-api/lib/generate/trace.ts`. The store retains this
 * payload (delivered as an SSE `trace` event) and `normalizeTrace` shapes it for
 * rendering. Each field is optional-tolerant because the payload may be partial.
 */

/** A retrieved chunk in the trace (post-rerank ranking). */
export interface TraceHit {
    id: string;
    rank: number;
    title: string;
    url: string;
    category: string | null;
    score: number | null;
    textPreview: string;
    text: string;
    chars: number;
    keptInContext: boolean;
}

/** The rerank decision carried in the trace. */
export interface TraceRerank {
    didRerank: boolean;
    reason: string;
}

/** The context window source order passed to the LLM. */
export interface TraceContext {
    sources: Array<{ n: number; id?: string }>;
    length: number;
}

/** Per-stage timings in milliseconds. */
export interface TraceTimings {
    embed: number;
    retrieval: number;
    rerank: number;
    /** LLM generation time (ms), measured by the backend generator. */
    generation?: number;
    /** RAG-pipeline total (ms): embed + retrieve + rerank + context build. */
    total: number;
    /** End-to-end total (ms): pipeline `total` + LLM `generation`. */
    e2e?: number;
}

/** Retrieval-error diagnosis (when retrieval degraded). */
export interface TraceError {
    message: string;
}

/** OpenRouter token usage surfaced in the trace (prompt/completion/total + cost). */
export interface TraceUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cost?: number | null;
}

/** The raw (partial-tolerant) trace payload emitted by the backend. */
export interface RawTrace {
    query?: string;
    retrieved?: TraceHit[];
    rerank?: TraceRerank;
    context?: TraceContext;
    timings?: TraceTimings | null;
    timedOut?: boolean;
    error?: TraceError | null;
    finalPrompt?: string[];
    /** Time (ms) to first content token. */
    ttftMs?: number;
    /** Completion tokens per second (text emitted / generation time). */
    tokensPerSecond?: number | null;
    /** OpenRouter token usage (prompt/completion/total tokens + cost). */
    usage?: TraceUsage | null;
}

/** The normalized trace expected by the sidebar. */
export interface NormalizedTrace {
    query: string;
    retrieved: TraceHit[];
    rerank: TraceRerank;
    context: TraceContext;
    timings: TraceTimings | null;
    timedOut: boolean;
    error: TraceError | null;
    finalPrompt: string;
    /** Time (ms) to first content token. */
    ttftMs?: number;
    /** Completion tokens per second (text emitted / generation time). */
    tokensPerSecond?: number | null;
    /** OpenRouter token usage (prompt/completion/total tokens + cost). */
    usage?: TraceUsage | null;
}
