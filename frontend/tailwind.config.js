// Tailwind `content`: use valid globstar patterns (see Tailwind content-configuration docs).
// Wrong globs (missing segments or typos) purge utilities and break production styling.
// Includes `./frontend/...` entries so builds still scan templates if CWD is the monorepo root.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx,css}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './frontend/app/**/*.{js,ts,jsx,tsx,mdx,css}',
    './frontend/components/**/*.{js,ts,jsx,tsx,mdx}',
    './frontend/lib/**/*.{js,ts,jsx,tsx,mdx}',
    './frontend/src/**/*.{js,ts,jsx,tsx,mdx}',
    './frontend/pages/**/*.{js,ts,jsx,tsx,mdx}'
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
