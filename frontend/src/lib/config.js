/**
 * Runtime config for the frontend.
 *
 * The Vue app is served from `rag-frontend-*.run.app`, but the SSE backend
 * lives on a different origin (`rag-api-*.run.app`). The frontend must know
 * that backend origin to open the stream.
 *
 * Resolution order:
 *   1. `window.__RAG_API_BASE__`  — injected by Cloud Run at deploy time via a
 *      `<script>` snippet (see docs). Best for per-environment wiring.
 *   2. `import.meta.env.VITE_API_BASE`  — Vite build-time env var (dev/devpreview).
 *   3. `''`  — same-origin (local dev via the vite dev proxy).
 */

export function resolveApiBase() {
  if (typeof window !== 'undefined' && window.__RAG_API_BASE__) {
    return window.__RAG_API_BASE__;
  }
  if (import.meta.env && import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  return '';
}

/**
 * Whether the RAG "inner workings" trace should be requested from the backend.
 * This is a POC, so the trace is on by default; turn it off in builds that
 * don't want the extra SSE payload.
 */
export function resolveTraceEnabled() {
  if (typeof window !== 'undefined' && window.__RAG_TRACE__ !== undefined) {
    return !!window.__RAG_TRACE__;
  }
  if (import.meta.env && import.meta.env.VITE_RAG_TRACE !== undefined) {
    return import.meta.env.VITE_RAG_TRACE === 'true';
  }
  return true;
}