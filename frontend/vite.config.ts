import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// Vite config for the static Vue 3 chat frontend. `build.outDir` is the static
// dir a Cloud Run Service (or CDN) serves. Vitest shares this config so the
// `test` block below keeps the environment node for the pure-logic unit tests.
//
// Dev proxy: in `npm run dev`, the app lives on http://localhost:5174 but the
// SSE backend is elsewhere (Cloud Run, or a local rag-api). The frontend must
// POST to that backend cross-origin. Instead of wiring CORS into every local
// run, the Vite dev server proxies `/sessions/*` to the backend. The target is
// `VITE_API_PROXY_TARGET` (default: the deployed Cloud Run API). Point it at a
// local backend (e.g. http://localhost:8080) when developing against one.
const API_PROXY_TARGET: string = process.env.VITE_API_PROXY_TARGET
  ?? 'https://rag-api-4xxip75eoa-ez.a.run.app';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    proxy: {
      '/sessions': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});