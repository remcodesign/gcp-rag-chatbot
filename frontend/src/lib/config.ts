/**
 * Runtime config for the frontend.
 *
 * The Vue app is served from `rag-frontend-*.run.app`, but the SSE backend
 * lives on a different origin (`rag-api-*.run.app`). The frontend must know
 * that backend origin to open the stream.
 *
 * Resolution order:
 *   1. `window.__RAG_API_BASE__`  — injected by Cloud Run at deploy time via a
 *      `<script>` snippet. Best for per-environment wiring.
 *   2. `import.meta.env.VITE_API_BASE`  — Vite build-time env var (dev/devpreview).
 *   3. `''`  — same-origin (local dev via the vite dev proxy).
 */

import type { RagWindow } from '../types/config';
import type { ViteEnv } from '../types/config';

/** Build-time env accessor typing — Vite statically inlines
 * `import.meta.env.VITE_API_BASE` at build time, so this MUST be accessed as a
 * direct `import.meta.env.*` member (no intermediate variable) or the value is
 * never baked into the bundle. This cast only re-types it for dev/test. */
const env = import.meta.env as unknown as ViteEnv;

export function resolveApiBase(): string {
  if (typeof window !== 'undefined') {
    const w = window as RagWindow;
    if (w.__RAG_API_BASE__) return w.__RAG_API_BASE__;
  }
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
    const w = window as RagWindow;
    if (w.__RAG_TRACE__ !== undefined) return Boolean(w.__RAG_TRACE__);
  }
  if (env.VITE_RAG_TRACE !== undefined) {
    return env.VITE_RAG_TRACE === 'true';
  }
  return true;
}