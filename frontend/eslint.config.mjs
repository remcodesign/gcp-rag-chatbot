// Nuxt ESLint flat config. `@nuxt/eslint` provides the Nuxt-aware rules for
// .vue SFCs, .ts source, and Nitro server files. `no-explicit-any` is an error
// so no `any` can creep into the strict-TS frontend.
import withNuxt from './.nuxt/eslint.config.mjs';

export default withNuxt(
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);