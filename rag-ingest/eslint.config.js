// Domain 9 / Step 9.2 — ESLint flat config for the seed job package.
import js from '@eslint/js';

export default [
  { ignores: ['**/node_modules/**', 'coverage/**'] },
  js.configs.recommended,

  // Shipped code.
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
        AbortController: 'readonly',
        crypto: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'off', // covered by TS types in tsc
      'no-useless-assignment': 'off',
    },
  },

  // Tests.
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
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
    },
  },
];