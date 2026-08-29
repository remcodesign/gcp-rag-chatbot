import { defineConfig } from 'vitest/config';

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
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});