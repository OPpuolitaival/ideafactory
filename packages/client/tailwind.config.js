/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './packages/client/index.html',
    './packages/client/src/**/*.{ts,tsx}',
    // Fallback for when running from package directory
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          0: '#0a0a0f',
          1: '#12121a',
          2: '#1a1a26',
          3: '#222233',
        },
        accent: {
          DEFAULT: '#6e56cf',
          light: '#8b78e6',
        },
        success: '#30a46c',
        danger: '#e5484d',
        warning: '#f5a623',
        info: '#3e63dd',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
};
