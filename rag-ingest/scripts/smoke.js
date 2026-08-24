#!/usr/bin/env node
// Domain 9 / Step 9.3 — startup/import smoke test for the seed Job.
// Importing the whole `lib` graph forces Node to resolve every export before
// we run anything; a dangling import/export exits non-zero and blocks the
// build. `src/cli.js` only runs `main()` when invoked directly (it guards on
// `import.meta.url`), so importing it here never seeds anything.

const entries = [
  '../lib/chunker.js',
  '../lib/frontmatter.js',
  '../lib/index.js',
  '../lib/loadSources.js',
  '../lib/manifest.js',
  '../lib/openRouterEmbedder.js',
  '../lib/orchestrate.js',
  '../lib/seeder.js',
  '../src/cli.js',
];

for (const spec of entries) {
  await import(spec);
}

console.log('smoke ok: rag-ingest entrypoints import cleanly');