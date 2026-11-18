import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'

/**
 * 類型掃描:每一類物品「會出現的詞綴」(GGPK 詞綴表,`scripts/poe1-season/dump-type-sweep.mjs` 產生的
 * `docs/type-sweep.json`)中英各組成一件進階複製格式的物品,走真的解析器。
 *
 * 缺口四種:error(整件解析失敗)、unknown(未解析詞綴)、dropped(句子被靜默丟掉 / 沒有這個類型的交易站 id)、
 * mismatch(中英解析成不同詞綴 → 兩語查詢不同)。已知缺口鎖在 `docs/type-sweep-gaps.json`,**只能變少**:
 * 修好一類後 `UPDATE_FIXTURES=1` 重寫並 review 差異;出現清單外的新缺口 = 紅。
 * 句子是照 GGPK 組的,不是實機剪貼簿。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const GAPS_FILE = path.join(HERE, 'docs/type-sweep-gaps.json')
const sweep = JSON.parse(fs.readFileSync(path.join(HERE, 'docs/type-sweep.json'), 'utf8')) as {
  lines: Array<[string, string]>
  classes: Record<string, { class: [string, string] | null, bases: Array<[string, string]>, explicit: number[], implicit: number[] }>
}
type Lang = 'en' | 'cmn-Hant'
type ModType = 'explicit' | 'implicit'

function itemText (lang: Lang, cls: string, klass: string, base: string, type: ModType | null, line: string): string {
  const zh = lang === 'cmn-Hant'
  const tier = cls === 'Map' ? (zh ? '（階級 16）' : ' (Tier 16)') : ''
  const L = [
    zh ? `物品種類: ${klass}` : `Item Class: ${klass}`, zh ? '稀有度: 稀有' : 'Rarity: Rare', zh ? '末日循環' : 'Doom Loop', base + tier,
    '--------', zh ? '物品等級: 84' : 'Item Level: 84'
  ]
  if (type === 'implicit') L.push('--------', zh ? '{ 固定詞綴 }' : '{ Implicit Modifier }', line)
  if (type === 'explicit') L.push('--------', zh ? '{ 前綴 "測試的"(階層：1) }' : '{ Prefix Modifier "Testing" (Tier: 1) }', line)
  return L.join('\n') + '\n'
}

/** 一句的結果:解析成哪些詞綴(ref),或是哪一種缺口 */
function probe (lang: Lang, cls: string, klass: string, base: string, type: ModType, line: string): string {
  const r = parseClipboard(itemText(lang, cls, klass, base, type, line))
  if (r.isErr()) return 'error'
  if (r.value.unknownModifiers.length) return 'unknown'
  const refs = r.value.statsByType.filter(s => s.type === type && type in s.stat.trade.ids).map(s => s.stat.ref).sort()
  return refs.length ? refs.join(' + ') : 'dropped'
}

/** 每類挑第一個本專案認得的底材(GGPK 裡有很多舊底材 / 未上架底材) */
function pickBase (lang: Lang, cls: string): string | undefined {
  const c = sweep.classes[cls]
  const at = lang === 'en' ? 0 : 1
  // 3.30 地圖只剩一個底材「地圖」;GGPK 的類別名「異界地圖」不是剪貼簿上的寫法
  if (cls === 'Map') { c.class = ['Maps', '地圖']; c.bases = [['Map', '地圖']] }
  if (!c.class) return undefined
  return c.bases.map(b => b[at]).find(b => parseClipboard(itemText(lang, cls, c.class![at], b, null, '')).isOk())
}

const results: Record<Lang, Map<string, string>> = { en: new Map(), 'cmn-Hant': new Map() }
const noBase: Record<Lang, string[]> = { en: [], 'cmn-Hant': [] }

async function run (lang: Lang) {
  await init(lang)
  const at = lang === 'en' ? 0 : 1
  for (const [cls, c] of Object.entries(sweep.classes)) {
    const base = pickBase(lang, cls)
    if (!base) { noBase[lang].push(cls); continue }
    for (const type of ['explicit', 'implicit'] as const) {
      for (const ix of c[type]) results[lang].set(`${cls}|${type}|${sweep.lines[ix][0]}`, probe(lang, cls, c.class![at], base, type, sweep.lines[ix][at]))
    }
  }
}

const GAP = new Set(['error', 'unknown', 'dropped'])

describe('類型掃描:每類物品會出現的詞綴中英都解析得到', () => {
  it('英文', async () => { await run('en'); expect(results.en.size).toBeGreaterThan(1000) })
  it('繁中', async () => { await run('cmn-Hant'); expect(results['cmn-Hant'].size).toBeGreaterThan(1000) })

  it('缺口不超出已知清單(只能變少)', () => {
    const gaps: Record<string, string> = {}
    for (const cls of new Set([...noBase.en, ...noBase['cmn-Hant']])) gaps[`${cls}|base`] = `找不到認得的底材:${['en', 'cmn-Hant'].filter(l => noBase[l as Lang].includes(cls)).join(',')}`
    for (const key of [...results.en.keys()].sort()) {
      const en = results.en.get(key)!
      const zh = results['cmn-Hant'].get(key)
      if (zh === undefined) continue // 那一類繁中沒有底材,已記在上面
      if (GAP.has(en) || GAP.has(zh)) gaps[key] = `en:${GAP.has(en) ? en : 'ok'} zh:${GAP.has(zh) ? zh : 'ok'}`
      else if (en !== zh) gaps[key] = `mismatch en:${en} zh:${zh}`
    }
    if (process.env.UPDATE_FIXTURES) fs.writeFileSync(GAPS_FILE, JSON.stringify(gaps, null, 1) + '\n')
    const known = JSON.parse(fs.readFileSync(GAPS_FILE, 'utf8')) as Record<string, string>
    // 新缺口(清單外,或同一句變成另一種缺口)
    expect(Object.entries(gaps).filter(([k, v]) => known[k] !== v)).toEqual([])
    // 已修好的要從清單拿掉,清單才會跟著變少
    expect(Object.keys(known).filter(k => !(k in gaps))).toEqual([])
  })
})
