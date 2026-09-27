// ESLint flat config. Run with `npm run lint`.
// Server code is CommonJS on Node; dashboard scripts and the extension run in the browser.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'public/styles/**', 'coverage/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      // Legacy code has many unused variables; report them without failing CI
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['public/scripts/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser }
    },
    rules: {
      // Dashboard scripts share globals across <script> tags (e.g. WORKSPACE_ID, showNotification)
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-case-declarations': 'warn'
    }
  },
  {
    files: ['browser-extension/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.webextensions }
    }
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: { ...globals.node }
    }
  }
];
