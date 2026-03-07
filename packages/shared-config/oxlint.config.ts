import type { OxlintConfig } from 'oxlint';

const config: OxlintConfig = {
  // Global settings
  env: {
    browser: true,
    es2024: true,
    node: true,
  },
  globals: {
    // Add any global variables here
  },
  // Linter settings - extend recommended config and customize
  rules: {
    // Possible Problems
    'no-debugger': 'warn',
    'no-constant-condition': 'warn',
    'no-empty': 'warn',
    'no-extra-boolean-cast': 'warn',
    'no-loss-of-precision': 'warn',
    'no-obj-calls': 'error',
    'no-regex-spaces': 'warn',
    'no-sparse-arrays': 'warn',
    'no-unexpected-multiline': 'error',
    'use-isnan': 'error',

    // Suggestions
    'curly': ['warn', 'all'],
    'eqeqeq': ['warn', 'always'],
    'no-var': 'error',
    'prefer-const': ['warn', { destructuring: 'any' }],
    'prefer-arrow-callback': 'warn',

    // Layout & Formatting
    'comma-dangle': ['warn', 'always-multiline'],
    'indent': ['warn', 2, { SwitchCase: 1 }],
    'quotes': ['warn', 'single', { avoidEscape: true }],
    'semi': ['warn', 'always'],
    'no-trailing-spaces': 'warn',
  },
  // Settings for specific file types
  ignorePatterns: [
    'node_modules/**',
    'dist/**',
    '.turbo/**',
    'build/**',
    'coverage/**',
    '*.d.ts',
  ],
};

export default config;
