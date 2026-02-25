/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0A0A0B',
        surface: '#111114',
        surface2: '#1A1A1F',
        border: '#242429',
        border2: '#2E2E35',
        text: '#E8E8EF',
        'text-sub': '#7A7A8C',
        'text-dim': '#44444F',
        bullish: '#00FFA3',
        bearish: '#FF4B4B',
        accent: '#6366F1',
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        mono: ['Space Mono', 'monospace'],
      },
    },
  },
  plugins: [
    function({ addBase }) {
      addBase({
        '*': { 'box-sizing': 'border-box' },
        'body': {
          'background-color': '#0A0A0B',
          'color': '#E8E8EF',
          'font-family': 'DM Sans, sans-serif'
        }
      })
    }
  ],
}