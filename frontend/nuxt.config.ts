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
    ragApiBase: process.env.RAG_API_BASE ?? '',
    // Rate-limit knobs.
    rateWindowMs: Number(process.env.RATE_WINDOW_MS ?? 60_000),
    rateMaxPerIp: Number(process.env.RATE_MAX_PER_IP ?? 20),
    rateMaxPerSession: Number(process.env.RATE_MAX_PER_SESSION ?? 10),
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