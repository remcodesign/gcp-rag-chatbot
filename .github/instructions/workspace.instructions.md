---
description: "Use when working in the Demo RAG Northwind Outfitters demo (GCP + Node). Covers architecture invariants, Terraform/Cloud Run deployment, Node modules, and Firestore state/embedding conventions."
---

<!-- leave a blank line above this comment; the YAML frontmatter ends on the `---` line above -->
> **VERY IMPORTANT — read and follow these instructions in order:**
>
> **VERY IMPORTANT — NEVER RUN `./tf.sh apply` and `./tf.sh destroy` YOURSELF, YOU CAN RUN `./tf.sh plan`:**
>
> **VERY IMPORTANT — Do not use GCloud deployment or user.roles changes - only use Terraform and GIT**
>
> **VERY IMPORTANT — Do not use GIT commit and push yourself - only use GIT for checking state and history:**
>
> **VERY IMPORTANT — use `100% strict TypeScript` where possible, `.ts` files and non usage of `any`, (frontend) only use `TailwindCSS` styling - but can use (scoped) CSS if it is really needed**

# Demo RAG Northwind Outfitters — workspace guidelines

The canonical source of truth is `docs/1-1-idea-specs.md` and the `<domain>` docs, plus
`readme.md` for commands. These guidelines summarise the invariants and gotchas that must
not be reintroduced.

## Architecture invariants (do NOT change)
- **One Cloud Firestore `(default)` DB is BOTH the vector store** (`findNearest`, COSINE) **and the session/event/message state store.** Collections: `chunks`, `sessions`, `sessions/{id}/events`, `sessions/{id}/messages`, `corpus/manifest`.
- **OpenRouter ONLY** for embeddings (`openai/text-embedding-3-small`, 1536 dims, batched) and chat (`chat.send({model, messages, stream: true})`). Backend is fully **stateless**; any instance resumes a session from Firestore by `sessionId` — never cache sessions in memory.
- **NO Cloud SQL, NO VPC connector/network, NO BigQuery.** Google public network only; GCP footprint ≈ €0/mo.
- **Terraform is the SOLE deployment controller** — never `gcloud run deploy`. `infra/` owns all GCP resources; the app packages own none.
- **Releases are never a static `:latest`.** Every release pins a git-**short-SHA** tag committed to `infra/terraform.tfvars`.
- **100% strict TypeScript in `frontend/`, `rag-api/` AND `rag-ingest/`.** `frontend/` is `.ts` only, no `any`, gated by `vue-tsc` + ESLint `no-explicit-any`. `rag-api` and `rag-ingest` are `.ts` only, no `any`, `strict:true`, compiled to `dist/` via `tsconfig.build.json`. No new `.js` app files should be added to `frontend/` or `rag-api|rag-ingest/lib|src|test|scripts`.

## Environment (must all agree)
| Item | Value |
|------|-------|
| Project ID | `rag-demo-no-506313-t5` |
| Region (everywhere) | `europe-west4` |
| Cloud Run Service / Job | `rag-api` / `rag-ingest` |
| Registry | `europe-west4-docker.pkg.dev/rag-demo-no-506313-t5/rag/{rag-api,rag-ingest}:<git-sha>` |
| State bucket | `rag-demo-no-506313-t5-terraform-state` (prefix `terraform/state/<workspace>`) |
| Runner SA | `terraform-runner@rag-demo-no-506313-t5.iam.gserviceaccount.com` (key fetched from bucket by `tf.sh`) |
| App SAs | `rag-api-sa`, `rag-job-sa` (`datastore.user` + `secretmanager.secretAccessor` + Artifact Registry reader) |
| Service URL | `https://rag-api-4xxip75eoa-ez.a.run.app` |
| Health | `/livez` (200), `/readyz` (503 when Firestore down); `/healthz` is reserved by Cloud Run edge |

## Node conventions (`rag-api/`, `rag-ingest/`)
- **ESM** (`"type": "module"`), **vitest** for tests. Each package has its own `vitest.config.js` → `test/**/*.test.ts`.
- **`rag-api` and `rag-ingest` are 100% strict TypeScript — NO `.js` files in their `lib/`, `src/`, `test/`, and NO `any` anywhere** (ESLint enforces `@typescript-eslint/no-explicit-any: 'error'`). Each `tsconfig.json` is `strict: true`, `noImplicitAny: true`, `verbatimModuleSyntax`. Both compile to `dist/` via `tsconfig.build.json` (`npm run build`); the Dockerfiles compile in a build stage and run the compiled entry (`node dist/src/server.js` for rag-api, `node dist/src/cli.js` for rag-ingest). Shared cross-module types live in a `lib/types/` folder — `firestore.ts`, `corpus.ts`, `embedder.ts`, etc. — imported **directly** by domain file (no barrel), e.g. `import type { Hit } from '../types/rag.js'`.
- **NodeNext ESM gotcha:** source files are `.ts` but import specifiers keep the **`.js` suffix** (what `tsc` emits and what Node's ESM resolution expects). Vite/vitest does NOT map `.js`→`.ts` by default, so `vitest.config.js` ships a tiny `resolveJsImportsToTs` plugin to rewrite `.js` specifiers to `.ts` during tests.
- **`rag-api` and `rag-ingest` have NO `smoke` script** — their compile step (`tsc -p tsconfig.build.json`, `npm run build`) IS the module/export resolve guard: strict TS + `noImplicitAny` fail on a dangling import/export before push. (Previously `rag-ingest` kept `scripts/smoke.js` while it was checkJs `.js`.)
- **No `lib/<domain>/index.ts` barrels** — every consumer imports the domain factory file directly (`pipeline.js`, `sessionStore.js`, `generator.js`, ...). Types are also imported directly (no `types/` barrel). Pattern: `create*Store({deps}, options)` — `options` is ALWAYS the second arg.
- **No barrel files anywhere** (runtime or types): never add an `index.ts` that only re-exports (`export * from ...` / `export { ... } from ...`) to give a short import path. Import the concrete file directly (`pipeline.ts`, `sessionStore.ts`, `sse.ts`, `firestore.ts`, ...). This applies to `frontend/` too (`frontend/src/types/` has no `index.ts`). If a name is needed in two domains, re-export it from its owning file — do not build a barrel.
- **Tests need zero cloud credentials** — use in-memory Firestore-shaped fakes (`test/fakes/fakeFirestore.ts`, incl. `findNearest`, `batch().commit()`, `runTransaction`), typed against the `Firestore` interface in `lib/types/firestore.ts`. Inject fake clock / short TTL for determinism; never use real timers.
- OpenRouter calls use Node built-in `fetch` (no new SDK dependency); Bearer from env `OPENROUTER_API_KEY` — never bake into the image, never log. Redact prompts/keys; log only model/count/latency.
- Error handling: non-retryable `.statusCode` abort (`INVALID_ARGUMENT`, `UNAUTHENTICATED`, `FORBIDDEN`); retry 429/5xx with `retryBaseMs * 2**attempt`. `normalizeError(err)` → `{message, statusCode, retryable}`.
- SSE: failure at end-of-series = SSE `error` event, **NOT** an HTTP 500. Mid-stream failures → regenerate info, never re-splice, capped `maxRegenRetries`. LLM citations are untrusted — `validateCitations` strips inline `[Source N]` not in the `sourceMap`.
- Tests on commit: `cd rag-api && npm test` (~70) and `cd rag-ingest && npm test` (~13).

## Frontend conventions (`frontend/` — 100% strict TypeScript)
- **The frontend is 100% TypeScript — NO `.js` files in `src/` or `test/`, and NO `any` anywhere.** All modules are `.ts` (`.vue` SFCs use `<script setup lang="ts">`); `.ts` types live in `frontend/src/types/` organized per type-set (`sse.ts`, `chat.ts`, `trace.ts`, `markdown.ts`, `config.ts`) with **no `index.ts` barrel** — each type file is imported directly.
- Type-check = `npm run typecheck` → **`vue-tsc --noEmit`** (`tsconfig.json`: `strict: true`, `noImplicitAny: true`, `verbatimModuleSyntax` — so all type-only imports must use `import type`). ESLint enforces `@typescript-eslint/no-explicit-any: 'error'`.
- **Styling is 100% Tailwind utilities in `App.vue`** — do NOT add component classes to `src/style.css`. `style.css` is only the `@import 'tailwindcss'` + `@theme`/`:root` tokens + `body` reset. Theme tokens are referenced via `var(--accent)` etc. in arbitrary-key utilities (`bg-[var(--accent)]`) and in the small scoped `<style>` that styles the `v-html` markdown output (`.answer`/`.citation`).
- SSE `frame.data` is `unknown` and **narrowed** at each consumer — never `any`.
- `rag-api` AND `rag-ingest` are now strict TS (like `frontend/`): no `.js` app files, no `any`.
- Keep `@typescript-eslint` + `vue-eslint-parser` in the flat ESLint config (required for `.ts` + `.vue` parsing).

## Terraform / deploy conventions
- Use wrappers: `./tf.sh <cmd>` (fetch credentials, run in `infra/`) and `./deploy.sh [build|push|plan|apply]`. Never run `deploy.sh apply` yourself — it's interactive.
- Region must match in `variables.tf`, `tf.sh`, `deploy.sh`, AND the registry prefix, or image refs don't resolve.

## Gotchas (highest-frequency agent mistakes)
1. **Commit BEFORE `deploy.sh plan/apply`.** Image tag = git short SHA of **HEAD**, not the working tree. Uncommitted edits → unchanged tag → `apply` reports "No changes". After a code change expect `2 to change` (Service + Job).
2. **Corpus path is `/app/corpus`** (Dockerfile `WORKDIR /app` + `COPY corpus ./corpus`, `ENV CORPUS_DIR=/app/corpus`, and the Cloud Run job env in `infra/cloud_run.tf`). Never write a bare `/corpus`.
3. **Seed job idempotency:** the seeder skips when the stored manifest `version` equals `CURRENT_VERSION` (currently `'5'`). To force a real re-seed, bump `CURRENT_VERSION` in `rag-ingest/lib/orchestrate.ts`, commit, push/apply, then `gcloud run jobs execute rag-ingest --region=europe-west4`. A `chunkCount: 0` usually means a stale image tag (missing corpus) — commit first to bump the SHA.
4. **Vectors MUST be `FieldValue.vector(...)` (ROOT CAUSE of "no RAG").** Real Firestore only treats a field as a *vector* for `findNearest` when it is written with `FieldValue.vector(array)`. `rag-ingest/lib/seeder.ts` `writeVectors` previously wrote a **plain array**, so `findNearest` returned nothing at query time and the generator silently answered without context (trace: `retrieved:[]`, `timings:null`). The in-memory fake stores a plain array, so unit tests pass even when the real write is wrong. After deploying the fix, chunks already seeded with plain arrays must be **re-seeded** (bump `CURRENT_VERSION`).
4b. **Firestore VECTOR INDEX is required for `findNearest` (the real "RAG not trying" fix).** Even with `FieldValue.vector(...)` chunks, `findNearest` throws `FAILED_PRECONDITION: Missing vector index configuration` unless a vector index exists on the `chunks` collection's `embedding` field. `withSoftTimeout` swallows that into `retrieved: []`, so the app "tries" (embed ~400ms, retrieval 0ms) but returns nothing. The fix is `google_firestore_index` in `infra/firestore.tf`: `fields { field_path="__name__"; order="ASCENDING" }` + `fields { field_path="embedding"; vector_config { dimension=1536; flat {} } }`. An `apply` is required to create it. **Note:** vector index creation is async and can take ~2–3 min (`STILL CREATING`); `./tf.sh apply` blocks until it's `READY`. Now verified working live (see Domain 4 §9.5).
4c. **Context is now capped (was greedy):** retrieval used to feed ~all top-20 chunks into the LLM context (no cap) — a query's trace showed 15+ sources incl. irrelevant ones (tent, cadeaukaarten, retourbeleid). FIX: `buildContext` `maxSources` (default 5) + relevance floor; server passes `minScore:0.35, maxSources:5`. The RAG trace still lists all retrieved hits (`retrieved` list) but `context.sources` now stays ≤5.
5. **`withSoftTimeout` swallows rejections (silent degrade):** `rag-api/lib/rag/limiter.js` only handled timeouts — a **rejected** wrapped task (embed/`findNearest` error) propagated out of `pipeline.run()` and threw, and the generator's catch silently answered with no context. It now `.catch(() => ({ timedOut:true, value:fallback }))`, treating a rejection like a timeout so retrieval never throws. If the RAG trace shows `error:{message}` + `timedOut:true`, investigate the retrieval path here.
6. **Query-time embed timeout:** `rag-api/src/server.js` `createPipeline` passes `{ embedTimeoutMs: 8000, retrieveTimeoutMs: 4000 }` — the 1500ms default embed soft timeout is too tight for a real OpenRouter embed.
7. **Provider gotchas:** use `google_cloud_run_v2_job` (no GA v1 job) with `deletion_protection = false`. v2 inner `template` has NO `spec` block (`timeout`/`service_account`/`containers` directly inside); `task_count`/`parallelism` on the OUTER `template`. Service stays v1; v1 secret ref = `secret_key_ref { key="latest" }`, v2 job = `secret_key_ref { secret, version }`. Mixing them fails `terraform validate`.
8. **`.gitignore *.tfvars`** must negate with `!**/terraform.tfvars` so the committed tag is tracked.
9. **Stale `.tflock`** in the bucket after an aborted plan → `Error 412 conditionNotMet`. Clear: `gcloud storage rm gs://<bucket>/terraform/state/default.tflock`.
10. **`deploy.sh push` only fills the registry** — a new tag must still be `apply`d to reach Cloud Run.

## Quick references (canonical)
```bash
# Type-checking (all packages gated in deploy.sh):
cd rag-api      && npm run typecheck && npm run lint && npm test && npm run build   # ~70 tests, no creds; build IS the strict-TS resolve guard
cd rag-ingest   && npm run typecheck && npm run lint && npm test && npm run build   # ~13 tests, no creds; build IS the strict-TS resolve guard
cd frontend   && npm run typecheck && npm run lint && npm test && npm run build   # strict TS, ~41 tests (vue-tsc)

./deploy.sh build/push/plan     # build+push git-SHA tag; NEVER apply for the agent
./tf.sh plan                    # plan + HTML viewer (credentials via wrapper)
gcloud run jobs execute rag-ingest --region=europe-west4      # after apply, for corpus
```