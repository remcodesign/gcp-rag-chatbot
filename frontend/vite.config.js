import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Vite config for the static Vue 3 chat frontend. `build.outDir` is the static
// dir a Cloud Run Service (or CDN) serves. Vitest shares this config so the
// `test` block below keeps the environment node for the pure-logic unit tests.
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});