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

  // The app: three classic scripts that index.html loads in order. They share
  // one global scope, so each file declares only the names it reads from the
  // others, and marks the names it provides as used elsewhere.
  //
  // TRANSITIONAL: this whole block exists because the app is not ES modules.
  // When PHI-163 converts it to explicit imports and exports, delete the
  // per-file globals and varsIgnorePattern entries below.
  {
    files: ['app/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser }
    }
  },
  {
    files: ['app/audioProcessor.js'],
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^(AudioProcessor|BANDS|DEBUG)$'
        }
      ]
    }
  },
  {
    files: ['app/visualizer.js'],
    languageOptions: {
      globals: { p5: 'readonly', BANDS: 'readonly' }
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^DJVisualizer$'
        }
      ]
    }
  },
  {
    files: ['app/app.js'],
    languageOptions: {
      globals: { AudioProcessor: 'readonly', DJVisualizer: 'readonly', DEBUG: 'readonly' }
    }
  },

  // Test drivers run in Node, but code inside page.evaluate() callbacks runs
  // in the page, where the app's globals exist. Only the two globals those
  // callbacks read are declared, so a typo on the Node side still fails.
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        djApp: 'readonly',
        hw: 'readonly',
        AudioProcessor: 'readonly'
      }
    }
  },

  // Pasted into the console of the running app. Browser only.
  {
    files: ['test/hardware-probe.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, djApp: 'readonly' }
    }
  }
];
