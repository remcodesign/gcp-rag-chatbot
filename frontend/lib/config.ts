/**
 * Runtime config for the frontend.
 *
 * The Nuxt app is served from `rag-frontend-*.run.app`. The browser talks to
 * Nuxt SAME-ORIGIN; the Nitro server layer (the BFF) proxies `/sessions/*` and
 * `/limits/*` to the private rag-api server-to-server. So the API base is
 * always `''` (same-origin) — no cross-origin call, no CORS.
 */

export function resolveApiBase(): string {
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
    return true;
}
