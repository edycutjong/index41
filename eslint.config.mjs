import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat ESLint config for a repo that is three projects in one trench coat.
 *
 *   app/      Next.js 16 App Router  — gets the full next/core-web-vitals rule set
 *   src/      the TypeScript proving pipeline — Node, not React; the Next rules do not apply
 *   scripts/  one-shot Node scripts, ESM
 *   contracts/ Solidity — linted by `forge fmt --check`, not by ESLint
 *
 * Deliberately NOT here: Prettier. Every source file in this repo is hand-formatted with aligned
 * comment blocks that carry meaning, and running Prettier over them would rewrite 18 files for
 * cosmetics on a frozen submission. Solidity formatting IS gated (`forge fmt --check`, clean).
 */

const config = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'cache/**',
      'lib/**',
      'node_modules/**',
      'scratch/**',
      'playwright-report/**',
      'test-results/**',
      '.lighthouseci/**',
      'next-env.d.ts',
    ],
  },

  ...coreWebVitals,
  ...nextTypescript,

  {
    rules: {
      // A caught error that is re-thrown with a message is the pattern this codebase uses to
      // refuse to guess. Allow `catch (err)` where err is only stringified.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // The proving pipeline and the capture scripts run under Node, never in a browser.
    files: ['src/**/*.ts', 'scripts/**/*.{ts,mjs}'],
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
];

export default config;
