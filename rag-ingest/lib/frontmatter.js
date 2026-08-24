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

/** Required front-matter keys. A file missing any of these is skipped (logged). */
export const REQUIRED_KEYS = ['id', 'category', 'title', 'url'];

/** Parses a single `key: value` line, stripping surrounding quotes. */
export function parseKeyValue(line) {
  const idx = line.indexOf(':');
  if (idx === -1) return null;
  const key = line.slice(0, idx).trim();
  let value = line.slice(idx + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

/**
 * Parses a full Markdown source file into metadata + body.
 *
 * @param {string} raw   full file contents.
 * @param {object} [opts]
 * @param {Array<string>} [opts.requiredKeys=REQUIRED_KEYS]  keys that must be
 *   present or the file is considered invalid.
 * @returns {{ ok: true, id: string, category: string, title: string, url: string, body: string } | { ok: false, reason: string }}
 */
export function parseSource(raw, { requiredKeys = REQUIRED_KEYS } = {}) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: 'empty file' };
  }
  const lines = raw.split(/\r?\n/);
  // Must start with the front-matter delimiter.
  if (lines[0].trim() !== '---') {
    return { ok: false, reason: 'missing opening front-matter delimiter' };
  }

  const meta = {};
  let bodyLines = [];
  let inFrontMatter = true;
  let closed = false;

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (inFrontMatter && line.trim() === '---') {
      inFrontMatter = false;
      closed = true;
      continue;
    }
    if (inFrontMatter) {
      if (!line.trim()) continue;
      const kv = parseKeyValue(line);
      if (kv) meta[kv.key] = kv.value;
      continue;
    }
    bodyLines.push(line);
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

  return {
    ok: true,
    id: meta.id,
    category: meta.category,
    title: meta.title,
    url: meta.url,
    body,
  };
}