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

/** Build-time environment accessor so tests can stub `import.meta.env`. */
interface EnvHolder {
  env?: { VITE_API_BASE?: string; VITE_RAG_TRACE?: string };
}

export function resolveApiBase(): string {
  if (typeof window !== 'undefined') {
    const w = window as RagWindow;
    if (w.__RAG_API_BASE__) return w.__RAG_API_BASE__;
  }
  const meta = import.meta as unknown as EnvHolder;
  if (meta.env && meta.env.VITE_API_BASE) {
    return meta.env.VITE_API_BASE;
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
  const meta = import.meta as unknown as EnvHolder;
  if (meta.env && meta.env.VITE_RAG_TRACE !== undefined) {
    return meta.env.VITE_RAG_TRACE === 'true';
  }
  return true;
}