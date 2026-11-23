import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard, type ParsedItem } from '@/parser'
import { createPresets, createTradeRequest } from '../src/index'
import type { FilterOrGroup, StatFilter } from '@/web/price-check/filters/interfaces'

/**
 * 類型掃描:每一類物品「會出現的詞綴」(GGPK 詞綴表,`scripts/poe1-season/dump-type-sweep.mjs` 產生的
 * `docs/type-sweep.json`)中英各組成一件進階複製格式的物品,走真的解析器與真的查詢組法(國際服)。
 *
 * 每一句分六段記錄(不合成一個「失敗」):
 * 1. 解析:error(整件解析失敗)、unknown(未解析詞綴)、dropped(句子被靜默丟掉 / 沒有這個類型的交易站 id)
 * 2. 中英一致:mismatch(中英解析成不同詞綴)
 *    → 1、2 段鎖在 `docs/type-sweep-gaps.json`
 * 3. 進得了查詢:預設 preset 裡勾選這條詞綴的列後,查詢真的有它的 id(no-row = 沒有自己的列、not-sent = 勾了沒送)。
 *    被偽屬性 / 合計吃掉的(列標 fromAggregate)不算缺口,另計數量與吃掉它的那一條
 * 4. id 存在:查詢裡每個 stat id(含選項)都在交易站 stats 存檔(`docs/trade-stat-ids-3.30.json`);
 *    這條詞綴自己的列送的 id 類型(id 前綴)= 句子的來源(explicit / implicit)
 * 5. 中英查詢相同:同一句勾選後中英兩份查詢逐字相同
 * 6. 物品類別與基底:每類一件(不帶詞綴)預設查詢的類別、改查基底後的基底名稱都在 items / filters 存檔
 *    (`docs/trade-catalog-3.30.json`)
 *    → 3–6 段鎖在 `docs/type-sweep-query-gaps.json`
 * 兩份清單都**只能變少**:修好後 `UPDATE_FIXTURES=1` 重寫並 review 差異;清單外的新缺口 = 紅。
 * `SWEEP_REPORT=<檔>` 另寫每一句的明細(原句、解析結果、查詢片段)給報告用。
 * 句子是照 GGPK 組的,不是實機剪貼簿。
 * `Unique <類別>` 是傳奇專屬詞綴:組成「稀有度: 傳奇 + 傳奇名稱 + { 傳奇詞綴 }」,其餘相同。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const GAPS_FILE = path.join(HERE, 'docs/type-sweep-gaps.json')
const QUERY_GAPS_FILE = path.join(HERE, 'docs/type-sweep-query-gaps.json')
const sweep = JSON.parse(fs.readFileSync(path.join(HERE, 'docs/type-sweep.json'), 'utf8')) as {
  lines: Array<[string, string]>
  // `Unique <類別>`:傳奇專屬詞綴,uniques 與 bases 同位置(傳奇名稱 + 它的底材)
  classes: Record<string, { class: [string, string] | null, bases: Array<[string, string]>, uniques?: Array<[string, string]>, explicit: number[], implicit: number[] }>
}
const TRADE_IDS = new Set((JSON.parse(fs.readFileSync(path.join(HERE, 'docs/trade-stat-ids-3.30.json'), 'utf8')) as { ids: string[] }).ids)
const CATALOG = JSON.parse(fs.readFileSync(path.join(HERE, 'docs/trade-catalog-3.30.json'), 'utf8')) as { categories: string[], types: string[] }
const CATEGORIES = new Set(CATALOG.categories)
const TYPES = new Set(CATALOG.types)
type Lang = 'en' | 'cmn-Hant'
type ModType = 'explicit' | 'implicit'

/** 一件物品的身分:底材,傳奇另帶名稱 */
interface Pick { base: string, unique?: string }

function itemText (lang: Lang, cls: string, klass: string, pick: Pick, type: ModType | null, line: string): string {
  const zh = lang === 'cmn-Hant'
  const tier = cls === 'Map' ? (zh ? '（階級 16）' : ' (Tier 16)') : ''
  // 遊戲裡沒有稀有藥劑:藥劑組成魔法(名稱只寫底材)
  const magic = !pick.unique && cls.endsWith('Flask')
  const L = [
    zh ? `物品種類: ${klass}` : `Item Class: ${klass}`,
    ...pick.unique
      ? [zh ? '稀有度: 傳奇' : 'Rarity: Unique', pick.unique]
      : magic ? [zh ? '稀有度: 魔法' : 'Rarity: Magic'] : [zh ? '稀有度: 稀有' : 'Rarity: Rare', zh ? '末日循環' : 'Doom Loop'],
    pick.base + tier,
    '--------', zh ? '物品等級: 84' : 'Item Level: 84'
  ]
  // 劫盜藍圖一定有「區域等級 + 已揭露側廂」這一段(client_strings AREA_LEVEL / HEIST_WINGS_REVEALED),沒有的話組查詢會拋錯
  if (cls === 'HeistBlueprint') L.push('--------', zh ? '地區等級: 83' : 'Area Level: 83', zh ? '已揭露側廂: 1/4' : 'Wings Revealed: 1/4')
  if (type === 'implicit') L.push('--------', zh ? '{ 固定詞綴 }' : '{ Implicit Modifier }', line)
  if (type === 'explicit' && pick.unique) L.push('--------', zh ? '{ 傳奇詞綴 }' : '{ Unique Modifier }', line)
  else if (type === 'explicit') L.push('--------', zh ? '{ 前綴 "測試的"(階層：1) }' : '{ Prefix Modifier "Testing" (Tier: 1) }', line)
  // 探險日誌一定有區域段(區域名 / 陣營 / 帶「 (implicit)」的區域詞綴,`parseLogbookArea` 要 ≥ 3 行),沒有的話組查詢會拋錯;
  // 第 3 行是對不到任何詞綴的湊數行(被略過),區域段只剩陣營
  if (cls === 'ExpeditionLogbook') L.push('--------', zh ? '地區等級: 83' : 'Area Level: 83', '--------', 'Testing Grounds', zh ? '豔陽騎士' : 'Knights of the Sun', 'Testing Grounds (implicit)')
  return L.join('\n') + '\n'
}

function opts (lang: Lang) {
  return {
    league: 'Standard', realm: 'intl' as const, clientLanguage: lang, searchStatRange: 10,
    currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
  }
}

/** `{div_by_100}explicit.stat_1` → `explicit.stat_1` */
const bareId = (id: string) => id.startsWith('{') ? id.slice(id.indexOf('}') + 1) : id
const rowsOf = (stats: FilterOrGroup[]): StatFilter[] => stats.flatMap(s => s.group ? s.stats : [s])

/** 查詢裡所有 stat id(含 `id|選項`),以及勾選中的 id */
function queryIds (request: any) {
  const all: string[] = []
  const on = new Set<string>()
  for (const g of request.query.stats as any[]) {
    for (const f of g.filters) {
      all.push(f.value?.option !== undefined ? `${f.id}|${f.value.option}` : f.id)
      // 「以下皆無」群組裡的 id 是排除,不算送出
      if (g.type !== 'not' && !g.disabled && !f.disabled) on.add(f.id)
    }
  }
  return { all, on }
}

interface Probe {
  parse: string // 解析出的 ref(以「 + 」連)或缺口種類
  query?: 'sent' | 'eaten' | 'no-row' | 'not-sent' | 'crash'
  crash?: string
  eatenBy?: string // 吃掉它的偽屬性 ref,或「合計」(防禦 / DPS 等屬性)
  badIds?: string[] // 查詢裡不在存檔的 id
  badType?: string[] // 自己的列送的 id 類型與來源不符
  request?: string // 勾選後的查詢(JSON)
  ownIds?: string[]
}

/** 一句:解析 → 預設 preset 勾選這條詞綴自己的列 → 組查詢 */
function probe (lang: Lang, cls: string, klass: string, base: Pick, type: ModType, line: string): Probe {
  const r = parseClipboard(itemText(lang, cls, klass, base, type, line))
  if (r.isErr()) return { parse: 'error' }
  if (r.value.unknownModifiers.length) return { parse: 'unknown' }
  const mine = r.value.statsByType.filter(s => s.type === type && type in s.stat.trade.ids)
  const refs = new Set(mine.map(s => s.stat.ref))
  if (!refs.size) return { parse: 'dropped' }
  const out: Probe = { parse: [...refs].sort().join(' + ') }
  try {
    return queryProbe(r.value, refs, type, lang, out)
  } catch (e) {
    // 合成的物品缺了實機一定有的段落時,組查詢會拋錯;記成一種缺口
    return { ...out, query: 'crash', crash: String(e) }
  }
}

function queryProbe (item: ParsedItem, refs: Set<string>, type: ModType, lang: Lang, out: Probe): Probe {
  const { presets, active } = createPresets(item, opts(lang))
  const preset = presets.find(p => p.id === active)!
  const own = rowsOf(preset.stats).filter(f => refs.has(f.statRef) && !f.tradeId.some(id => bareId(id).startsWith('pseudo.')))
  if (!own.length) {
    // 沒有自己的列:看是不是整條被別的列吃掉(那條的 sources 含這一句)
    const eater = rowsOf(preset.stats).find(f => f.sources.some(s => refs.has(s.stat.stat.ref)))
    out.query = eater ? 'eaten' : 'no-row'
    if (eater) out.eatenBy = eater.statRef
  } else {
    for (const s of preset.stats) {
      if (s.group) { if (s.stats.some(f => own.includes(f))) s.meta.disabled = false } else if (own.includes(s)) s.disabled = false
    }
    for (const f of own) f.disabled = false
    if (own.some(f => f.fromAggregate)) {
      out.query = 'eaten'
      out.eatenBy = rowsOf(preset.stats).find(f => !own.includes(f) && f.sources.some(s => refs.has(s.stat.stat.ref)))?.statRef ?? '合計'
    }
  }
  const request = createTradeRequest(preset)
  const { all, on } = queryIds(request)
  out.request = JSON.stringify(request)
  if (own.length) {
    out.ownIds = [...new Set(own.flatMap(f => f.tradeId.map(bareId)))].sort()
    // 被合計吃掉的列勾選後也要真的送出,沒送一樣是缺口
    if (!out.ownIds.every(id => on.has(id))) out.query = 'not-sent'
    else if (!out.query) out.query = 'sent'
    // 一句解析成多條詞綴時,每條都要有自己的列或被別的列吃掉
    const rowless = [...refs].filter(ref => !own.some(f => f.statRef === ref) &&
      !rowsOf(preset.stats).some(f => !own.includes(f) && f.sources.some(s => s.stat.stat.ref === ref)))
    if (rowless.length) out.query = 'no-row'
    const bad = out.ownIds.filter(id => id.split('.')[0] !== type)
    if (bad.length) out.badType = bad
  }
  const missing = [...new Set(all)].filter(id => !TRADE_IDS.has(id))
  if (missing.length) out.badIds = missing
  return out
}

/** 每類挑第一個本專案認得的底材(GGPK 裡有很多舊底材 / 未上架底材);傳奇類別挑第一個認得的傳奇 */
function pickBase (lang: Lang, cls: string): Pick | undefined {
  const c = sweep.classes[cls]
  const at = lang === 'en' ? 0 : 1
  // 3.30 地圖只剩一個底材「地圖」;GGPK 的類別名「異界地圖」不是剪貼簿上的寫法
  if (cls === 'Map') { c.class = ['Maps', '地圖']; c.bases = [['Map', '地圖']] }
  if (!c.class) return undefined
  return c.bases.map((b, i) => ({ base: b[at], unique: c.uniques?.[i][at] }))
    .find(p => parseClipboard(itemText(lang, cls, c.class![at], p, null, '')).isOk())
}

/** 第 6 段:不帶詞綴的一件,預設查詢的類別 + 改查基底後的基底名稱 */
function classProbe (lang: Lang, cls: string, klass: string, base: Pick): { category?: string, type?: string, crash?: string } {
  const r = parseClipboard(itemText(lang, cls, klass, base, null, ''))
  if (r.isErr()) throw new Error(`${cls} 底材 ${base.base} 解析失敗`) // pickBase 已確認過能解析
  let presets, active
  try { ({ presets, active } = createPresets(r.value, opts(lang))) } catch (e) { return { crash: String(e) } }
  const preset = presets.find(p => p.id === active)!
  const category = (createTradeRequest(preset).query as any).filters?.type_filters?.filters?.category?.option as string | undefined
  if (preset.filters.searchRelaxed) preset.filters.searchRelaxed.disabled = true
  const t = (createTradeRequest(preset).query as any).type
  const type = t === undefined ? undefined : typeof t === 'string' ? t : `${t.option}|${t.discriminator}`
  return { category, type }
}

const results: Record<Lang, Map<string, Probe>> = { en: new Map(), 'cmn-Hant': new Map() }
const classResults: Record<Lang, Map<string, ReturnType<typeof classProbe>>> = { en: new Map(), 'cmn-Hant': new Map() }
const noBase: Record<Lang, string[]> = { en: [], 'cmn-Hant': [] }

async function run (lang: Lang) {
  await init(lang)
  const at = lang === 'en' ? 0 : 1
  for (const [cls, c] of Object.entries(sweep.classes)) {
    const base = pickBase(lang, cls)
    if (!base) { noBase[lang].push(cls); continue }
    classResults[lang].set(cls, classProbe(lang, cls, c.class![at], base))
    for (const type of ['explicit', 'implicit'] as const) {
      for (const ix of c[type]) results[lang].set(`${cls}|${type}|${sweep.lines[ix][0]}`, probe(lang, cls, c.class![at], base, type, sweep.lines[ix][at]))
    }
  }
  // 實機樣本(GitHub issue 回報的剪貼簿)走同一條管線,每條詞綴記下第 3 段的結論
  for (const file of fs.readdirSync(path.join(HERE, 'docs')).filter(f => f.startsWith('3.30-issue-') && f.endsWith(`.${lang}.txt`))) {
    const text = fs.readFileSync(path.join(HERE, 'docs', file), 'utf8')
    const klass = text.split(/\r?\n/)[0].replace(/^(Item Class|物品種類): /, '')
    const r = parseClipboard(text)
    // 傳奇樣本對傳奇類別、其他對一般類別
    const unique = r.isOk() && r.value.rarity === 'Unique'
    const cls = Object.keys(sweep.classes).find(k => sweep.classes[k].class?.[at] === klass && !!sweep.classes[k].uniques === unique)
    if (r.isErr()) { samples.push({ file, lang, cls, error: String(r.error) }); continue }
    for (const s of r.value.statsByType) {
      if ((s.type !== 'explicit' && s.type !== 'implicit') || !(s.type in s.stat.trade.ids)) continue
      const p = queryProbeSafe(r.value, new Set([s.stat.ref]), s.type, lang)
      samples.push({ file, lang, cls, type: s.type, ref: s.stat.ref, rarity: r.value.rarity, query: p.query })
    }
  }
}

const samples: Array<{ file: string, lang: Lang, cls?: string, error?: string, type?: ModType, ref?: string, rarity?: string, query?: string }> = []
function queryProbeSafe (item: ParsedItem, refs: Set<string>, type: ModType, lang: Lang): Probe {
  try { return queryProbe(item, refs, type, lang, { parse: [...refs].join(' + ') }) } catch (e) { return { parse: '', query: 'crash', crash: String(e) } }
}

const GAP = new Set(['error', 'unknown', 'dropped'])

/** 鎖定:清單外的新缺口(或同一句變成另一種缺口)= 紅;已修好的要拿掉 */
function expectLocked (file: string, gaps: Record<string, string>) {
  if (process.env.UPDATE_FIXTURES) fs.writeFileSync(file, JSON.stringify(gaps, null, 1) + '\n')
  const known = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>
  expect(Object.entries(gaps).filter(([k, v]) => known[k] !== v)).toEqual([])
  expect(Object.keys(known).filter(k => !(k in gaps))).toEqual([])
}

describe('類型掃描:每類物品會出現的詞綴中英都解析得到、查詢送得出去', () => {
  it('英文', async () => { await run('en'); expect(results.en.size).toBeGreaterThan(1000) })
  it('繁中', async () => { await run('cmn-Hant'); expect(results['cmn-Hant'].size).toBeGreaterThan(1000) })

  it('解析與中英一致:缺口不超出已知清單(只能變少)', () => {
    const gaps: Record<string, string> = {}
    for (const cls of new Set([...noBase.en, ...noBase['cmn-Hant']])) gaps[`${cls}|base`] = `找不到認得的底材:${['en', 'cmn-Hant'].filter(l => noBase[l as Lang].includes(cls)).join(',')}`
    for (const key of [...results.en.keys()].sort()) {
      const en = results.en.get(key)!.parse
      const zh = results['cmn-Hant'].get(key)?.parse
      if (zh === undefined) continue // 那一類繁中沒有底材,已記在上面
      if (GAP.has(en) || GAP.has(zh)) gaps[key] = `en:${GAP.has(en) ? en : 'ok'} zh:${GAP.has(zh) ? zh : 'ok'}`
      else if (en !== zh) gaps[key] = `mismatch en:${en} zh:${zh}`
    }
    expectLocked(GAPS_FILE, gaps)
  })

  it('查詢(第 3–6 段):缺口不超出已知清單(只能變少)', () => {
    const gaps: Record<string, string> = {}
    const report: any[] = []
    for (const key of [...results.en.keys()].sort()) {
      const both = { en: results.en.get(key)!, zh: results['cmn-Hant'].get(key) }
      if (!both.zh) continue
      report.push({ key, ...both })
      for (const [lang, p] of Object.entries(both) as Array<[string, Probe]>) {
        if (GAP.has(p.parse)) continue // 第 1 段的缺口,後面不再算
        if (p.query === 'no-row' || p.query === 'not-sent') gaps[`${key}|query|${lang}`] = p.query
        if (p.query === 'crash') gaps[`${key}|query|${lang}`] = `crash ${p.crash}`
        if (p.badIds) gaps[`${key}|id|${lang}`] = `不在存檔:${p.badIds.join(' ')}`
        if (p.badType) gaps[`${key}|idType|${lang}`] = `來源 ${key.split('|')[1]}、送 ${p.badType.join(' ')}`
      }
      if (!GAP.has(both.en.parse) && !GAP.has(both.zh.parse) && both.en.parse === both.zh.parse && both.en.request !== both.zh.request) {
        gaps[`${key}|same`] = '中英查詢不同'
      }
    }
    for (const cls of classResults.en.keys()) {
      for (const lang of ['en', 'cmn-Hant'] as const) {
        const c = classResults[lang].get(cls)
        if (!c) continue
        if (c.crash) { gaps[`${cls}|category|${lang}`] = `crash ${c.crash}`; continue }
        if (c.category !== undefined && !CATEGORIES.has(c.category)) gaps[`${cls}|category|${lang}`] = `類別不在存檔:${c.category}`
        if (c.type === undefined) gaps[`${cls}|type|${lang}`] = '改查基底後查詢沒有基底名稱'
        else if (!TYPES.has(c.type)) gaps[`${cls}|type|${lang}`] = `基底不在存檔:${c.type}`
      }
      const en = classResults.en.get(cls)!
      const zh = classResults['cmn-Hant'].get(cls)
      if (zh && (en.category !== zh.category || en.type !== zh.type)) gaps[`${cls}|class-same`] = `中英不同 en:${en.category}/${en.type} zh:${zh.category}/${zh.type}`
    }
    // 實機樣本對照:同類別、同來源、解析成同一條詞綴的掃描句子,第 3 段結論要相同(掃描母體沒有的只寫進報告)
    const sampleRows = samples.map(s => {
      if (s.error || !s.cls) return { ...s, sweep: s.error ? 'error' : 'class-not-in-sweep' }
      const seen = [...results[s.lang].entries()].filter(([k, p]) => k.startsWith(`${s.cls}|${s.type}|`) && p.parse.split(' + ').includes(s.ref!)).map(([, p]) => p.query)
      // 掃描組的是稀有(藥劑魔法)或傳奇;稀有度不同(篩選組法不同)就只記下、不比
      const rarityDiffers = s.rarity !== (sweep.classes[s.cls!].uniques ? 'Unique' : s.cls!.endsWith('Flask') ? 'Magic' : 'Rare')
      return { ...s, rarityDiffers, sweep: seen.length ? [...new Set(seen)].sort().join(',') : 'not-in-sweep' }
    })
    for (const s of sampleRows) {
      if (s.error) gaps[`sample|${s.file}`] = `解析失敗 ${s.error}`
      // 樣本被合計吃掉、掃描卻送出:要看底材有沒有那項防禦 / 傷害(掃描挑的傳奇底材不一定有),不算缺口
      else if (!('rarityDiffers' in s && s.rarityDiffers) && !(s.query === 'eaten' && s.sweep === 'sent') &&!['class-not-in-sweep', 'not-in-sweep'].includes(s.sweep) && s.sweep !== s.query) gaps[`sample|${s.file}|${s.type}|${s.ref}`] = `樣本 ${s.query}、掃描 ${s.sweep}`
    }
    if (process.env.SWEEP_REPORT) {
      fs.writeFileSync(process.env.SWEEP_REPORT, JSON.stringify({
        samples: sampleRows,
        lines: report, classes: Object.fromEntries([...classResults.en.keys()].map(c => [c, { en: classResults.en.get(c), zh: classResults['cmn-Hant'].get(c) }]))
      }))
    }
    expectLocked(QUERY_GAPS_FILE, gaps)
  })
})
