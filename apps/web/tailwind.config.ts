import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// 设计 Token 的唯一来源，取值与用途见 docs/design/design-spec.md。
// globals.css 中通过 theme('colors.xxx') 引用，不要在 CSS 或组件里重复写色值。
// satisfies 让 fontSize 的 [字号, 配置] 推断为元组，同时保留各键的具体类型供下方展开
const designTokens = {

  colors: {
    // 中性色 (2.1)：层级靠明度区分
    ink: {
      950: '#050506',
      900: '#0B0B0D',
      850: '#121215',
      800: '#1A1A1E',
      700: '#26262B',
      600: '#3A3A40',
    },
    line: {
      DEFAULT: 'rgb(255 255 255 / 0.12)',
      strong: 'rgb(255 255 255 / 0.28)',
    },
    overlay: 'rgb(0 0 0 / 0.72)',
    // 文字 (2.2)
    fg: {
      DEFAULT: '#FFFFFF',
      secondary: '#C7C5C5',
      muted: 'rgb(255 255 255 / 0.60)',
      disabled: 'rgb(255 255 255 / 0.36)',
    },
    // 品牌与语义色 (2.3)
    crimson: {
      400: '#FF4D4D',
      500: '#ED1212',
      hover: '#FF2B2B',
      700: '#8F0B0B',
    },
    steel: {
      700: '#2E3644',
      500: '#5B6B86',
      300: '#A9BBD8',
    },
    teal: {
      400: '#34C3C8',
    },
    gold: {
      300: '#FFCC83',
    },
    success: '#4ADE80',
    // 游戏领域色 (2.4)
    orb: {
      red: '#E5484D',
      blue: '#3E8ED0',
      yellow: '#F2C94C',
    },
  },
  // 字号阶梯 (3)：禁止再新增 text-[Npx]
  fontSize: {
    hud: ['10px', { lineHeight: '12px', letterSpacing: '0.16em' }],
    caption: ['12px', { lineHeight: '16px' }],
    'body-sm': ['13px', { lineHeight: '20px' }],
    body: ['14px', { lineHeight: '22px' }],
    'title-sm': ['16px', { lineHeight: '24px' }],
    title: ['20px', { lineHeight: '28px' }],
    display: ['32px', { lineHeight: '40px' }],
    banner: ['56px', { lineHeight: '1' }],
  },
  fontFamily: {
    // 正文：西文用系统字体，中文优先思源黑体系，未安装时回退系统黑体 (与 globals.css 的 body 一致)
    sans: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      '"Noto Sans SC"',
      '"Source Han Sans SC"',
      '"PingFang SC"',
      '"Hiragino Sans GB"',
      '"Microsoft YaHei"',
      'sans-serif',
    ],
    // 英文展示 / HUD 文字 (layout.tsx 引入 @fontsource-variable/montserrat)
    display: ['"Montserrat Variable"', 'Avenir', '"Helvetica Neue"', 'Arial', 'sans-serif'],
    // 数字与 ID (layout.tsx 引入 @fontsource-variable/jetbrains-mono)，配合 tabular-nums 使用
    num: ['"JetBrains Mono Variable"', 'ui-monospace', 'Consolas', 'monospace'],
  },
  borderRadius: {
    card: '2px',
  },
  boxShadow: {
    overlay: '0 16px 48px rgb(0 0 0 / 0.6)',
    // 仅用于攻击目标、可落点等瞬时状态，不常驻
    'glow-crimson': '0 0 16px rgb(237 18 18 / 0.45)',
    'glow-teal': '0 0 16px rgb(52 195 200 / 0.4)',
  },
  zIndex: {
    sticky: '10',
    dropdown: '20',
    overlay: '40',
    modal: '50',
    toast: '60',
    banner: '70',
  },
  transitionDuration: {
    fast: '150ms',
    base: '300ms',
    slow: '500ms',
  },
  transitionTimingFunction: {
    enter: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
} satisfies NonNullable<Config['theme']>;

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      ...designTokens,
      colors: {
        ...designTokens.colors,
        // 旧 Token：迁移完成后删除 (见 design-spec.md 第 10 节)
        background: '#090c10',
        surface: '#111620',
        surfaceHover: '#182030',
        terminalCyan: '#00f0ff',
        terminalGold: '#ffb703',
        erosionRed: '#ff2a5f',
        terminalBorder: '#1e293b',
      },
      fontFamily: {
        ...designTokens.fontFamily,
        // 旧 Token：迁移时数字改用 font-num，正文去掉 font-mono
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      // 组件中使用到的非默认尺寸 (Tailwind v3 默认不含 w-26 / h-22 / rounded-xs / shadow-xs)
      spacing: {
        22: '5.5rem',
        26: '6.5rem',
      },
      borderRadius: {
        ...designTokens.borderRadius,
        xs: '0.125rem',
      },
      boxShadow: {
        ...designTokens.boxShadow,
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.25)',
      },
    },
  },
  // animate-in / fade-in / zoom-in-95 / slide-in-from-* 等入场动画类依赖该插件
  plugins: [animate],
};

export default config;
