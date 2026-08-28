/**
 * Front-matter parser — reads Northwind Outfitters Markdown source files.
 *
 * Domain 4, Step 4.1 (Location 1, editable Markdown). Each source file is a
 * Markdown doc with a YAML-ish front-matter block:
 *
 *   ---
 *   id: faq-returns-01
 *   category: returns
 *   title: "Return policy"
 *   url: /help/returns
 *   ---
 *
 *   ### How long do I have to return an item?
 *   ...
 *
 * The parser is deliberately minimal (no external YAML dep, per "no new
 * dependencies"): it handles `key: value` and `key: "quoted value"` lines.
 */

import type { ParsedSource } from './types/corpus.js';

/** Result of parsing a single source file (success or failure). */
export type ParseResult =
    | {
          ok: true;
          id: string;
          category: string;
          title: string;
          url: string;
          tags: string[];
          body: string;
      }
    | { ok: false; reason: string };

/** Required front-matter keys. A file missing any of these is skipped (logged). */
export const REQUIRED_KEYS = ['id', 'category', 'title', 'url'] as const;

export interface ParseOptions {
    requiredKeys?: readonly string[];
}

/** Parses a single `key: value` line, stripping surrounding quotes. */
export function parseKeyValue(line: string): { key: string; value: string } | null {
    const idx = line.indexOf(':');
    if (idx === -1) return null;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        value = value.slice(1, -1);
    }
    return { key, value };
}

/**
 * Splits a comma-separated tag string into trimmed, non-empty terms.
 * @param raw the raw `tags:` value (may be empty/undefined).
 * @returns a de-duplicated list of trimmed tags.
 */
export function parseTags(raw: string | undefined): string[] {
    if (!raw) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of raw.split(',')) {
        const t = part.trim();
        if (t && !seen.has(t)) {
            seen.add(t);
            out.push(t);
        }
    }
    return out;
}

/**
 * Parses a full Markdown source file into metadata + body.
 * @param raw         full file contents.
 * @param opts        `{ requiredKeys = REQUIRED_KEYS }` keys that must be
 *                    present or the file is considered invalid.
 * @returns the success shape `{ ok: true, id, category, title, url, body }` or
 *          the failure shape `{ ok: false, reason }`.
 */
export function parseSource(
    raw: string,
    { requiredKeys = REQUIRED_KEYS }: ParseOptions = {},
): ParseResult {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { ok: false, reason: 'empty file' };
    }
    const lines = raw.split(/\r?\n/);
    // Must start with the front-matter delimiter.
    if (lines[0]?.trim() !== '---') {
        return { ok: false, reason: 'missing opening front-matter delimiter' };
    }

    const meta: Record<string, string | undefined> = {};
    const bodyLines: string[] = [];
    let inFrontMatter = true;
    let closed = false;

    for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (inFrontMatter && line?.trim() === '---') {
            inFrontMatter = false;
            closed = true;
            continue;
        }
        if (inFrontMatter) {
            if (!line?.trim()) continue;
            const kv = parseKeyValue(line);
            if (kv) meta[kv.key] = kv.value;
            continue;
        }
        if (line !== undefined) bodyLines.push(line);
    }

    if (!closed) {
        return { ok: false, reason: 'unclosed front-matter block' };
    }

    const missing = requiredKeys.filter((k) => meta[k] === undefined || meta[k] === '');
    if (missing.length > 0) {
        return { ok: false, reason: `missing required front-matter: ${missing.join(', ')}` };
    }

    const body = bodyLines.join('\n').trim();
    if (!body) {
        return { ok: false, reason: 'empty body after front-matter' };
    }

    const parsed: ParsedSource = {
        id: meta.id ?? '',
        category: meta.category ?? '',
        title: meta.title ?? '',
        url: meta.url ?? '',
        tags: parseTags(meta.tags),
        body,
    };

    return { ok: true, ...parsed };
}
