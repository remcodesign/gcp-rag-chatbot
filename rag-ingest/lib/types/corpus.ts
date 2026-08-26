/**
 * Corpus domain types — the shape of source files, parsed front-matter, chunks
 * and the manifest gate. These are the shared data contracts across
 * `chunker.ts`, `frontmatter.ts`, `manifest.ts`, `seeder.ts`, `orchestrate.ts`
 * and `loadSources.ts`.
 */

/** A raw corpus file on disk: `id` = deterministic relative path. */
export interface Source {
  id: string;
  content: string;
}

/** A parsed Markdown source (front-matter + body) — the success branch. */
export interface ParsedSource {
  id: string;
  category: string;
  title: string;
  url: string;
  /** Optional synonym/tag terms from the `tags:` front-matter key. */
  tags: string[];
  body: string;
}

/** A single deterministically-hashed chunk (id = SHA-256 of the chunk text). */
export interface Chunk {
  index: number;
  text: string;
  id: string;
  sourceId: string;
  category: string;
  title: string;
  url: string;
  /** Synonym/tag terms carried from the source front-matter. */
  tags: string[];
}

/** A chunk that failed to write — reported but non-fatal. */
export interface SkippedSource {
  id: string;
  reason: string;
}

/** The run outcome of `runSeed`. */
export interface SeedResult {
  status: 'seeded' | 'already-seeded';
  chunkCount: number;
  reason?: string;
  skipped: SkippedSource[];
}

/** Stored corpus manifest document. */
export interface ManifestSummary {
  version: string;
  chunkCount: number;
  model: string;
  dims: number;
  createdAt: number;
}

/** Result of the seed-needed gate. */
export interface SeedGate {
  needsSeed: boolean;
  reason: string;
}