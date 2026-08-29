/**
 * Runtime config for the frontend.
 *
 * The Vue app is served from `rag-frontend-*.run.app`. The SSE backend is now
 * reached SAME-ORIGIN: nginx proxies `/sessions/*` to the BFF (rag-bff), which
 * rate-limits and forwards to the private rag-api. So the default API base is
 * `''` (same-origin) — no cross-origin call, no CORS.
 *
 * Resolution order:
 *   1. `import.meta.env.VITE_API_BASE`  — Vite build-time env var (local dev
 *      against a deployed BFF, or a dev proxy).
 *   2. `''`  — same-origin (production via the nginx proxy, or local dev via
 *      the vite dev proxy).
 */

import type { ViteEnv } from '../types/config';

/** Build-time env accessor typing — Vite statically inlines
 * `import.meta.env.VITE_API_BASE` at build time, so this MUST be accessed as a
 * direct `import.meta.env.*` member (no intermediate variable) or the value is
 * never baked into the bundle. This cast only re-types it for dev/test. */
const env = import.meta.env as unknown as ViteEnv;

export function resolveApiBase(): string {
    if (env.VITE_API_BASE) {
        return env.VITE_API_BASE;
    }
    return '';
}

/**
 * Whether the RAG "inner workings" trace should be requested from the backend.
 * This is a POC, so the trace is on by default; turn it off in builds that
 * don't want the extra SSE payload.
 */
export function resolveTraceEnabled(): boolean {
    if (typeof window !== 'undefined') {
        const w = window as Window & { __RAG_TRACE__?: string | boolean };
        if (w.__RAG_TRACE__ !== undefined) return Boolean(w.__RAG_TRACE__);
    }
    if (env.VITE_RAG_TRACE !== undefined) {
        return env.VITE_RAG_TRACE === 'true';
    }
    return true;
}
