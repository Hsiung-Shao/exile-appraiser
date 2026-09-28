/**
 * 拆粉基數交叉比對:APT `unique.disenchantValue`(主要來源)vs poe-dust.js(deronek / @alserom)。
 *
 * 以英文 `name` + `baseType` 對接(**不按位置**),比較
 *   dustAt(disenchantValue, ilvl 84, q0)  ≈ disenchantValue × 2500  vs `dustValIlvl84`
 *   dustAt(disenchantValue, ilvl 84, q20) ≈ disenchantValue × 3500  vs `dustValIlvl84Q20`
 * 容忍 ±1(disenchantValue 只有兩位小數、公式有 floor)。只報告,不改任何資料;採用哪份由使用者裁定。
 */
import { dustAt } from './formula'
import { dustKey, type DustUnique, type PoeDustRow } from './data'

export const CROSSCHECK_TOLERANCE = 1

export interface CrossCheckMismatch {
  name: string
  baseType: string
  disenchantValue: number
  aptQ0: number
  aptQ20: number
  dustQ0?: number
  dustQ20?: number
  /** poe-dust ÷ APT(q0);APT 為 0 或 poe-dust 缺值時 undefined */
  ratioQ0?: number
  ratioQ20?: number
  /** 哪一欄不一致 */
  fields: Array<'q0' | 'q20'>
  /**
   * 若把 APT 公式的「勢力數」設成 n(1–3)兩欄就都吻合,記下 n(只是算術觀察:poe-dust 可能把固定勢力算進去了;
   * 報告照列,不據此改資料)。
   */
  matchesWithInfluences?: number
}

export interface CrossCheckOneSide {
  name: string
  baseType: string
  /** 另一邊有同英文名、但基底不同的列(只是提示,不拿來對接) */
  sameNameOtherBase: string[]
}

export interface CrossCheckResult {
  aptCount: number
  dustCount: number
  /** 兩邊都有、q0 與 q20 都在容忍範圍內 */
  matched: number
  mismatched: CrossCheckMismatch[]
  onlyApt: CrossCheckOneSide[]
  onlyDust: CrossCheckOneSide[]
  /** 兩邊都有但 poe-dust 缺 goldCost 的(排行的 gold 欄會空白) */
  missingGold: Array<{ name: string, baseType: string }>
}

const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const byName = (a: { name: string, baseType: string }, b: { name: string, baseType: string }): number =>
  cmp(a.name, b.name) || cmp(a.baseType, b.baseType)

function ratio (other: number | undefined, apt: number): number | undefined {
  if (other === undefined || apt === 0) return undefined
  return other / apt
}

export function crossCheck (uniques: readonly DustUnique[], dustRows: readonly PoeDustRow[]): CrossCheckResult {
  const dustBy = new Map<string, PoeDustRow>()
  const dustNames = new Map<string, string[]>()
  for (const r of dustRows) {
    dustBy.set(dustKey(r.name, r.baseType), r)
    dustNames.set(r.name, [...(dustNames.get(r.name) ?? []), r.baseType])
  }
  const aptKeys = new Set<string>()
  const aptNames = new Map<string, string[]>()
  for (const u of uniques) {
    aptKeys.add(dustKey(u.name, u.baseType))
    aptNames.set(u.name, [...(aptNames.get(u.name) ?? []), u.baseType])
  }

  let matched = 0
  const mismatched: CrossCheckMismatch[] = []
  const onlyApt: CrossCheckOneSide[] = []
  const missingGold: Array<{ name: string, baseType: string }> = []

  for (const u of uniques) {
    const d = dustBy.get(dustKey(u.name, u.baseType))
    if (!d) {
      onlyApt.push({ name: u.name, baseType: u.baseType, sameNameOtherBase: (dustNames.get(u.name) ?? []).filter(b => b !== u.baseType).sort(cmp) })
      continue
    }
    if (d.goldCost === undefined) missingGold.push({ name: u.name, baseType: u.baseType })
    const aptQ0 = dustAt(u.disenchantValue, { ilvl: 84, quality: 0 })
    const aptQ20 = dustAt(u.disenchantValue, { ilvl: 84, quality: 20 })
    const fields: Array<'q0' | 'q20'> = []
    if (d.dustValIlvl84 === undefined || Math.abs(d.dustValIlvl84 - aptQ0) > CROSSCHECK_TOLERANCE) fields.push('q0')
    if (d.dustValIlvl84Q20 === undefined || Math.abs(d.dustValIlvl84Q20 - aptQ20) > CROSSCHECK_TOLERANCE) fields.push('q20')
    if (!fields.length) {
      matched++
      continue
    }
    let matchesWithInfluences: number | undefined
    for (let n = 1; n <= 3 && matchesWithInfluences === undefined; n++) {
      const q0 = dustAt(u.disenchantValue, { ilvl: 84, quality: 0, influences: n })
      const q20 = dustAt(u.disenchantValue, { ilvl: 84, quality: 20, influences: n })
      if (d.dustValIlvl84 !== undefined && d.dustValIlvl84Q20 !== undefined &&
        Math.abs(d.dustValIlvl84 - q0) <= CROSSCHECK_TOLERANCE && Math.abs(d.dustValIlvl84Q20 - q20) <= CROSSCHECK_TOLERANCE) {
        matchesWithInfluences = n
      }
    }
    mismatched.push({
      name: u.name,
      baseType: u.baseType,
      disenchantValue: u.disenchantValue,
      aptQ0,
      aptQ20,
      dustQ0: d.dustValIlvl84,
      dustQ20: d.dustValIlvl84Q20,
      ratioQ0: ratio(d.dustValIlvl84, aptQ0),
      ratioQ20: ratio(d.dustValIlvl84Q20, aptQ20),
      fields,
      matchesWithInfluences
    })
  }
  const onlyDust: CrossCheckOneSide[] = dustRows
    .filter(r => !aptKeys.has(dustKey(r.name, r.baseType)))
    .map(r => ({ name: r.name, baseType: r.baseType, sameNameOtherBase: (aptNames.get(r.name) ?? []).filter(b => b !== r.baseType).sort(cmp) }))

  return {
    aptCount: uniques.length,
    dustCount: dustRows.length,
    matched,
    mismatched: mismatched.sort(byName),
    onlyApt: onlyApt.sort(byName),
    onlyDust: onlyDust.sort(byName),
    missingGold: missingGold.sort(byName)
  }
}

function fmt (n: number | undefined): string {
  return n === undefined ? '—' : String(n)
}
function fmtRatio (n: number | undefined): string {
  return n === undefined ? '—' : n.toFixed(4)
}
/** Markdown 表格儲存格:`|` 與換行跳脫 */
function cell (s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export interface CrossCheckReportMeta {
  aptSource: string
  dustSource: string
  generatedAt: string
}

/** 報告(`docs/dust-crosscheck.md`)。清單一律英文原名,不翻譯、不臆測原因。 */
export function renderCrossCheckMarkdown (r: CrossCheckResult, meta: CrossCheckReportMeta): string {
  const L: string[] = []
  L.push('# 拆粉基數交叉比對(APT disenchantValue vs poe-dust.js)')
  L.push('')
  L.push('> 由 `node scripts/dust-crosscheck.mjs` 產生,請勿手改。只報告差異,不改任何資料。')
  L.push('')
  L.push(`- APT 來源:${meta.aptSource}`)
  L.push(`- poe-dust 來源:${meta.dustSource}`)
  L.push(`- 產生時間:${meta.generatedAt}`)
  L.push('- 對接鍵:英文名 + 基底(APT `refName` + `unique.base` ↔ poe-dust `name` + `baseType`),不按位置。')
  L.push(`- 比較:\`floor(disenchantValue × 2500)\` vs \`dustValIlvl84\`、\`floor(disenchantValue × 3500)\` vs \`dustValIlvl84Q20\`(即 \`dustAt(dv, {ilvl: 84, quality: 0|20})\`),容忍 ±${CROSSCHECK_TOLERANCE}。`)
  L.push('')
  L.push('## 統計')
  L.push('')
  L.push('| 項目 | 筆數 |')
  L.push('|---|---:|')
  L.push(`| APT 有 disenchantValue 的傳奇 | ${r.aptCount} |`)
  L.push(`| poe-dust 列數 | ${r.dustCount} |`)
  L.push(`| 兩邊都有且一致 | ${r.matched} |`)
  L.push(`| 兩邊都有但不一致 | ${r.mismatched.length} |`)
  L.push(`| 只在 APT | ${r.onlyApt.length} |`)
  L.push(`| 只在 poe-dust | ${r.onlyDust.length} |`)
  L.push(`| 兩邊都有但 poe-dust 缺 goldCost | ${r.missingGold.length} |`)
  L.push('')
  L.push('## 不一致')
  L.push('')
  if (!r.mismatched.length) {
    L.push('(無)')
  } else {
    const explained = r.mismatched.filter(m => m.matchesWithInfluences !== undefined).length
    L.push(`「勢力數 n 時吻合」= 把 APT 公式的勢力數設成 n(每個 +50%)後兩欄都在容忍範圍內;共 ${explained} / ${r.mismatched.length} 筆。` +
      '這些推定是本身固定帶勢力(Shaper/Elder 等)的傳奇:APT 在解析物品文字時才加勢力倍率,disenchantValue 不含。' +
      '**拆粉排行**沒有物品文字,改用 `inherentInfluencesFromPoeDust` 對這些列套上 n(只接受 1 / 2 且兩欄恰好吻合);' +
      "單件查價(有物品文字)不受影響。沒有 n 的列(如 Venarius' Astrolabe)排行維持 APT 值。")
    L.push('')
    L.push('| 名稱 | 基底 | disenchantValue | APT q0 | poe-dust q0 | 比值 q0 | APT q20 | poe-dust q20 | 比值 q20 | 勢力數 n 時吻合 |')
    L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|')
    for (const m of r.mismatched) {
      L.push(`| ${cell(m.name)} | ${cell(m.baseType)} | ${m.disenchantValue} | ${m.aptQ0} | ${fmt(m.dustQ0)} | ${fmtRatio(m.ratioQ0)} | ${m.aptQ20} | ${fmt(m.dustQ20)} | ${fmtRatio(m.ratioQ20)} | ${m.matchesWithInfluences ?? '—'} |`)
    }
  }
  const oneSide = (title: string, list: CrossCheckOneSide[], other: string) => {
    L.push('')
    L.push(`## ${title}`)
    L.push('')
    if (!list.length) {
      L.push('(無)')
      return
    }
    L.push(`| 名稱 | 基底 | ${other}同名但基底不同 |`)
    L.push('|---|---|---|')
    for (const o of list) L.push(`| ${cell(o.name)} | ${cell(o.baseType)} | ${o.sameNameOtherBase.map(cell).join(', ')} |`)
  }
  oneSide('只在 APT(poe-dust 沒有這個 名稱+基底)', r.onlyApt, 'poe-dust ')
  oneSide('只在 poe-dust(APT 沒有這個 名稱+基底)', r.onlyDust, 'APT ')
  L.push('')
  L.push('## poe-dust 缺 goldCost')
  L.push('')
  if (!r.missingGold.length) L.push('(無)')
  else for (const g of r.missingGold) L.push(`- ${g.name} / ${g.baseType}`)
  L.push('')
  return L.join('\n')
}
