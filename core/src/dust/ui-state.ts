/**
 * 拆粉排行面板的記憶狀態(`userData/dust_ui.json`,main tmp + rename;純瀏覽器 localStorage)。
 * - `options`:排行 / 篩選選項(全域一份);
 * - `leagues[<聯盟 id>]`:標記(★)與隱藏的傳奇鍵(`name|baseType`,英文),**按聯盟分開**(新賽季不帶舊標記)。
 * 解析寬鬆:壞欄位退回預設值,不整份丟掉。
 */
import { DUST_METRICS, type CatalystMode, type DustMetric } from './rank'
import { DUST_INDEXED_OPTIONS, type DustCorruptedOption, type DustIndexedOption } from './trade'

export const DUST_UI_SCHEMA = 1

export interface DustUiOptions {
  ilvl: number
  quality: 0 | 20
  catalyst: CatalystMode
  /** 每 1000 gold 值幾 chaos */
  goldValueChaos: number
  metric: DustMetric
  /** 0 = 不限 */
  minDust: number
  /** 0 = 不限 */
  maxGold: number
  hideNoPrice: boolean
  hideLowConfidence: boolean
  hideHidden: boolean
  corrupted: DustCorruptedOption
  indexed: DustIndexedOption
}

export interface DustLeagueMarks {
  marked: string[]
  hidden: string[]
}

export interface DustUiState {
  schema: typeof DUST_UI_SCHEMA
  options: DustUiOptions
  leagues: Record<string, DustLeagueMarks>
}

export function defaultDustOptions (): DustUiOptions {
  return {
    ilvl: 84,
    quality: 0,
    catalyst: 'auto',
    goldValueChaos: 0,
    metric: 'dust/chaos',
    minDust: 0,
    maxGold: 0,
    hideNoPrice: false,
    hideLowConfidence: false,
    hideHidden: true,
    corrupted: 'any',
    indexed: '1week'
  }
}

export function defaultDustUiState (): DustUiState {
  return { schema: DUST_UI_SCHEMA, options: defaultDustOptions(), leagues: {} }
}

function numIn (v: unknown, lo: number, hi: number, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : def
}
function bool (v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def
}
function strList (v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 300))]
}

export function parseDustUiState (text: string | null | undefined): DustUiState {
  const out = defaultDustUiState()
  if (!text) return out
  let doc: unknown
  try { doc = JSON.parse(text) } catch { return out }
  if (doc == null || typeof doc !== 'object') return out
  const d = doc as Record<string, unknown>
  const o = (d.options != null && typeof d.options === 'object' ? d.options : {}) as Record<string, unknown>
  const def = out.options
  out.options = {
    ilvl: Math.trunc(numIn(o.ilvl, 1, 100, def.ilvl)),
    quality: o.quality === 20 ? 20 : 0,
    catalyst: o.catalyst === 'never' ? 'never' : 'auto',
    goldValueChaos: numIn(o.goldValueChaos, 0, 1e6, def.goldValueChaos),
    metric: DUST_METRICS.includes(o.metric as DustMetric) ? o.metric as DustMetric : def.metric,
    minDust: numIn(o.minDust, 0, 1e9, def.minDust),
    maxGold: numIn(o.maxGold, 0, 1e9, def.maxGold),
    hideNoPrice: bool(o.hideNoPrice, def.hideNoPrice),
    hideLowConfidence: bool(o.hideLowConfidence, def.hideLowConfidence),
    hideHidden: bool(o.hideHidden, def.hideHidden),
    corrupted: o.corrupted === 'true' || o.corrupted === 'false' ? o.corrupted : 'any',
    indexed: DUST_INDEXED_OPTIONS.includes(o.indexed as DustIndexedOption) ? o.indexed as DustIndexedOption : def.indexed
  }
  if (d.leagues != null && typeof d.leagues === 'object') {
    for (const [league, v] of Object.entries(d.leagues as Record<string, unknown>)) {
      if (!league || v == null || typeof v !== 'object') continue
      const m = v as Record<string, unknown>
      const marks = { marked: strList(m.marked), hidden: strList(m.hidden) }
      if (marks.marked.length || marks.hidden.length) out.leagues[league] = marks
    }
  }
  return out
}

export function serializeDustUiState (s: DustUiState): string {
  const leagues: Record<string, DustLeagueMarks> = {}
  for (const k of Object.keys(s.leagues).sort()) {
    const m = s.leagues[k]
    if (!m.marked.length && !m.hidden.length) continue
    leagues[k] = { marked: [...m.marked].sort(), hidden: [...m.hidden].sort() }
  }
  return JSON.stringify({ schema: DUST_UI_SCHEMA, options: s.options, leagues }, null, 2) + '\n'
}

/** 切換某聯盟某鍵的標記 / 隱藏(就地改),回傳切換後是否有該旗標。 */
export function toggleDustMark (s: DustUiState, league: string, kind: 'marked' | 'hidden', key: string): boolean {
  const m = s.leagues[league] ?? (s.leagues[league] = { marked: [], hidden: [] })
  const list = m[kind]
  const i = list.indexOf(key)
  if (i >= 0) {
    list.splice(i, 1)
    return false
  }
  list.push(key)
  return true
}
