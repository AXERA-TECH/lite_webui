/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.js',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg:     'var(--c-bg)',
        surface:'var(--c-sf)',
        card:   'var(--c-card)',
        border: 'var(--c-bd)',
        muted:  'var(--c-tx3)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
