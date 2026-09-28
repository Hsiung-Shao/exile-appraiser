module.exports = {
  // exile-appraiser: 兩個遊戲 package 的 .vue 也在 renderer 裡編譯,class 要一起掃
  content: ['./src/**/*.{ts,vue}', '../poe1/src/**/*.vue', '../poe2/src/**/*.vue'],
  theme: {
    // exile-appraiser: 主題 token(src/theme/pobtools.css,來自 PobTools 新介面 app.css)。
    // 值全部是 CSS 變數:切主題 / 強調色 / 字級(src/web/useTheme.ts 寫在 <html>)時 class 不用變。
    extend: {
      colors: {
        surface: {
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          hover: 'var(--surface-hover)',
          active: 'var(--surface-active)'
        },
        edge: { 0: 'var(--edge-0)', 1: 'var(--edge-1)', 2: 'var(--edge-2)' },
        ink: { 0: 'var(--ink-0)', 1: 'var(--ink-1)', 2: 'var(--ink-2)', 3: 'var(--ink-3)', 4: 'var(--ink-4)' },
        gold: { DEFAULT: 'var(--gold)', soft: 'var(--gold-soft)', dim: 'var(--gold-dim)', on: 'var(--on-gold)' },
        accent: { DEFAULT: 'var(--accent)', soft: 'var(--accent-soft)' },
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
        // 稀有度:蓋過下方 EE2 的寫死值,淺色主題自動換成深一階
        unique: 'var(--c-unique)',
        rare: 'var(--c-rare)',
        magic: 'var(--c-magic)',
        normal: 'var(--c-normal)',
        gem: 'var(--c-gem)',
        currency: 'var(--c-currency)'
      },
      fontFamily: {
        ui: 'var(--font-ui)',
        mono: 'var(--font-mono)'
      },
      // 蓋過 Tailwind 預設的 xs/sm/lg/xl(rem)→ 字級 token(跟 --fs-base 走);行高維持預設的比例
      fontSize: {
        '2xs': ['var(--fs-2xs)', { lineHeight: '1.3' }],
        xs: ['var(--fs-xs)', { lineHeight: '1.333' }],
        sm: ['var(--fs-sm)', { lineHeight: '1.43' }],
        md: ['var(--fs-md)', { lineHeight: '1.45' }],
        lg: ['var(--fs-lg)', { lineHeight: '1.556' }],
        xl: ['var(--fs-xl)', { lineHeight: '1.4' }]
      },
      borderRadius: {
        s: 'var(--radius-s)',
        m: 'var(--radius-m)',
        l: '8px'
      },
      boxShadow: {
        float: 'var(--shadow-float)'
      }
    },
    colors: {
      transparent: 'transparent',
      current: 'currentColor',

      black: '#000',
      white: '#fff',

      // exile-appraiser: 以下幾色來自 Exiled Exchange 2 的 tailwind.config.js(poe2 的 .vue 用到)
      fire: '#c80000',
      cold: '#5aadff',
      lightning: '#ffff00',
      normal: '#c8c8c8',
      magic: '#8888ff',
      rare: '#ffff77',
      unique: '#af6025',

      // exile-appraiser: 灰階改成主題 token 的別名,poe1/poe2 移植的 .vue 逐字不改就跟著主題變。
      // (原值 100 #f7fafc … 900 #1a202c;red/orange/yellow/green/blue 等是遊戲語意色,保留原色階)
      gray: {
        100: 'var(--ink-0)',
        200: 'var(--ink-0)',
        300: 'var(--ink-1)',
        400: 'var(--ink-2)',
        500: 'var(--ink-3)',
        600: 'var(--edge-2)',
        700: 'var(--surface-2)',
        800: 'var(--surface-1)',
        900: 'var(--surface-0)',
      },
      red: {
        100: '#fff5f5',
        200: '#fed7d7',
        300: '#feb2b2',
        400: '#fc8181',
        500: '#f56565',
        600: '#e53e3e',
        700: '#c53030',
        800: '#9b2c2c',
        900: '#742a2a',
      },
      orange: {
        100: '#fffaf0',
        200: '#feebc8',
        300: '#fbd38d',
        400: '#f6ad55',
        500: '#ed8936',
        600: '#dd6b20',
        700: '#c05621',
        800: '#9c4221',
        900: '#7b341e',
      },
      yellow: {
        100: '#fffff0',
        200: '#fefcbf',
        300: '#faf089',
        400: '#f6e05e',
        500: '#ecc94b',
        600: '#d69e2e',
        700: '#b7791f',
        800: '#975a16',
        900: '#744210',
      },
      green: {
        100: '#f0fff4',
        200: '#c6f6d5',
        300: '#9ae6b4',
        400: '#68d391',
        500: '#48bb78',
        600: '#38a169',
        700: '#2f855a',
        800: '#276749',
        900: '#22543d',
      },
      teal: {
        100: '#e6fffa',
        200: '#b2f5ea',
        300: '#81e6d9',
        400: '#4fd1c5',
        500: '#38b2ac',
        600: '#319795',
        700: '#2c7a7b',
        800: '#285e61',
        900: '#234e52',
      },
      blue: {
        100: '#ebf8ff',
        200: '#bee3f8',
        300: '#90cdf4',
        400: '#63b3ed',
        500: '#4299e1',
        600: '#3182ce',
        700: '#2b6cb0',
        800: '#2c5282',
        900: '#2a4365',
      },
      indigo: {
        100: '#ebf4ff',
        200: '#c3dafe',
        300: '#a3bffa',
        400: '#7f9cf5',
        500: '#667eea',
        600: '#5a67d8',
        700: '#4c51bf',
        800: '#434190',
        900: '#3c366b',
      },
      purple: {
        100: '#faf5ff',
        200: '#e9d8fd',
        300: '#d6bcfa',
        400: '#b794f4',
        500: '#9f7aea',
        600: '#805ad5',
        700: '#6b46c1',
        800: '#553c9a',
        900: '#44337a',
      },
      pink: {
        100: '#fff5f7',
        200: '#fed7e2',
        300: '#fbb6ce',
        400: '#f687b3',
        500: '#ed64a6',
        600: '#d53f8c',
        700: '#b83280',
        800: '#97266d',
        900: '#702459',
      },
      rose: { 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48', 700: '#be123c', 800: '#9f1239', 900: '#881337' },
      fuchsia: { 100: '#fae8ff', 200: '#f5d0fe', 300: '#f0abfc', 400: '#e879f9', 500: '#d946ef', 600: '#c026d3', 700: '#a21caf', 800: '#86198f', 900: '#701a75' },
      slate: { 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a' }
    }
  },
  variants: {},
  plugins: []
}
