import { defineConfig } from 'vitest/config';

/**
 * NodeNext ESM convention requires `.ts` source files to import each other with
 * `.js` specifiers (what tsc emits). Vite/vitest does not map `./x.js` -> `./x.ts`
 * by default, so this plugin rewrites a `.js` specifier to its `.ts` source
 * during test resolution. (The compiled `dist/` output already uses `.js`, which
 * resolves normally at runtime.)
 */
function resolveJsImportsToTs() {
  return {
    name: 'resolve-js-to-ts',
    enforce: 'pre',
    resolveId(source) {
      if (/\.js$/.test(source) && !source.startsWith('node:')) {
        return this.resolve(`${source.slice(0, -3)}.ts`);
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveJsImportsToTs()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    server: {
      deps: {
        inline: [],
      },
    },
  },
});