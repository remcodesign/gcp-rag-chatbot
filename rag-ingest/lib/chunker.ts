/**
 * Chunker — splits a source body into overlapping chunks with deterministic
 * SHA-256 content-hash ids.
 *
 * Domain 4, Step 4.3. Doc ID = SHA-256 of chunk text => deterministic and
 * idempotent: re-running the seeder produces the same ids, so upserts are
 * no-ops.
 */

import { createHash } from 'node:crypto';

/** A single chunk with its deterministic content-hash id. */
export interface ChunkPiece {
    index: number;
    text: string;
    id: string;
}

export interface ChunkOptions {
    size?: number;
    overlap?: number;
}

/**
 * Hashes arbitrary text to a stable hex id (SHA-256).
 * @param text text to hash.
 * @returns 64-char hex digest.
 */
export function hashText(text: string): string {
    return createHash('sha256').update(String(text)).digest('hex');
}

/**
 * Splits a text into chunks of `size` chars with `overlap` chars of shared
 * context between neighbours.
 * @param text   the body to chunk.
 * @param opts   `{ size = 800, overlap = 120 }`.
 * @returns an array of `{ index, text, id }` chunks (empty for blank input).
 */
export function chunkText(text: string, { size = 800, overlap = 120 }: ChunkOptions = {}): ChunkPiece[] {
    const body = String(text || '');
    if (!body.trim()) return [];
    const step = Math.max(1, size - overlap);
    const chunks: ChunkPiece[] = [];
    for (let start = 0; start < body.length; start += step) {
        const textChunk = body.slice(start, start + size).trim();
        if (!textChunk) continue;
        chunks.push({
            index: chunks.length,
            text: textChunk,
            id: hashText(textChunk),
        });
    }
    return chunks;
}