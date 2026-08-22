# README - Local

## Pre-prompt (paste at top of every new chat)

---

> **VERY IMPORTANT — read and follow these instructions in order:**
>
> **VERY IMPORTANT — NEVER RUN `./tf.sh apply` and `./tf.sh destroy` YOURSELF, YOU CAN RUN PLAN:**

### 1.1 Load project context

Read the full build spec first — it is the single source of truth for this greenfield project:

```txt
docs/1-1-idea-specs.md
```

> document per domain in this format, example `docs/1-1-domain-2-external-client-arena.md`

- Important! Do not use special chars in the `Mermaid` diagram labels

- template for the document

```txt
docs/1-1-domain-X-XXX.md.  
```

### 1.2 Extra Documentation

Use the tool `context 7` for more indepth documentation about any of the project subjects.

### 2. Follow the locked decisions

These are locked — do not revisit without explicit approval:

- **Cloud Firestore** is both the vector store (`findNearest`, COSINE) and the session/event/message state store. No Cloud SQL, no VPC connector, no BigQuery.
- **OpenRouter** for both embeddings (`openai/text-embedding-3-small`, 1536 dims, batched array calls) and chat (streaming).
- **Cloud Run Service** `rag-api` = streaming backend (`timeout_seconds >= 300`, `container_concurrency >= 100`, session affinity).
- **Cloud Run Job** `rag-ingest` = one-time, idempotent corpus seeder (≤24h cap).
- **Terraform** owns all GCP resources (`infra/`).
- **Northwind Outfitters** = the fictional e-commerce corpus (products, faq, policies, loyalty, support).

### 3. Follow the build order

Build strictly in this order, domain by domain, with the exit state of each domain verified before moving on:

1. **Domain 1** — Terraform infrastructure skeleton (`infra/`)
2. **Domain 2** — Stateless session/event state in Firestore (`rag-api/lib/state/`)
3. **Domain 3** — RAG pipeline: retrieval + rerank (`rag-api/lib/rag/`)
4. **Domain 4** — Seed corpus job (`rag-ingest/`)
5. **Domain 5** — Streaming generation + source attribution (`rag-api/lib/generate/`)
6. **Domain 6** — Vue 3 frontend (`frontend/`)
7. **Domain 7** — Production hardening (SSE pitfalls)

### 4. Follow existing code style

Before creating or editing a file, check **sibling files** and **related code** for the current patterns:

- Creating a module? Look at existing modules in the same or neighboring directory.
- Creating a test? Check existing tests for the same patterns.
- Creating a Vue component? Check existing components for conventions.

### 5. Core rules

- **No overengineering** — keep it clean, simple, and consistent with the spec.
- **No new dependencies** without explicit approval.
- **Every step in the spec has happy + non-happy tests** — implement both when implementing the step.
- **Deterministic doc IDs** = SHA-256 of chunk text; writes must stay idempotent.
- **Never log** the full prompt text or API keys — log model, count, latency only.
- **Treat LLM-generated metadata as untrusted** — validate inline `[Source N]` citations against the source map.
- **Mid-stream LLM failure** → SSE `error` event + context-assisted regeneration (never re-splice, never HTTP 500 after the stream started).

### 6. After completing the job

Run these in order and fix any errors:

```bash
# Backend (Node)
npm test

# Frontend (builds assets, catches Vite/TypeScript errors)
npm run build

# Infra (when touching infra/)
terraform plan
```

### 7. Tests

- Update tests when the codebase changes — but first verify the code change is correct.
- No need for backward compatibility for most changes (or otherwise stated).
- Run affected tests to confirm they pass and if not fix the errors.

### 8. Verify before building (the only open items)

- Firestore vector-search (`findNearest`) GA availability in `europe-west1`.
- That the OpenRouter key can call `openai/text-embedding-3-small` and the chosen chat model (check pricing).

---

> **The job to be done:**
