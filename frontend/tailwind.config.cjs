/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', ':root[data-theme="dark"]'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        app: {
          bg: 'var(--bg)',
          surface: 'var(--surface)',
          'surface-soft': 'var(--surface-soft)',
          'surface-raised': 'var(--surface-raised)',
          border: 'var(--border)',
          'border-strong': 'var(--border-strong)',
          text: 'var(--text)',
          muted: 'var(--muted)',
          primary: 'var(--primary)',
          'primary-strong': 'var(--primary-strong)',
          danger: 'var(--danger)',
          'danger-strong': 'var(--danger-strong)',
          warning: 'var(--warning)',
          success: 'var(--success)',
          ring: 'var(--ring)',
        },
      },
      borderRadius: {
        app: 'var(--radius-md)',
        'app-lg': 'var(--radius-lg)',
      },
      boxShadow: {
        app: 'var(--shadow)',
        'app-soft': 'var(--shadow-soft)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
