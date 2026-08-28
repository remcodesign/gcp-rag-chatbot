/**
 * Context + source map construction.
 *
 * Domain 3, Step 3.5. Assembles the numbered prompt context and a
 * `sourceId -> { title, url }` mapping used by the generator for citations.
 * Drops empty / low-relevance docs so the LLM sees clean context.
 */

import type { Hit, ListedSource, SourceMap } from '../types/rag.js';

interface RelevanceOptions {
    minScore?: number;
}

export function isRelevant(hit: Hit, { minScore = 0.3 }: RelevanceOptions = {}): boolean {
    const score = hit.similarityScore ?? 1 - (hit.distance ?? 0);
    if (typeof hit.text !== 'string' || hit.text.trim().length < 20) return false;
    return score >= minScore;
}

export interface BuildContextResult {
    sourceMap: SourceMap;
    context: string;
    sources: ListedSource[];
}

interface BuildContextOptions {
    /** Relevance floor (default 0.3). */
    minScore?: number;
    /** Hard cap on sources in the context (default 5). */
    maxSources?: number;
}

/**
 * Builds the prompt context lines and a source map for citations.
 */
export function buildContext(
    hits: Hit[],
    { minScore = 0.3, maxSources = 10 }: BuildContextOptions = {},
): BuildContextResult {
    const kept = (Array.isArray(hits) ? hits : [])
        .filter((h) => isRelevant(h, { minScore }))
        .slice(0, maxSources);

    const sourceMap: SourceMap = {};
    const sources: ListedSource[] = [];
    const lines: string[] = [];

    kept.forEach((hit, idx) => {
        const n = idx + 1;
        const title = hit.title || 'Untitled source';
        const url = hit.url || '';
        sourceMap[n] = { title, url, id: hit.id, text: hit.text ?? '' };
        sources.push({
            n,
            title,
            url,
            id: hit.id,
            text: hit.text ?? '',
        });
        lines.push(`[Source ${n}] ${String(hit.text).trim()}`);
    });

    return {
        sourceMap,
        context: lines.join('\n\n'),
        sources,
    };
}
