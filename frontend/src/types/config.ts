/**
 * Config type-set — runtime config resolution (backend origin + trace flag).
 * The app is served from `rag-frontend-*.run.app` but streams from
 * `rag-api-*.run.app`, so the backend origin must be resolvable at runtime.
 */

/** Vite `import.meta.env` — only the keys this app reads. */
export interface ViteEnv {
    VITE_API_BASE?: string;
    VITE_RAG_TRACE?: string;
}
