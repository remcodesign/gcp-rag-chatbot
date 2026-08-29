import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// Vitest config for the Nuxt frontend. The pure-logic unit tests (chatStore,
// sseParser, citations, markdown, trace, etc.) run in a node environment.
// The `~/` alias resolves to the frontend root (Nuxt convention).
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '~': new URL('.', import.meta.url).pathname,
      '@': new URL('.', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});