// Domain 9 / Step 9.2 — ESLint flat config for the node packages.
// ESLint v9+ flat config: `@eslint/js` provides the recommended JS rules.
// The npm scripts `lint`/`lint:fix` invoke this file via the installed eslint.
import js from '@eslint/js';

export default [
  { ignores: ['node_modules/**', 'coverage/**'] },
  js.configs.recommended,

  // Shipped code: node globals + a small rule set.
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        TextDecoder: 'readonly',
        ReadableStream: 'readonly',
        AbortController: 'readonly',
        crypto: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // `no-undef` off: node/browser globals are covered by TS types in tsc and
      // this keeps the config minimal (no overengineering) for plain-JS code.
      'no-undef': 'off',
      // False-positive on the generator's "declare default, then overwrite in a
      // try/catch" pattern (the reassigned value IS used later). Ref: 2026-08
      // generator.js `runOutcome`/`citations`.
      'no-useless-assignment': 'off',
    },
  },

  // Tests: vitest globals (describe/it/expect) + helper imports are intentional.
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
        jest: 'readonly',
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
    },
  },
];