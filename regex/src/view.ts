// 面板(renderer `web/regex/RegexPanel.vue`)用的純邏輯:篩選、列文字、長度分級。
// 移植自 PobTools `host/regex_tool_ui.cpp`:`ZhLine` :60、`EnLine` :69、`LineIn`/`OtherLine` :82、
// `refreshFilter` :1017、`matches` :1045、`drawOutput` 的長度三色 :662。純 TS,無 DOM,可在 vitest 測。

import type { RegexEntry, RegexLang, RegexPage } from './data'
import { rangeOp, type AlgoEntry, type AlgoPage, type AlgoValue } from './pages/types'
import { zhLine } from './state'

/** regex_tool_ui.cpp:69 `EnLine`:英文全部行以「 / 」接起(同一個中文名對到多個英文時全列);沒有英文就退回中文 */
export function enLine (d: RegexEntry): string {
  return d.en.length ? d.en.join(' / ') : zhLine(d)
}

/** regex_tool_ui.cpp:82 `LineIn`:主文字(依輸出語言) */
export function lineIn (d: RegexEntry, lang: RegexLang): string {
  return lang === 'zh' ? zhLine(d) : enLine(d)
}

/** regex_tool_ui.cpp:87 `OtherLine`:雙語顯示的副文字(另一種語言);空字串 = 沒有對照 */
export function otherLine (d: RegexEntry, lang: RegexLang): string {
  if (lang === 'zh') return d.en.length ? d.en.join(' / ') : ''
  return d.zh[0] ?? ''
}

/** 主文字之外該語言還有幾行(C++ 在列尾加「(另有 N 行)」) */
export function extraLines (d: RegexEntry, lang: RegexLang): number {
  const n = (lang === 'zh' ? d.zh : d.en).length
  return n > 1 ? n - 1 : 0
}

function lowerAscii (s: string): string {
  return s.replace(/[A-Z]/g, c => c.toLowerCase())
}

/**
 * regex_tool_ui.cpp:1045 `matches`:中文、英文、`affixZh`、GGPK id 都算。
 * `needle` 必須已經過 `lowerAscii`(只摺 ASCII,與 C++ `ToLowerAscii` 相同)。
 */
export function entryMatches (d: RegexEntry, needle: string): boolean {
  if (d.zh.some(l => l.includes(needle))) return true
  if (d.en.some(l => lowerAscii(l).includes(needle))) return true
  if (d.affixZh && d.affixZh.includes(needle)) return true
  return lowerAscii(d.id).includes(needle)
}

/** T17 三態:全部 / 只看 / 排除 */
export type T17Filter = 'all' | 'only' | 'hide'

export interface ListFilter {
  search: string
  /** -1 = 全部分類 */
  group: number
  t17: T17Filter
}

/** 該頁有沒有 T17 項目(沒有就不顯示 T17 三態) */
export function pageHasT17 (page: RegexPage): boolean {
  return page.entries.some(e => e.t17)
}

/**
 * regex_tool_ui.cpp:1017 `refreshFilter`:通過篩選的列索引。勾選的先、其餘在後,各自保持資料檔順序
 * (兩趟而不是排序:不會讓相等的列在重繪間換位)。
 */
export function visibleRows (page: RegexPage, picked: ReadonlySet<number>, f: ListFilter): number[] {
  const needle = lowerAscii(f.search.trim())
  const out: number[] = []
  for (let pass = 0; pass < 2; pass++) {
    const wantPicked = pass === 0
    page.entries.forEach((e, i) => {
      if (picked.has(i) !== wantPicked) return
      if (f.group >= 0 && e.g !== f.group) return
      if (f.t17 === 'only' && !e.t17) return
      if (f.t17 === 'hide' && e.t17) return
      if (needle && !entryMatches(e, needle)) return
      out.push(i)
    })
  }
  return out
}

/** 長度三色(regex_tool_ui.cpp:662):≤80% ok、>80% warn、>100% bad */
export type LengthLevel = 'ok' | 'warn' | 'bad'

export function lengthLevel (len: number, limit: number): LengthLevel {
  if (len > limit) return 'bad'
  // C++ `len > lim * 4 / 5`(整數除法)
  if (len > Math.trunc(limit * 4 / 5)) return 'warn'
  return 'ok'
}

/** tooltip 的「遊戲搜尋也會比對」:依輸出語言,最多 `max` 行 + 剩下幾行 */
export function hiddenPreview (d: RegexEntry, lang: RegexLang, max = 4): { lines: string[], more: number } {
  const h = lang === 'zh' ? d.hiddenZh : d.hiddenEn
  return { lines: h.slice(0, max), more: Math.max(0, h.length - max) }
}

// ---- 嵌入式數值區(第 32 步):收合時的摘要 ----

/** 摘要的一項:名稱 + 條件文字(輸入不成立 = null) */
export interface SectionSummaryItem {
  id: string
  label: string
  cond: string | null
}

/** 數值條件 → 「≥16」「≤5%」「10–20%」;不是範圍輸入就顯示選項 id;不成立 = null */
export function condText (e: AlgoEntry, v: AlgoValue, lang: RegexLang): string | null {
  if (e.fragment(v, lang) === null) return null
  if (e.input.kind !== 'range') return v.choice ?? (typeof v.min === 'number' ? `≥${v.min}` : null)
  const pct = e.input.percent ? '%' : ''
  const op = rangeOp(v)
  if (op === 'ge') return `≥${v.min}${pct}`
  if (op === 'le') return `≤${v.max}${pct}`
  if (op === 'range') return `${v.min}–${v.max}${pct}`
  return null
}

/**
 * 數值區收合時顯示的摘要:只列已勾選的項目,依列順序;`valueOf` = 項目目前的值(沒存過 = 預設值)。
 * `labelLang` = 名稱用的語言(介面語言),條件文字與片段無關、兩語相同。
 */
export function sectionSummary (
  page: AlgoPage,
  picked: Iterable<number>,
  valueOf: (e: AlgoEntry) => AlgoValue,
  labelLang: RegexLang
): SectionSummaryItem[] {
  const set = new Set(picked)
  const out: SectionSummaryItem[] = []
  page.entries.forEach((e, i) => {
    if (!set.has(i)) return
    out.push({ id: e.id, label: (labelLang === 'en' ? e.en[0] : e.zh[0]) ?? e.id, cond: condText(e, valueOf(e), labelLang) })
  })
  return out
}
