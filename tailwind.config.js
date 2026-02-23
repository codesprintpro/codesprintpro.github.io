/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './content/**/*.{md,mdx}',
  ],
  theme: {
    extend: {
      container: {
        center: true,
        padding: '1rem',
      },
      colors: {
        blue: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        gray: {
          50: '#f9fafb',
          200: '#e5e7eb',
          600: '#4b5563',
          900: '#111827',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
} 