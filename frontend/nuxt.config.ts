// Nuxt 3 config for the RAG chat frontend.
//
// SSR + Nitro server layer. The Nitro server acts as a Backend-for-Frontend
// (BFF): it rate-limits and proxies the SSE stream to the private rag-api
// server-to-server (no nginx proxy, no separate BFF service). The browser only
// talks to Nuxt same-origin.
//
// Runtime config:
//   RAG_API_BASE  — the private rag-api URL the Nitro server proxies to.
//   RATE_*        — rate-limit knobs (per client IP + per session).
import tailwindcss from '@tailwindcss/vite';

export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  devtools: { enabled: true },

  // SSR is the whole point: the page renders server-side, and the Nitro server
  // layer is the BFF.
  ssr: true,

  modules: ['@nuxt/eslint'],

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    // Private rag-api URL (server-side only — never exposed to the client).
    // Read from the NUXT_-prefixed env var so Cloud Run can override it at
    // RUNTIME (NUXT_RAG_API_BASE). A bare `process.env.RAG_API_BASE` default
    // would only be read at BUILD time and could not be overridden at runtime
    // (Nuxt only maps NUXT_* env vars to runtimeConfig keys). The Cloud Run
    // env var is set in infra/cloud_run.tf as NUXT_RAG_API_BASE.
    ragApiBase: process.env.NUXT_RAG_API_BASE ?? '',
    // Rate-limit knobs.
    rateWindowMs: Number(process.env.NUXT_RATE_WINDOW_MS ?? 60_000),
    rateMaxPerIp: Number(process.env.NUXT_RATE_MAX_PER_IP ?? 10),
    rateMaxPerSession: Number(process.env.NUXT_RATE_MAX_PER_SESSION ?? 4),
  },

  typescript: {
    strict: true,
    typeCheck: true,
  },

  vite: {
    // Tailwind v4 via the Vite plugin (NOT a Nuxt module — it's a Vite plugin).
    plugins: [tailwindcss()],
  },
});