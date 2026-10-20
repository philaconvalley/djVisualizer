import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['vendor/', 'test/output/', 'node_modules/']
  },

  js.configs.recommended,

  {
    rules: {
      // `_` marks a value that is unused on purpose, such as a caught error
      // the handler does not need.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  },

  // The app and the sandbox are ES modules with explicit imports and exports,
  // so a name used without an import is an error. p5 is the one global: it is the
  // vendored classic script every page loads before the modules. PHI-163.
  {
    files: ['app/**/*.js', 'sandbox/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, p5: 'readonly' }
    }
  },

  // Test drivers run in Node, but code inside page.evaluate() callbacks runs
  // in the page, where the app's globals exist. Only the globals those
  // callbacks actually read are declared, so a typo on the Node side still fails.
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        djApp: 'readonly',
        hw: 'readonly',
        soak: 'readonly'
      }
    }
  },

  // Pasted into the console of the running app. Browser only.
  {
    files: ['test/hardware-probe.js', 'test/soak-probe.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, djApp: 'readonly' }
    }
  }
];
