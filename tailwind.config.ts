import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

/**
 * The palette is not chosen here — it is imported. Every colour below resolves to a CSS variable
 * defined in `app/globals.css`, which is a copy of the project's portable design tokens. The
 * icon, the OG card and this page therefore share one source of truth: steel-slate `#587B9E` is
 * the UNORDERED state, data-gold `#FFC53D` is the INDEXED state, and nothing else is allowed to
 * be gold.
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg-base)',
        panel: 'var(--bg-panel)',
        primary: {
          DEFAULT: 'var(--primary)',
          ink: 'var(--primary-ink)',
        },
        accent: 'var(--accent)',
        hi: 'var(--text-hi)',
        mid: 'var(--text-mid)',
        low: 'var(--text-low)',
        line: 'var(--border-subtle)',
        edge: 'var(--border-default)',
        ok: 'var(--color-success)',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
      },
      boxShadow: {
        indexed: 'var(--shadow-indexed)',
        plate: 'var(--shadow-lg)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'none' },
        },
        land: {
          '0%': { transform: 'scale(0.72)', opacity: '0' },
          '55%': { transform: 'scale(1.14)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        sweep: {
          '0%': { transform: 'translateX(-110%)' },
          '100%': { transform: 'translateX(210%)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 220ms cubic-bezier(0.4,0,0.2,1)',
        'accordion-up': 'accordion-up 220ms cubic-bezier(0.4,0,0.2,1)',
        rise: 'rise 620ms cubic-bezier(0.16,1,0.3,1) both',
        land: 'land 420ms cubic-bezier(0.16,1,0.3,1) both',
        sweep: 'sweep 1.1s cubic-bezier(0.4,0,0.2,1)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
