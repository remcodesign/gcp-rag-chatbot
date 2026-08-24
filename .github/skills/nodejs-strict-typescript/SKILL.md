---
name: nodejs-strict-typescript
description: "Use when building or converting a Node.js app to production-grade strict TypeScript: 100% strict + no `any`, a per-domain `types/` folder with one type file per domain imported directly (NO index.ts type barrel), ESM/NodeNext `.js`-suffixed imports, type-checked-as-compile guard, DI factories with typed boundaries, Vitest with .ts tests and an in-memory Firestore-shaped fake, plus lint/Docker/deploy wiring."
argument-hint: "Describe the Node.js package or service you're building or converting to strict TypeScript."
---

# Node.js — 100% Strict TypeScript

Use this skill to build or convert a Node.js app to **production-grade strict
TypeScript**, the way `rag-api` (gcp_rag_chat) was. It is the operative companion
to the workspace instructions and records hard-won, recurring gotchas so they
are not relearned each time.

## Locked decisions
- **Strict TS everywhere it applies**: `strict: true`, `noImplicitAny: true`,
  `strictNullChecks` (implied), `verbatimModuleSyntax`, `isolatedModules`,
  `noUncheckedIndexedAccess` (aggressive but worth it). ESLint enforces
  `@typescript-eslint/no-explicit-any: 'error'`.
- **No `.js` source files** in `lib/`, `src/`, `test/` (`scripts/` only if a
  smoke test still exists). No `any` anywhere — use `unknown` and narrow.
- **A `types/` folder with ONE file per type domain, imported directly — NO
  `index.ts` type barrel.** Direct imports expose which domain owns a type and
  remove `export *` collision risk.
- **`build` (`tsc --noEmit -p tsconfig.build.json`) IS the module/export resolve
  guard** — strict TS fails on a dangling import/export before any image push.
  A standalone `smoke` script is NOT needed for strict-TS packages (see below).
- **Factory via DI**: `create*Thing({deps}, options)` — `options` is ALWAYS the
  second arg. Factories return an explicitly-typed interface.
- **ESM**: `"type": "module"`, NodeNext module/moduleResolution, sources are
  `.ts` but import specifiers keep the **`.js` suffix** (what the bundler emits
  and Node's ESM resolution expects).
- **Tests need zero cloud credentials** — inject an in-memory fake / fake clock.

## Type organization — the `types/` folder (NO barrel)

Put shared cross-module types in `lib/types/` (or `src/types/`), ONE file per
type domain, and import them **directly in the normal `.ts` files**:

```
lib/types/
  firestore.ts   # persistence/db boundary (Firestore-shaped)
  rag.ts         # retrieval / context / pipeline contracts
  chat.ts        # chat / SSE / generator provider contracts
  state.ts       # minimal state-store surface
  trace.ts       # observability / trace payload
```

There is **NO `index.ts` in the types folder.** Import directly:

```ts
// lib/rag/retriever.ts
import type { Embedder, Hit } from '../types/rag.js';
import type { Firestore } from '../types/firestore.js';
```

Why not a barrel:
- A barrel (`export * from './x.js'`) hides which domain owns a type and can
  **silently collides** if two files ever export the same name.
- Direct imports show ownership at a glance, are collision-immune, and give
  crisp jump-to-definition.
- A barrel is only worth keeping for an external _public_ API surface; internal
  `lib/` + `test/` do not need one.

Keep the **runtime** domain entrypoint barrels that export *functions/classes*
(e.g. `lib/state/index.ts` exporting `createStateStore` + constants + errors) —
that is a legitimate public API. Only the **types/** folder omits a barrel.

## tsconfig layout

- `tsconfig.json` — the strict typecheck gate: `noEmit: true`, includes
  `lib/**/*.ts`, `src/**/*.ts`, `test/**/*.ts`.
- `tsconfig.build.json` — emits to `dist/`: extends the base but `noEmit: false`,
  `outDir: './dist'`, `rootDir: '.'`, `declaration:true`, `sourceMap:true`, and
  includes only `lib/**/*.ts` + `src/**/*.ts` (not tests, not smoke).
- `npm run build` = `tsc -p tsconfig.build.json`; `npm run start` = `node dist/src/server.js`.

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "strict": true, "noImplicitAny": true, "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true, "verbatimModuleSyntax": true,
    "isolatedModules": true, "noEmit": true, "skipLibCheck": true,
    "resolveJsonModule": true, "types": ["node"]
  },
  "include": ["src/**/*.ts", "lib/**/*.ts", "test/**/*.ts"]
}
```

> Keep new packages/apps on this same `tsconfig` — do not loosen `strict` to
> silence new code.

## Smoke test — when to keep it

- `.js`/`checkJs` packages (i.e. packages still type-checked via JSDoc with
  `checkJs:true` and NO strict mode) **keep a `scripts/smoke.js`** that imports
  every entrypoint: tsc-checkJs only catches *unresolved* things partially; a
  runtime import graph is the guard.
- **Strictly-TS packages compiled via `tsc -p tsconfig.build.json` do NOT need
  a smoke test.** `npm run build` resolves the entire module/export graph and
  fails on a missing export (`TS2305 Module has no exported member ...`) before
  any image push. Proven in the migration: purposefully breaking
  `validateCitations` made `npm run build` fail immediately. Vitest alone would
  NOT catch it (tests only import the exports they use) — but the compile DOES.
- So: strict-TS package gate = `typecheck` → `lint` → `test` → `build`, no smoke.

## Vitest + NodeNext `.ts` resolution (CRITICAL GOTCHA)

Vite/vitest does **NOT** map a `.js`-suffixed specifier to the `.ts` source by
default, and if a `dist/` build output is present it may resolve the compiled
JS and fail on its transitive `.js` imports. Fix with a tiny resolve plugin in
`vitest.config.js` (NOT a config `.ts`):

```js
import { defineConfig } from 'vitest/config';

function resolveJsImportsToTs() {
  return {
    name: 'resolve-js-to-ts',
    enforce: 'pre',
    resolveId(source) {
      if (/\.js$/.test(source) && !source.startsWith('node:')) {
        return this.resolve(`${source.slice(0, -3)}.ts`);
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveJsImportsToTs()],
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

Now `npm test` resolves `.ts` sources even when `dist/` was just built.

## Testing without cloud credentials — the Firestore-shaped fake

Tests use an in-memory double typed against the same `Firestore` boundary the
`lib/` code uses, so the same code paths run without a real cloud client. The
fake must implement: `collection()`, `collection().doc/.orderBy/.startAfter/
.findNearest/.limit/.get`, `runTransaction(fn)` with a transaction object
(`get/set/update`), and `batch().commit()` for vector bulk writes.

```ts
import type { Firestore, FirestoreDocumentData, FirestoreCollectionRef } from '../lib/types/firestore.js';

export function createFakeFirestore() { /* in-memory Map keyed by path join('\u0000') */ }
```

Gotchas:
- Fake stores a plain `number[]` for embeddings; **real Firestore requires
  `FieldValue.vector(...)`** for `findNearest` — the fake will NOT catch a
  real-write regression, so add a reminder to verify with a real query after
  deploy.
- Inject a fake `clock` / short TTL for determinism; never use real timers.

## `noImplicitAny` + `noUncheckedIndexedAccess` specifics
- Under `noUncheckedIndexedAccess`, `arr[i]` is `T | undefined` — use `arr[i] ?? x`,
  a loop `if (raw === undefined) break;` guard, or a local-null-check even when you
  "know" it has length.
- When the fallback type matters (e.g. `withSoftTimeout(..., { fallback })`), type
  the fallback to the resolved value type (`fallback: 'fallback'`, not `[]`) or the
  generic inference fails.
- Chain lookups on maps/records and `.at(-1)`: guard explicitly or use a `?? default`
  so a missing key is handled, not a crash.

## Type-safety gotchas (from the migration)
1. **`verbatimModuleSyntax`** ⇒ all type-only imports use `import type { ... }`.
2. **`new Error(...)` + custom `.statusCode`/`.retryable`**: cast
   `as unknown as { statusCode?: number }` or a typed `Error & {...}`.
3. **`res.json()` is `unknown`** ⇒ cast to a typed shape: `as { data?: ... }`.
4. **A large pipeline `RunOutcome`** — model it with a single interface so happy
   + degraded/timeout paths share a shape; use `T | null` / optional props for
   presenter fields.
5. **An object literal with `this.foo` inside a method** loses narrowing when
   assigned to a typed interface. Assign a fully-typed local `const` first and
   reference it (or type `this`).
6. **Do not over-narrow** `const obj = { status: 'idle' }` if it's written later
   with a different value — type the property as a union literal upfront.
7. **Async-iterable fakes** — type them as an interface with
   `[Symbol.asyncIterator]()`; make a `toStream(gen: () => AsyncGenerator<...>)`
   helper that returns the expected `ChatStream` instead of passing raw generators.

## The DI factory pattern with explicit types
```ts
interface RetrieverDeps { firestore: Firestore; embeddings: Embedder; }
interface Retriever { retrieve(...): Promise<Hit[]>; ... }

export function createRetriever(deps: RetrieverDeps, options: RetrieverOptions = {}): Retriever {
  // ...
}
```
- Dependencies are injected; the real cloud client is the ONLY place a
  cast `as unknown as Firestore` should live (in `src/server.ts`).
- Test the factory with fakes; never import the real SDK in `lib/`.

## The `src/server.ts` boundary
Keep `lib/` framework- and paas-agnostic. The real `@google-cloud/firestore`
client (and any platform-specific cast) lives ONLY in `src/server.ts`:

```ts
const firestore = new Firestore() as unknown as FirestoreShaped;
```

## ESLint flat config for `.ts`
Add `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin`. Separate
config objects for source vs test (`languageOptions.parser` MUST be set on each
or Espree tries to parse `.ts`):

```js
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

{
  files: ['lib/**/*.ts', 'src/**/*.ts'],
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    globals: { /* node + fetch + AbortController + crypto ... */ } },
  plugins: { '@typescript-eslint': tsPlugin },
  rules: { ...tsPlugin.configs.recommended.rules,
    '@typescript-eslint/no-explicit-any': 'error' },
}
```

Test globals (describe/it/expect/vi...) and `no-unused-vars: 'off'` are helpers
it stops flagging unused test imports.

## Docker
Multi-stage; install dev deps, `tsc` emit to `dist/`, prune dev deps, run the
compiled output:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY lib ./lib && COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
EXPOSE 8080
USER node
CMD ["node", "dist/src/server.js"]
```

## Deploy/CI ordering
`deploy.sh run_checks` per package: `typecheck` → `lint` → `test` → `build`
(for strict-TS packages). Keep a `build` step as the resolve guard; the Docker
build itself also gates. `rag-ingest`-style checkJs packages keep the smoke.

## Every type file, a single responsibility
Prefer **one domain per file** so changes localize. If a type is needed in two
domains, re-export it, do not duplicate it.