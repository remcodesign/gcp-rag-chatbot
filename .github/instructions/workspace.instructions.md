---
description: "Use when working in the Demo RAG Northwind Outfitters demo (GCP + Node). Covers architecture invariants, Terraform/Cloud Run deployment, Node modules, and Firestore state/embedding conventions."
---<!-- leave a blank line above this comment; the YAML frontmatter ends on the `---` line above -->
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
- **ESM** (`"type": "module"`), **vitest** for tests. Each package has its own `vitest.config.js` → `test/**/*.test.js`.
- Public API: `lib/<domain>/index.js` re-exports a **factory via DI** + constants + errors. Pattern: `create*Store({deps}, options)` — `options` is ALWAYS the second arg.
- **Tests need zero cloud credentials** — use in-memory Firestore-shaped fakes (`test/fakes/fakeFirestore.js`, incl. `findNearest`, `batch().commit()`, `runTransaction`). Inject fake clock / short TTL for determinism; never use real timers.
- OpenRouter calls use Node built-in `fetch` (no new SDK dependency); Bearer from env `OPENROUTER_API_KEY` — never bake into the image, never log. Redact prompts/keys; log only model/count/latency.
- Error handling: non-retryable `.statusCode` abort (`INVALID_ARGUMENT`, `UNAUTHENTICATED`, `FORBIDDEN`); retry 429/5xx with `retryBaseMs * 2**attempt`. `normalizeError(err)` → `{message, statusCode, retryable}`.
- SSE: failure at end-of-series = SSE `error` event, **NOT** an HTTP 500. Mid-stream failures → regenerate info, never re-splice, capped `maxRegenRetries`. LLM citations are untrusted — `validateCitations` strips inline `[Source N]` not in the `sourceMap`.
- Tests on commit: `cd rag-api && npm test` (~51) and `cd rag-ingest && npm test` (~13).

## Terraform / deploy conventions
- Use wrappers: `./tf.sh <cmd>` (fetch credentials, run in `infra/`) and `./deploy.sh [build|push|plan|apply]`. Never run `deploy.sh apply` yourself — it's interactive.
- Region must match in `variables.tf`, `tf.sh`, `deploy.sh`, AND the registry prefix, or image refs don't resolve.

## Gotchas (highest-frequency agent mistakes)
1. **Commit BEFORE `deploy.sh plan/apply`.** Image tag = git short SHA of **HEAD**, not the working tree. Uncommitted edits → unchanged tag → `apply` reports "No changes". After a code change expect `2 to change` (Service + Job).
2. **Corpus path is `/app/corpus`** (Dockerfile `WORKDIR /app` + `COPY corpus ./corpus`, `ENV CORPUS_DIR=/app/corpus`, and the Cloud Run job env in `infra/cloud_run.tf`). Never write a bare `/corpus`.
3. **Seed job idempotency:** the seeder skips when the stored manifest `version` equals `CURRENT_VERSION` (currently `'4'`). To force a real re-seed, bump `CURRENT_VERSION` in `rag-ingest/lib/orchestrate.js`, commit, push/apply, then `gcloud run jobs execute rag-ingest --region=europe-west4`. A `chunkCount: 0` usually means a stale image tag (missing corpus) — commit first to bump the SHA.
4. **Vectors MUST be `FieldValue.vector(...)` (ROOT CAUSE of "no RAG").** Real Firestore only treats a field as a *vector* for `findNearest` when it is written with `FieldValue.vector(array)`. `rag-ingest/lib/seeder.js` `writeVectors` previously wrote a **plain array**, so `findNearest` returned nothing at query time and the generator silently answered without context (trace: `retrieved:[]`, `timings:null`). The in-memory fake stores a plain array, so unit tests pass even when the real write is wrong. After deploying the fix, chunks already seeded with plain arrays must be **re-seeded** (bump `CURRENT_VERSION`).
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
cd rag-api && npm test          # ~69 tests, no creds
cd rag-ingest && npm test       # ~13 tests, no creds
./deploy.sh build/push/plan     # build+push git-SHA tag; NEVER apply for the agent
./tf.sh plan                    # plan + HTML viewer (credentials via wrapper)
gcloud run jobs execute rag-ingest --region=europe-west4      # after apply, for corpus
```