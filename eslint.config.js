import js from '@eslint/js';
import globals from 'globals';

// Flat config. The sim/UI is dense legacy vanilla JS, so we lean on eslint:recommended
// (real-bug rules, not style) and downgrade the noisier ones to warnings. Scripts run in
// Node; the browser entry runs in the browser.
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      'no-unused-vars': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Legacy vanilla-JS patterns that are harmless here: keep them visible as warnings
      // (not blocking) rather than risk editing dense, working code to satisfy style.
      'no-redeclare': 'warn',
      'no-prototype-builtins': 'warn',
    },
  },
  {
    files: ['src/**/*.test.js', 'scripts/**/*.mjs', 'eslint.config.js', 'vite.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': 'warn' },
  },
];
