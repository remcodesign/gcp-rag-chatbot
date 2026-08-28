/**
 * Corpus source loader — reads Northwind Outfitters Markdown files from disk.
 *
 * Domain 4, Step 4.1. In the deployed Cloud Run Job the corpus is baked into
 * the image (immutable); loading is a simple recursive readdir of a directory.
 * Kept dependency-free (`node:fs/promises`).
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, sep } from 'node:path';

import type { Source } from './types/corpus.js';

/**
 * Reads all `*.md` files under `dir` into `{ id, content }` entries. `id` is the
 * relative path (stable, deterministic) so skipped-file logs are readable.
 * @param dir absolute path to the corpus directory.
 * @returns an array of `{ id, content }` source entries.
 */
export async function loadSources(dir: string): Promise<Source[]> {
    const entries = await walk(dir);
    const sources: Source[] = [];
    for (const file of entries) {
        const content = await readFile(file, 'utf8');
        const rel = file.replace(`${dir}${sep}`, '').replace(/\.md$/i, '').split(sep).join('/');
        sources.push({ id: rel, content });
    }
    return sources;
}

/** Recursively collects all `*.md` file paths under `dir`. */
async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    const s = await statSafe(dir);
    if (!s?.isDirectory()) return out;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
            out.push(...(await walk(full)));
        } else if (e.isFile() && extname(e.name).toLowerCase() === '.md') {
            out.push(full);
        }
    }
    return out;
}

async function statSafe(p: string) {
    try {
        return await stat(p);
    } catch {
        return null;
    }
}
