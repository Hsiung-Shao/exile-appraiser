/**
 * 拆粉資料的型別與解析(純函式;讀檔由呼叫端做)。
 *
 * - `data/dust/poe-dust.json`:deronek/poe-disenchant-tool `data/dust/poe-dust.js` 逐筆轉 JSON(`scripts/sync-dust-data.mjs`),
 *   數值源自 @alserom 的 gist。`goldCost`(拆解手續費,gold)與 `slots`(背包格數)只從這裡取。
 * - `data/poe1/{en,cmn-Hant}/items.ndjson`:APT 的物品資料;傳奇的 `unique.disenchantValue` 是拆粉基數(主要來源)。
 *
 * 對接一律用英文 `name` + `baseType`(傳奇 = `refName` + `unique.base`),**不按位置**。
 */
import { dustAt } from './formula'

export interface PoeDustRow {
  name: string
  baseType: string
  dustValIlvl84?: number
  dustValIlvl84Q20?: number
  goldCost?: number
  slots?: number
}

/** APT 資料裡有拆粉基數的一件傳奇。 */
export interface DustUnique {
  /** 英文名(refName) */
  name: string
  /** 英文基底(unique.base) */
  baseType: string
  disenchantValue: number
  /** 繁中名(cmn-Hant items.ndjson 以 refName 對接;沒有就 undefined) */
  nameZh?: string
  /** 繁中基底名 */
  baseZh?: string
  /** 基底的 `craftable.category`(Ring / Amulet / Belt / Boots…) */
  category?: string
}

export function dustKey (name: string, baseType: string): string {
  return name + '|' + baseType
}

function num (v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** `poe-dust.json` 文字 → 列;格式不對丟錯。 */
export function parsePoeDust (text: string): PoeDustRow[] {
  const doc: unknown = JSON.parse(text)
  if (!Array.isArray(doc)) throw new Error('poe-dust.json 不是陣列')
  const out: PoeDustRow[] = []
  for (const r of doc) {
    if (r == null || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.name !== 'string' || typeof o.baseType !== 'string') continue
    out.push({
      name: o.name,
      baseType: o.baseType,
      dustValIlvl84: num(o.dustValIlvl84),
      dustValIlvl84Q20: num(o.dustValIlvl84Q20),
      goldCost: num(o.goldCost),
      slots: num(o.slots)
    })
  }
  return out
}

export function indexPoeDust (rows: readonly PoeDustRow[]): Map<string, PoeDustRow> {
  const m = new Map<string, PoeDustRow>()
  for (const r of rows) m.set(dustKey(r.name, r.baseType), r)
  return m
}

/** 固有勢力反推的容忍值(disenchantValue 只有兩位小數、公式有 floor) */
export const INHERENT_INFLUENCE_TOLERANCE = 1

/**
 * 本身固定帶 Shaper/Elder 等勢力的傳奇(Starforge、Voidforge、Mark of the Shaper、Indigon…)的勢力數,
 * 從 poe-dust 的數值反推(依英文名 + 基底對接,由呼叫端取得 `pd`)。
 *
 * APT 是在解析物品文字時才加勢力倍率(每種 +50%),`unique.disenchantValue` 本身不含;排行沒有物品文字,
 * 所以要靠這裡補。規則(只有恰好吻合才採用,否則 0):
 * - APT 公式在勢力 0 時已與 poe-dust 吻合 → 0;
 * - 比值 `dustValIlvl84 ÷ (disenchantValue × 2500)` 換算 n = (比值 − 1) ÷ 0.5 取整,只接受 1(1.5 倍)或 2(2.0 倍);
 * - 且 `dustAt(dv, {ilvl 84, q0, influences: n})` 與 `dustAt(dv, {ilvl 84, q20, influences: n})` 兩欄都在 ±1 內。
 * Venarius' Astrolabe(比值 4.0)等其他差異不套,留在 `docs/dust-crosscheck.md`。
 * 單件查價(DustValue)有物品文字,不用這個。
 */
export function inherentInfluencesFromPoeDust (disenchantValue: number, pd: PoeDustRow | undefined): number {
  if (!pd || !(disenchantValue > 0)) return 0
  const q0 = pd.dustValIlvl84
  const q20 = pd.dustValIlvl84Q20
  if (q0 === undefined || q20 === undefined) return 0
  const tol = INHERENT_INFLUENCE_TOLERANCE
  const fits = (n: number): boolean =>
    Math.abs(q0 - dustAt(disenchantValue, { ilvl: 84, quality: 0, influences: n })) <= tol &&
    Math.abs(q20 - dustAt(disenchantValue, { ilvl: 84, quality: 20, influences: n })) <= tol
  if (fits(0)) return 0
  const n = Math.round((q0 / (disenchantValue * 2500) - 1) / 0.5)
  if (n !== 1 && n !== 2) return 0
  return fits(n) ? n : 0
}

interface NdjsonItem {
  name?: unknown
  refName?: unknown
  namespace?: unknown
  unique?: { base?: unknown, disenchantValue?: unknown }
  craftable?: { category?: unknown }
}

function * ndjsonLines (text: string): Generator<NdjsonItem> {
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try { yield JSON.parse(s) as NdjsonItem } catch {}
  }
}

/**
 * 從 items.ndjson 取有拆粉基數的傳奇。
 * @param enText  `data/poe1/en/items.ndjson`(英文名、基底、disenchantValue、基底類別)
 * @param zhText  `data/poe1/cmn-Hant/items.ndjson`(選用;以 refName 對接繁中名與繁中基底名)
 */
export function dustUniquesFromNdjson (enText: string, zhText?: string): DustUnique[] {
  const baseCategory = new Map<string, string>()
  const uniques: DustUnique[] = []
  for (const it of ndjsonLines(enText)) {
    if (it.namespace === 'ITEM' && typeof it.refName === 'string' && typeof it.craftable?.category === 'string') {
      baseCategory.set(it.refName, it.craftable.category)
    }
    if (it.namespace !== 'UNIQUE' || typeof it.refName !== 'string') continue
    const base = it.unique?.base
    const dv = it.unique?.disenchantValue
    if (typeof base !== 'string' || typeof dv !== 'number' || !(dv > 0)) continue
    uniques.push({ name: it.refName, baseType: base, disenchantValue: dv })
  }
  const zhUnique = new Map<string, string>()
  const zhItem = new Map<string, string>()
  if (zhText) {
    for (const it of ndjsonLines(zhText)) {
      if (typeof it.refName !== 'string' || typeof it.name !== 'string') continue
      if (it.namespace === 'UNIQUE' && !zhUnique.has(it.refName)) zhUnique.set(it.refName, it.name)
      else if (it.namespace === 'ITEM' && !zhItem.has(it.refName)) zhItem.set(it.refName, it.name)
    }
  }
  for (const u of uniques) {
    u.category = baseCategory.get(u.baseType)
    const zn = zhUnique.get(u.name)
    if (zn) u.nameZh = zn
    const zb = zhItem.get(u.baseType)
    if (zb) u.baseZh = zb
  }
  return uniques
}
