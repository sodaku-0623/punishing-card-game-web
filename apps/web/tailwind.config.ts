import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#090c10',
        surface: '#111620',
        surfaceHover: '#182030',
        terminalCyan: '#00f0ff',
        terminalGold: '#ffb703',
        erosionRed: '#ff2a5f',
        terminalBorder: '#1e293b',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      // 组件中使用到的非默认尺寸 (Tailwind v3 默认不含 w-26 / h-22 / rounded-xs / shadow-xs)
      spacing: {
        22: '5.5rem',
        26: '6.5rem',
      },
      borderRadius: {
        xs: '0.125rem',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.25)',
      },
    },
  },
  // animate-in / fade-in / zoom-in-95 / slide-in-from-* 等入场动画类依赖该插件
  plugins: [animate],
};

export default config;
