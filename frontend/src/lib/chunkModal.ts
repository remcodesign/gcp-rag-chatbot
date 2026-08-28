/**
 * Chunk modal helpers — Domain 6, Step 6.4 (POC).
 *
 * Opening a source chip / trace hit shows the chunk text in a modal instead of
 * navigating to a new page. This module turns a `Source` (from the transcript
 * chips) or a `TraceHit` (from the RAG trace sidebar) into the shape the
 * `ChunkModal` component renders. It is a pure function so it stays
 * unit-testable without mounting a component.
 */

import type { Source } from '../types/sse';
import type { TraceHit } from '../types/trace';

/** The currently selected chunk shown in the modal. */
export interface ChunkModal {
    title: string;
    url: string;
    id: string;
    text: string;
    score?: number | null;
}

/**
 * Normalizes a clicked source chip or trace hit into a `ChunkModal`, or null
 * when the chunk is falsy.
 *
 * @param chunk a `Source` (transcript chip) or `TraceHit` (trace sidebar).
 * @returns the modal payload, or null when `chunk` is falsy.
 */
export function toChunkModal(chunk: Source | TraceHit): ChunkModal | null {
    if (!chunk) return null;
    const id = 'id' in chunk ? chunk.id : '';
    return {
        title: chunk.title ?? '',
        url: chunk.url ?? '#',
        id,
        text: 'text' in chunk && typeof chunk.text === 'string' ? chunk.text : '',
        score: 'score' in chunk ? chunk.score : null,
    };
}
