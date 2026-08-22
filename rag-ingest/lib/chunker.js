/**
 * Chunker — splits a source body into overlapping chunks with deterministic
 * SHA-256 content-hash ids.
 *
 * Domain 4, Step 4.3. Doc ID = SHA-256 of chunk text => deterministic and
 * idempotent: re-running the seeder produces the same ids, so upserts are
 * no-ops.
 */

import { createHash } from 'node:crypto';

/**
 * Hashes arbitrary text to a stable hex id (SHA-256).
 * @param {string} text
 * @returns {string} 64-char hex digest.
 */
export function hashText(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

/**
 * Splits a text into chunks of `size` chars with `overlap` chars of shared
 * context between neighbours.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.size=800]
 * @param {number} [opts.overlap=120]
 * @returns {Array<{index:number, text:string, id:string}>}
 */
export function chunkText(text, { size = 800, overlap = 120 } = {}) {
  const body = String(text || '');
  if (!body.trim()) return [];
  const step = Math.max(1, size - overlap);
  const chunks = [];
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