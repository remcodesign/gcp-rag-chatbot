/**
 * Inline citation validation — LLM citations are untrusted.
 *
 * Domain 5, Step 5.3. Strips `[Source N]` tokens that do not resolve in the
 * `sourceMap` and canonicalizes the token casing/whitespace for the ones that
 * do. The generator uses this to (a) refuse fabricated sources and (b) preserve
 * an ordered, deduped citation list for the client chips.
 */

import type { ListedSource, SourceMap } from '../types/rag.js';

const SOURCE_RE = /\[source\s*(\d+)\]/gi;

export function normalizeSourceToken(tok: unknown): { n: number; token: string } | null {
    const m = new RegExp(SOURCE_RE.source, 'i').exec(String(tok ?? ''));
    if (!m) return null;
    const n = Number(m[1]);
    return { n, token: `[Source ${n}]` };
}

export interface Citation {
    n: number;
    title: string;
}

export interface ValidateCitationsResult {
    text: string;
    citations: Citation[];
}

export function validateCitations(
    text: unknown,
    sourceMap: SourceMap = {},
): ValidateCitationsResult {
    const src = String(text ?? '');
    let out = src;
    const citations: Citation[] = [];
    const observed = new Set<number>();

    const replacer = (match: string, numStr: string): string => {
        const n = Number(numStr);
        if (sourceMap[n] != null) {
            if (!observed.has(n)) {
                observed.add(n);
                citations.push({ n, title: sourceMap[n].title });
            }
            return `[Source ${n}]`;
        }
        return '';
    };

    out = out.replace(SOURCE_RE, replacer);

    return {
        text: out.replace(/\s{2,}/g, ' ').trim(),
        citations,
    };
}

export function listSources(sourceMap: SourceMap = {}): ListedSource[] {
    const entries: Array<{ n: number; title: string; url: string; id?: string; text: string }> = [];
    for (const [n, s] of Object.entries(sourceMap)) {
        if (!s || !s.title) continue;
        entries.push({
            n: Number(n),
            title: s.title,
            url: s.url ?? '',
            id: s.id,
            text: s.text ?? '',
        });
    }
    return entries;
}