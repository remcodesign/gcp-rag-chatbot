---
name: nuxt-frontend-bff
description: "Use when building, reviewing, or debugging the Nuxt 3 frontend in this repo: the SSR page + Nitro server layer that acts as the Backend-for-Frontend (BFF) for the private rag-api. Covers SSR, the Nitro BFF routes (rate-limiting + SSE proxy + OIDC IAM), runtime config, local dev (RAG_API_BASE + no metadata server), deployment via Terraform/Cloud Run, and the strict-TS + Tailwind conventions."
argument-hint: "Describe the Nuxt frontend, Nitro BFF route, SSE proxy, rate limiting, OIDC/IAM, local dev, or frontend deployment you need."
---

# Nuxt Frontend + Nitro BFF (rag-frontend)

Use this skill when working on the **Nuxt 3 frontend** of the RAG demo. It is
the successor to the abandoned `rag-bff` + nginx proxy architecture. The
frontend is **not** a static SPA anymore — it is a **Nuxt 3 app with SSR** whose
**Nitro server layer IS the BFF**: it rate-limits and proxies the SSE stream to
the **private** `rag-api` server-to-server.

```
Browser → Nuxt (SSR + Nitro BFF) ──server-to-server──▶ rag-api (PRIVATE, IAM)
              │
              ├─ SSR renders the page (index.vue)
              ├─ Nitro POST /api/sessions/:id/messages → rate-limit → OIDC token → proxy SSE to rag-api
              └─ Nitro GET  /api/limits/:sessionId      → rate-limit usage (POC sidebar)
```

This eliminates the entire nginx saga (buffers, GAESA cookies, worker_connections,
scale-to-zero DNS)

## Locked decisions
- **Nuxt 3, `ssr: true`** — the page renders server-side; the Nitro server layer is the BFF.
- **Browser talks to Nuxt SAME-ORIGIN** — `resolveApiBase()` returns `''`; no cross-origin call, no CORS from the browser.
- **Nitro proxies to the PRIVATE `rag-api`** using the Nitro service's IAM identity (OIDC token from the metadata server) — only on Cloud Run.
- **Rate-limiting lives in Nitro** (per client IP + per session), the natural BFF choke point.
- **100% strict TypeScript** — `.ts` only, no `any`, gated by `vue-tsc` + ESLint `no-explicit-any`.
- **Styling is 100% Tailwind utilities**; scoped CSS only if truly needed (e.g. `v-html` markdown output).
- **No new dependencies** without explicit approval.

## Directory map (`frontend/`)
```
frontend/
  app.vue                 # thin composition root: <NuxtPage />
  nuxt.config.ts          # SSR, runtimeConfig (RAG_API_BASE + RATE_*), Tailwind vite plugin
  pages/index.vue         # the chat page (composition root for the UI)
  components/             # ChatHeader, ChatInput, ChatThread, ChunkModal, ... (Tailwind)
  composables/useLimits.ts# reactive rate-limit sidebar state
  lib/                    # pure logic: chatStore, sseTransport, sseParser, citations, markdown, trace, config, limits, chunkModal, sampleQuestions, format
  types/                  # per-domain type files (chat.ts, sse.ts, trace.ts, config.ts, markdown.ts) — NO barrel
  server/
    api/sessions/[id]/messages.post.ts   # BFF: rate-limit + OIDC + proxy SSE
    api/limits/[id].get.ts               # BFF: rate-limit usage (POC)
    utils/rateLimit.ts                   # in-memory sliding-window limiter
    utils/oidc.ts                        # isCloudRun() + fetchIdToken() (IAM)
  test/                   # vitest unit tests (node env, no cloud creds)
  .env.example            # local dev template (copy to .env)
  Dockerfile              # multi-stage: nuxt build → node .output/server/index.mjs
```

## The Nitro BFF routes

### `POST /api/sessions/:id/messages` — the SSE proxy
`frontend/server/api/sessions/[id]/messages.post.ts`:
1. **Rate-limits** first (per client IP + per session) — the expensive LLM call must not run if the caller is over budget. Rejects with 429.
2. Reads `config.ragApiBase` (from `RAG_API_BASE`). If empty → `500 RAG_API_BASE not configured`.
3. **On Cloud Run only**, mints an OIDC token for the rag-api audience and sends `Authorization: Bearer <token>`. **Locally, no auth header** (a local rag-api isn't IAM-protected).
4. Proxies the POST to `${ragApiBase}/sessions/:id/messages` and **streams the SSE response back unchanged** (`text/event-stream`, `X-Accel-Buffering: no`).

### `GET /api/limits/:sessionId` — rate-limit usage (POC)
`frontend/server/api/limits/[id].get.ts` returns `{ ip: LimitWindow, session: LimitWindow }` for the trace sidebar. **POC affordance** — normally you would not expose rate-limit internals to the client.

**The client-side bridge — `lib/limits.ts` `fetchLimits()` (still needed):**
The BFF being "inside the frontend" does NOT remove the need for `fetchLimits`. The Nitro route runs **server-side** (in the Nuxt server) and reads the in-memory rate-limiter; the browser **cannot** read that in-memory state directly. `fetchLimits` is the **browser-side** function that makes an HTTP `fetch` to `/api/limits/:sessionId`, which the Nitro server handles:

```
Browser (useLimits.ts)
  └─ fetchLimits(sessionId)          ← lib/limits.ts (CLIENT-side)
       └─ GET /api/limits/:sessionId  ← Nitro BFF route (SERVER-side)
            └─ reads in-memory rate-limiter
```

`useLimits.ts` calls `fetchLimits` (on demand: after each message + when the trace panel opens) to populate the POC sidebar. `resolveApiBase()` returns `''` (same-origin), so the browser calls `/api/limits/...` on the Nuxt origin — no cross-origin, no CORS. `fetchLimits` returns `null` on failure so the sidebar degrades gracefully.

### `server/utils/rateLimit.ts`
In-memory sliding-window counter keyed on client IP + session id. **Per-instance and lost on scale-to-zero** — a best-effort burst bound, not a durable global limit. For a durable + global limit, move the counter to a shared store (e.g. Firestore).

### `server/utils/oidc.ts` — the local-vs-Cloud-Run switch (KEY)
```ts
export function isCloudRun(): boolean {
  const service = process.env.K_SERVICE;
  return service !== undefined && service !== '';
}
export async function fetchIdToken(audience: string, deps: OidcDeps = { fetch: globalThis.fetch }): Promise<string>
```
- **`isCloudRun()`** checks `K_SERVICE` (Cloud Run always sets it; it's unset locally). This is the clean switch between the IAM-token path (Cloud Run) and the no-auth local path.
- **`fetchIdToken(audience, deps)`** is injectable (`fetch` + `metadataHost`) so tests need no cloud credentials. On Cloud Run it hits `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=...` with `Metadata-Flavor: Google`.

## Runtime config (`nuxt.config.ts`)
```ts
runtimeConfig: {
  ragApiBase: process.env.RAG_API_BASE ?? '',          // private rag-api URL (server-only)
  rateWindowMs: Number(process.env.RATE_WINDOW_MS ?? 60_000),
  rateMaxPerIp: Number(process.env.RATE_MAX_PER_IP ?? 20),
  rateMaxPerSession: Number(process.env.RATE_MAX_PER_SESSION ?? 10),
}
```
- `ragApiBase` is **server-side only** — never exposed to the client.
- On Cloud Run, Terraform sets `RAG_API_BASE` + the `RATE_*` knobs (see `infra/cloud_run.tf`).

## Local dev — the `RAG_API_BASE not configured` / 500 trap
**Symptom:** `POST /api/sessions/:id/messages` → `500 (RAG_API_BASE not configured)` on `http://localhost:3000/`.

**Root cause:** locally `RAG_API_BASE` is empty (it's only set by Terraform on Cloud Run), so the BFF throws. Even if set, the old code always minted an OIDC token from the Cloud Run metadata server — which doesn't exist locally.

**Fix (already applied):**
1. `server/utils/oidc.ts` — `isCloudRun()` gates the OIDC token; locally no auth header is sent.
2. `frontend/.env.example` → copy to `frontend/.env` with `RAG_API_BASE=http://localhost:8080`.

**To run the full local stack:**
```bash
# Terminal 1 — start rag-api (it DOES need OPENROUTER_API_KEY to boot; paste the key
# directly in YOUR terminal, never through the agent). Listens on :8080.
cd rag-api
OPENROUTER_API_KEY=sk-... npm start

# Terminal 2 — the Nuxt dev server (hot-reloads on :3000).
cd frontend
npm run dev
```

**Key gotchas:**
- **The frontend does NOT need `OPENROUTER_API_KEY`** — only `rag-api` (the component that actually calls OpenRouter) does. The key is in Secret Manager for the *deployed* service; locally you pass it as an env var to `rag-api`.
- **You CANNOT point local dev at the deployed `rag-api`** — it's private (IAM). A local Nitro BFF can't mint an OIDC token (no metadata server), so it would get a **403**. Run `rag-api` locally instead.
- **`nuxt build` fails with "Another Nuxt dev is already running (PID ...)"** if a dev server is up. Bypass with `NUXT_IGNORE_LOCK=1 npm run build` (don't kill the user's dev server).
- `.env` is git-ignored (root `.gitignore`); only `.env.example` is committed.

## Deployment (Terraform + Cloud Run)
- **`infra/cloud_run.tf`** defines the `rag-frontend` Cloud Run Service running the Nuxt image. It sets `RAG_API_BASE` (constructed portably as `https://<service>-<project-number>.<region>.run.app`) + the `RATE_*` knobs, and uses the `api` service account.
- **`rag-api` is PRIVATE** (`api_private` IAM binding): only the frontend's SA can invoke it. The frontend is public (`allUsers`).
- **`frontend/Dockerfile`** is multi-stage: `npm ci` → `npm run build` (Nuxt) → runtime runs `node .output/server/index.mjs` on `$PORT` (8080).
- **`deploy.sh`** gates the frontend with `run_checks frontend 1` (typecheck → lint → knip → test → build) and builds/pushes `rag-frontend:<git-sha>`. **Commit before push/apply** or the tag doesn't bump and `apply` is a no-op.
- The Nitro BFF is still a Cloud Run service that can scale to zero, so a first-request cold start can still happen — but there's no nginx proxy hop, so it's the only latency source.

## Frontend conventions (strict TS + Tailwind)
- **100% TypeScript** — `.ts` modules, `.vue` SFCs use `<script setup lang="ts">`, no `any` (ESLint `no-explicit-any: 'error'`).
- **Type-check** = `npm run typecheck` → `vue-tsc --noEmit` (`strict: true`, `noImplicitAny: true`, `verbatimModuleSyntax` — all type-only imports use `import type`).
- **Types live in `frontend/types/`** per type-set (`chat.ts`, `sse.ts`, `trace.ts`, `config.ts`, `markdown.ts`) with **no `index.ts` barrel** — import each directly.
- **Styling is 100% Tailwind utilities** in the components; `assets/css/main.css` is only `@import 'tailwindcss'` + `@theme`/`:root` tokens + `body` reset. A small scoped `<style>` styles the `v-html` markdown output (`.answer`/`.citation`) — Tailwind can't reach runtime-generated markdown HTML.
- **`app.vue` is a thin composition root** (`<NuxtPage />`); the chat page lives in `pages/index.vue`, decomposed into `components/` (see `.github/skills/vue-component-decomposition/SKILL.md`).
- **SSE `frame.data` is `unknown`** and narrowed at each consumer — never `any`.

## The client-side chat flow (unchanged from the Vue SPA)
- `pages/index.vue` builds a `createChatStore({ send: (p) => openSseStream(p, { baseUrl: resolveApiBase() }) }, { trace: resolveTraceEnabled() })`.
- `resolveApiBase()` returns `''` (same-origin) — the browser POSTs to `/api/sessions/:id/messages` on the Nuxt origin, which Nitro proxies.
- `lib/sseTransport.ts` opens the stream with `fetch` + `ReadableStream` reader (POST body, so native `EventSource` GET-only can't be used), sends `Last-Event-ID` for resume.
- `lib/chatStore.ts` runs the client-side stage machine (Understanding/Searching/Selecting/Generating), reconnection with backoff, and validated citation rendering.
- `composables/useLimits.ts` calls `lib/limits.ts` `fetchLimits()` on demand (after each message + when the trace panel opens) for the POC sidebar. `fetchLimits` is the browser-side HTTP call to the Nitro `GET /api/limits/:sessionId` route (see the "client-side bridge" note above).

## Tests
- `frontend/test/**/*.test.ts` run in a **node** environment (vitest) with **zero cloud credentials** — the OIDC helpers take an injectable `fetch`/`metadataHost`, the rate limiter takes an injectable clock.
- `test/oidc.test.ts` covers `isCloudRun()` (unset/empty/set) and `fetchIdToken` (audience URL + header, injected host, error path).
- Gate: `npm run typecheck && npm run lint && npm run knip && npm test && npm run build`.

## Gotchas (highest-frequency)
1. **`RAG_API_BASE not configured` locally** → create `frontend/.env` with `RAG_API_BASE=http://localhost:8080` and run `rag-api` locally. Not a Terraform/deploy issue.
2. **Frontend never needs `OPENROUTER_API_KEY`** — only `rag-api` does.
3. **Can't reach the deployed (private) `rag-api` from local dev** — 403 without a Cloud Run OIDC token. Run `rag-api` locally.
4. **`nuxt build` lock** — bypass with `NUXT_IGNORE_LOCK=1` if a dev server is running.
5. **`isCloudRun()` via `K_SERVICE`** is the correct local-vs-Cloud-Run switch — don't try to detect "local" by checking for a metadata server.
6. **Commit before `deploy.sh push/apply`** — the image tag is the git SHA of HEAD.
