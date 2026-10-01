/**
 * OCR 徽章外觀(第 11 步,使用者需求):符文塑形價格徽章(`RuneshapePrices.vue`)與褻瀆徽章(`OcrBadges.vue`)共用一組設定
 * `config.ocrBadgeStyle`:字體 / 大小 / 粗體 / 外框陰影;價格三段顏色只給符文(褻瀆的語意色 —— 模糊命中警告色、dim —— 保留)。
 *
 * 套用方式:徽章層根元素設 CSS 變數(`badgeStyleVars`),徽章樣式寫成 `var(--badge-x, 原值)`。
 * **全部預設時不輸出任何變數** → 渲染與改版前完全相同(`renderer/test/badge-style.test.ts` 守門)。
 * 純函式、不 import Vue(renderer vitest 沒有別名)。
 */

export type BadgeOutline = 'none' | 'shadow' | 'outline'
export type BadgeTier = 'low' | 'mid' | 'high'

export interface OcrBadgeStyle {
  /** 字體 family 名稱;'' = 跟隨介面(`--font-ui`) */
  fontFamily: string
  /** 徽章主文字字級 px(10–32);null = 跟隨現狀(褻瀆 `--fs-base`、符文 `--fs-sm`) */
  fontSize: number | null
  bold: boolean
  /** 符文價格三段顏色 `#rrggbb`;null = 主題預設(低 = 灰、中 = 一般字色 + 主題色左條、高 = 金) */
  tierColors: Record<BadgeTier, string | null>
  /** 文字外框 / 陰影 */
  outline: BadgeOutline
}

export const BADGE_FONT_SIZE_MIN = 10
export const BADGE_FONT_SIZE_MAX = 32
/** 字體名上限(與 main `system-fonts.ts` 相同) */
const MAX_FONT_NAME = 128
/** 設定頁字體下拉的內建選項(出貨字型;`pobtools.css` 的 @font-face) */
export const BUILTIN_BADGE_FONT = 'Noto Sans TC'

export function defaultOcrBadgeStyle (): OcrBadgeStyle {
  return { fontFamily: '', fontSize: null, bold: false, tierColors: { low: null, mid: null, high: null }, outline: 'none' }
}

/** 只收 `#rrggbb`(轉小寫);其他(含 `#rgb`、色名、rgb())→ null */
export function normHexColor (v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null
}

/** 字體名:去頭尾空白;含引號 / 反斜線 / 控制字元 / 太長 → ''(跟隨介面) */
export function normFontFamily (v: unknown): string {
  if (typeof v !== 'string') return ''
  const s = v.trim()
  // 刻意比對控制字元:含控制字元或 CSS 特殊字元的字體名一律回到「跟隨介面」,避免注入 CSS
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > MAX_FONT_NAME || /[\u0000-\u001f\u007f"\\;{}]/.test(s)) return ''
  return s
}

/** 字級:有限數 → 四捨五入並夾到 10–32;null / 其他 → null(跟隨) */
export function normBadgeFontSize (v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.min(BADGE_FONT_SIZE_MAX, Math.max(BADGE_FONT_SIZE_MIN, Math.round(v)))
}

/** 設定檔 → 外觀;壞值逐欄回預設,舊設定檔沒有這個鍵 → 預設 */
export function normOcrBadgeStyle (v: unknown): OcrBadgeStyle {
  const d = defaultOcrBadgeStyle()
  if (!v || typeof v !== 'object' || Array.isArray(v)) return d
  const r = v as Record<string, unknown>
  const tc = r.tierColors && typeof r.tierColors === 'object' ? r.tierColors as Record<string, unknown> : {}
  return {
    fontFamily: normFontFamily(r.fontFamily),
    fontSize: normBadgeFontSize(r.fontSize),
    bold: r.bold === true,
    tierColors: { low: normHexColor(tc.low), mid: normHexColor(tc.mid), high: normHexColor(tc.high) },
    outline: r.outline === 'shadow' || r.outline === 'outline' ? r.outline : 'none'
  }
}

/** 是否全部預設(設定頁「全部還原」是否可按) */
export function isDefaultBadgeStyle (s: OcrBadgeStyle): boolean {
  return Object.keys(badgeStyleVars(s, 'rune')).length === 0
}

/** 外框 / 陰影的 text-shadow(徽章底色是深色半透明,一律黑色光暈:遊戲亮 / 暗背景上都把字和背景分開) */
export const BADGE_HALO: Readonly<Record<Exclude<BadgeOutline, 'none'>, string>> = {
  shadow: '0 1px 2px rgba(0, 0, 0, 0.95), 0 0 4px rgba(0, 0, 0, 0.85)',
  outline: [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
    .map(([x, y]) => `${x}px ${y}px 0 #000`).join(', ')
}

/**
 * 徽章層根元素的 CSS 變數。`layer` = rune(符文:主文字 `--fs-sm`、小字 `--fs-xs` = 主 − 1)/ reveal(褻瀆:主 `--fs-base`、小字 = 主 − 2;
 * 不吃價格三段色)。預設值的欄位不輸出(樣式裡的 `var(--badge-x, 原值)` 回到原值)。
 *
 * | 變數 | 用途 |
 * |---|---|
 * | `--badge-font` | 徽章 font-family(選的字體 + `--font-ui` 後援) |
 * | `--badge-fs` / `--badge-fs-xs` | 主文字 / 小字字級 |
 * | `--badge-weight` / `--badge-weight-strong` | 一般 / 原本就粗的字(符文總價、≈) |
 * | `--badge-low` / `--badge-mid` / `--badge-high` | 符文三段價格色(字色 + 左條) |
 * | `--badge-halo` | text-shadow |
 */
export function badgeStyleVars (s: OcrBadgeStyle, layer: 'rune' | 'reveal'): Record<string, string> {
  const out: Record<string, string> = {}
  if (s.fontFamily) out['--badge-font'] = `"${s.fontFamily}", var(--font-ui)`
  if (s.fontSize != null) {
    out['--badge-fs'] = `${s.fontSize}px`
    out['--badge-fs-xs'] = `${s.fontSize - (layer === 'rune' ? 1 : 2)}px`
  }
  if (s.bold) {
    out['--badge-weight'] = '700'
    out['--badge-weight-strong'] = '800'
  }
  if (layer === 'rune') {
    for (const k of ['low', 'mid', 'high'] as const) {
      const c = s.tierColors[k]
      if (c) out[`--badge-${k}`] = c
    }
  }
  if (s.outline !== 'none') out['--badge-halo'] = BADGE_HALO[s.outline]
  return out
}

/** 褻瀆徽章估計高度用的主字級(px):設定了就用設定值,否則 `--fs-base` */
export function revealBadgeFontPx (s: Pick<OcrBadgeStyle, 'fontSize'>, fsBasePx: number): number {
  return s.fontSize ?? fsBasePx
}

/**
 * 設定頁字體下拉的選項:「跟隨介面」('')→ 內建 Noto Sans TC → 系統字體(去掉與內建重複的);
 * 依 `filter`(不分大小寫子字串)篩選系統字體;目前選的值永遠保留(即使被篩掉或系統上已不存在)。
 */
export function fontOptions (system: readonly string[], filter: string, current: string): string[] {
  const q = filter.trim().toLowerCase()
  const sys = system.filter(n => n.toLowerCase() !== BUILTIN_BADGE_FONT.toLowerCase())
  const shown = q ? sys.filter(n => n.toLowerCase().includes(q)) : sys
  const out = ['', BUILTIN_BADGE_FONT, ...shown]
  if (current && !out.some(n => n.toLowerCase() === current.toLowerCase())) out.splice(2, 0, current)
  return out
}
