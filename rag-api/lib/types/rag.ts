/**
 * Retrieval / context / pipeline contracts (Domain 3).
 *
 * The `Hit` shape, numbered source map, rerank results, stage timings and the
 * RAG `RunOutcome` / `Pipeline` surface that the generator consumes.
 */

import type { FirestoreDocumentData } from './firestore.js';
import type { ChatMessage } from './chat.js';

/** A retrieved chunk (document). Fields beyond `id` are optional shapes. */
export interface Hit extends FirestoreDocumentData {
    id: string;
    text?: string;
    title?: string;
    url?: string;
    category?: string | null;
    /** Present when `findNearest` returns `similarity` (a cosine distance). */
    similarity?: number;
    /** `1 - distance`, normalized to a "higher is better" score. */
    similarityScore?: number;
    distance?: number;
}

export interface SourceInfo {
    title: string;
    url: string;
    id?: string;
    text?: string;
}

/** Numbered `[Source N] -> info` mapping used for inline citation validation. */
export type SourceMap = Record<number, SourceInfo>;

export interface ListedSource {
    n: number;
    title: string;
    url: string;
    id?: string;
    text: string;
}

export interface RerankResult {
    hits: Hit[];
    didRerank: boolean;
    reason: string;
}

export interface StageTimings {
    /** LLM timing in (ms) */
    embed: number;
    retrieval: number;
    rerank: number;
    generation?: number;
    /** RAG-pipeline total (ms): embed + retrieve + rerank + context build. */
    total: number;
    /** End-to-end total (ms): pipeline `total` + LLM `generation`. */
    e2e?: number;
}

export interface RerankInfo {
    didRerank: boolean;
    reason: string;
}

/** Full result of `pipeline.run(...)` (happy and degraded/timeout paths). */
export interface RunOutcome {
    query: string;
    hits?: Hit[];
    retrievalHits?: Hit[];
    sourceMap: SourceMap;
    context: string;
    sources?: ListedSource[];
    rerankInfo?: RerankInfo | null;
    timings?: StageTimings | null;
    timedOut: boolean;
    error?: { message: string } | null;
}

/** The `pipeline.run` surface injected into the generator. */
export interface Pipeline {
    run(
        query: string,
        options?: { history?: ChatMessage[] },
    ): Promise<RunOutcome>;
}

// ---------------------------------------------------------------------------
// Embedder / reranker provider contracts
// ---------------------------------------------------------------------------

export interface Embedder {
    embed(text: string): Promise<number[]>;
    embedBatch?(
        texts: string[],
        options?: { dimensions?: number },
    ): Promise<number[][]>;
}

/** A reranking function: given the query + hits, returns a re-ranked list. */
export type RerankerFn = (query: string, hits: Hit[]) => Promise<Hit[]>;