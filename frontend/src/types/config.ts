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

/** A document window carrying the deploy-injected globals. */
export type RagWindow = Window & {
	__RAG_API_BASE__?: string;
	__RAG_TRACE__?: string | boolean;
};

/** Results of resolving the backend origin. */
export interface ApiBaseResolution {
	/** The backend origin, or `''` for same-origin (dev proxy). */
	baseUrl: string;
	source: 'window' | 'import-meta' | 'default';
}