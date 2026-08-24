// Domain 9 / Step 9.2 — ESLint flat config for the Vue + TS frontend.
import js from '@eslint/js';
import vueParser from 'vue-eslint-parser';
import ts from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

const tsPluginConfig = { '@typescript-eslint': tsPlugin };

const browserGlobals = {
  console: 'readonly',
  window: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  crypto: 'readonly',
  EventSource: 'readonly',
  URL: 'readonly',
};

const tsRules = {
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  '@typescript-eslint/no-explicit-any': 'error', // Domain goal: no `any` anywhere
  'no-undef': 'off', // covered by TS types / Vite env
  'no-useless-assignment': 'off',
};

export default [
  { ignores: ['**/node_modules/**', 'dist/**', 'coverage/**'] },
  js.configs.recommended,

  // .vue SFCs — the Vue parser hands the <script> block to the TS parser.
  {
    files: ['**/*.vue'],
    plugins: tsPluginConfig,
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parser: ts,
        extraFileExtensions: ['.vue'],
      },
      globals: browserGlobals,
    },
    rules: tsRules,
  },

  // Shipped TS source (browser globals).
  {
    files: ['src/**/*.ts'],
    plugins: tsPluginConfig,
    languageOptions: {
      parser: ts,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: browserGlobals,
    },
    rules: tsRules,
  },

  // Root build/tooling config files (vite.config.js/.ts, etc.) run in Node.
  {
    files: ['*.config.js', '*.config.ts'],
    plugins: tsPluginConfig,
    languageOptions: {
      parser: ts,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
    rules: tsRules,
  },

  // Tests (vitest in node env).
  {
    files: ['test/**/*.ts'],
    plugins: tsPluginConfig,
    languageOptions: {
      parser: ts,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
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
        window: 'readonly',
        document: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
    },
  },
];