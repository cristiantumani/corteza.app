/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/views/**/*.html',
    './public/scripts/**/*.js'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'primary': '#3953bd',
        'secondary': '#754aa1',
        'tertiary': '#006947',
        'background': '#fcf8fb',
        'surface': '#fcf8fb',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f6f3f5',
        'surface-container': '#f0edef',
        'on-surface': '#1b1b1d',
        'on-surface-variant': '#444653',
        'on-primary': '#ffffff',
        'primary-container': '#546cd7',
        'secondary-container': '#ce9ffd',
        'tertiary-container': '#00855b',
        'outline-variant': '#c5c5d5',
        'outline': '#757684',
        'error': '#ba1a1a',
        'error-container': '#ffdad6',
        'inverse-on-surface': '#f3f0f2',
        'inverse-primary': '#b9c3ff',
        'inverse-surface': '#303032',
        'on-background': '#1b1b1d',
        'on-error': '#ffffff',
        'on-error-container': '#93000a',
        'on-primary-container': '#fffbff',
        'on-primary-fixed': '#001356',
        'on-primary-fixed-variant': '#1f3ba6',
        'on-secondary': '#ffffff',
        'on-secondary-container': '#5a3086',
        'on-secondary-fixed': '#2c0051',
        'on-secondary-fixed-variant': '#5c3187',
        'on-tertiary': '#ffffff',
        'on-tertiary-container': '#f5fff6',
        'on-tertiary-fixed': '#002113',
        'on-tertiary-fixed-variant': '#005236',
        'primary-fixed': '#dde1ff',
        'primary-fixed-dim': '#b9c3ff',
        'secondary-fixed': '#f0dbff',
        'secondary-fixed-dim': '#dcb8ff',
        'surface-bright': '#fcf8fb',
        'surface-container-high': '#eae7ea',
        'surface-container-highest': '#e4e2e4',
        'surface-dim': '#dcd9dc',
        'surface-tint': '#3c55bf',
        'surface-variant': '#e4e2e4',
        'tertiary-fixed': '#6ffbbe',
        'tertiary-fixed-dim': '#4edea3'
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms')
  ]
}
