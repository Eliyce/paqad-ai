import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'node_modules/**',
      '.claude/**',
      '.codex-tracker/**',
      // `.paqad/` is a machine-local runtime dir (decisions, ledger, context, and the
      // generated rule-scripts + their intentionally-broken pass/fail fixtures) — runtime
      // artifacts, not project source. Already prettier-ignored; ignore it here too so the
      // generated `.paqad/scripts/**` `.mjs` never fail lint (they carry node globals and
      // fixtures deliberately contain violations).
      '.paqad/**',
      'docs/slides/**',
      'graph-ui/**',
      'runtime/graph-ui/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', '*.config.ts', 'runtime/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // CommonJS modules legitimately use require()/module.exports.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['website/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
  },
);
