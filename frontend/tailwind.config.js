/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        hawana: {
          navy: '#001f5b',
          blue: '#0047ab',
          sky: '#0ea5e9',
          gold: '#ffd700'
        }
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 18px 46px rgba(15, 23, 42, 0.1)',
        'card-lg': '0 30px 80px rgba(15, 23, 42, 0.18)'
      }
    }
  },
  plugins: []
};
