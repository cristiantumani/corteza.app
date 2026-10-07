/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/views/**/*.html',
    './public/scripts/**/*.js'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      // Brand palette, shared with corteza.app (the website): Ink, Paper, Cloud, Hairline, one Signal
      // orange accent, green only for finished things. Text tones (*-ink, on-surface-variant) are
      // darker versions that keep 4.5:1 contrast on white; the bright ones are for borders, dots and big type.
      colors: {
        'primary': '#000000',
        'secondary': '#2e2e2e',
        'tertiary': '#1f7a55',
        'background': '#ffffff',
        'surface': '#ffffff',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f9fafb',
        'surface-container': '#f3f4f6',
        'on-surface': '#171717',
        'on-surface-variant': '#6b6b6b',
        'on-primary': '#ffffff',
        'primary-container': '#2e2e2e',
        'secondary-container': '#e5e7eb',
        'tertiary-container': '#2eb67d',
        'outline-variant': '#e5e7eb',
        'outline': '#8a8a8a',
        'error': '#c62828',
        'error-container': '#fee4e2',
        'inverse-on-surface': '#f6f4ef',
        'inverse-primary': '#f59e83',
        'inverse-surface': '#0d0d0d',
        'on-background': '#171717',
        'on-error': '#ffffff',
        'on-error-container': '#b42318',
        'on-primary-container': '#ffffff',
        'on-primary-fixed': '#0d0d0d',
        'on-primary-fixed-variant': '#2e2e2e',
        'on-secondary': '#ffffff',
        'on-secondary-container': '#171717',
        'on-secondary-fixed': '#0d0d0d',
        'on-secondary-fixed-variant': '#2e2e2e',
        'on-tertiary': '#ffffff',
        'on-tertiary-container': '#ffffff',
        'on-tertiary-fixed': '#0f3d2b',
        'on-tertiary-fixed-variant': '#1f7a55',
        'primary-fixed': '#f3f4f6',
        'primary-fixed-dim': '#e5e7eb',
        'secondary-fixed': '#f3f4f6',
        'secondary-fixed-dim': '#e5e7eb',
        'surface-bright': '#ffffff',
        'surface-container-high': '#eceef1',
        'surface-container-highest': '#e5e7eb',
        'surface-dim': '#e5e7eb',
        'surface-tint': '#000000',
        'surface-variant': '#f3f4f6',
        'tertiary-fixed': '#e6f6ee',
        'tertiary-fixed-dim': '#2eb67d',
        // Brand names
        'paper': '#f6f4ef',
        'ink': '#0d0d0d',
        'graphite': '#2e2e2e',
        'signal': '#e85d3a',
        'signal-ink': '#c2410c',
        'signal-wash': '#fdece8',
        'success': '#2eb67d',
        'success-ink': '#1f7a55',
        'success-wash': '#e6f6ee'
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms')
  ]
}
