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
        'error': '#ba1a1a'
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms')
  ]
}
