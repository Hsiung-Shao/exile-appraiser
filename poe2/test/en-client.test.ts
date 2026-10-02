import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { ModifierType } from '@/parser/modifiers'
import { setupTests } from './vitest.setup'
import { createPresets, createTradeRequest, apiToSatisfySearch, webSearchUrl, searchUrl } from '../src/index'
import { REALMS, isSupportedCombination } from '@exile-appraiser/core/realm'
import { FIXTURES_DIR, UPDATE_MODE } from './zhTW/helpers/fixture-harness'

/**
 * 英文客戶端回歸(第 23 步):PoE2 英文 Ctrl+Alt+C(進階)/ Ctrl+C 複製文字 → 解析 → 預設篩選器 → 國際服交易查詢。
 *
 * 英文客戶端只走國際服(`intl`);台服 + 英文客戶端不是支援組合(`isSupportedCombination`)。
 *
 * fixture 來源(`zhTW/fixtures/en/`):
 * - `tablet-delirium-magic-01`:本 repo `Parser/fixtures/delirium-tablet-magic.en.txt`(依 GGPK 組的英文,見 auspex-and-magic-tablet.test.ts 檔頭)。
 * - `waystone-rare-01`:上游 ee2-patched `renderer/specs/Parser/items.ts` 的 `RareMap`(MIT);
 *   唯一改動:`+26(26-30)% to Monster Critical Damage Bonus` 改成 `Monsters have +26(26-30)% Critical Damage Bonus`
 *   (上游舊措辭,本專案 en 資料的現行詞綴是後者)。
 * - 與 `zhTW/fixtures/cmn-Hant/` 同名成對的檔(boots / helmet / wand / spear / amulet / ring / jewel-unique):
 *   依同一件物品的繁中進階複製 + en 資料(`data/poe2/en/stats.ndjson` 的 ref / matcher)手寫的英文版。
 *   物品名 / 基底 / 詞綴文字取自 en 資料;稀有物品的自由名稱與詞綴階層名(Cheetah 等)是占位
 *   (parser 只用 Tier 數字與詞綴文字,不用名稱)。
 * - `currency-01`、`gem-skill-01`、`jewel-rare-01`:英文獨有。
 *
 * 不變式:
 * 1. 全部能解析且沒有認不出的詞綴;intl 查詢的 name / type 全是 ASCII;
 * 2. 與繁中成對的物品,同一件物品中英兩種複製文字產生完全相同的 trade query,且詞綴階層 / 類型逐條相同;
 * 3. 英文進階複製的褻瀆詞綴 Tier 是遊戲給的;轉成英文一般複製(` (desecrated)` 行尾)後,推定 Tier 等於遊戲給的。
 *
 * 更新快照:`UPDATE_FIXTURES=1 npm test`,產出必須人工 review 後才可 commit。
 */
const LEAGUE = 'Runes of Aldur'
const LEAGUE_ENC = encodeURIComponent(LEAGUE)
const CJK = /[㐀-鿿]/
const HERE = path.dirname(fileURLToPath(import.meta.url))
const EN_DIR = path.join(FIXTURES_DIR, 'en')
const ZH_DIR = path.join(FIXTURES_DIR, 'cmn-Hant')
const SNAP_DIR = path.join(HERE, 'golden-query')

type Lang = 'en' | 'cmn-Hant'

function opts (clientLanguage: Lang) {
  return {
    league: LEAGUE, realm: 'intl' as const, clientLanguage, searchStatRange: 10,
    currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
  }
}

function parse (text: string, label: string): ParsedItem {
  const r = parseClipboard(text)
  if (r.isErr()) throw new Error(`${label} 解析失敗:${r.error}`)
  return r.value
}

function build (text: string, label: string, lang: Lang) {
  const item = parse(text, label)
  const { presets, active } = createPresets(item, opts(lang))
  const preset = presets.find(p => p.id === active) ?? presets[0]
  const request = createTradeRequest(preset, item)
  return { item, request, api: apiToSatisfySearch(item, preset) }
}

function nameAndType (request: any): string[] {
  const out: string[] = []
  for (const v of [request.query.name, request.query.type]) {
    if (typeof v === 'string') out.push(v)
    else if (v && typeof v === 'object' && 'option' in v) out.push(String(v.option))
  }
  return out
}

/** 進階複製 → 英文一般複製:去 `{…}` 標頭、去數值後 `(lo-hi)`、依標頭補行尾旗標 */
function toPlainFormat (text: string): string {
  const out: string[] = []
  let suffix = ''
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('{') && line.endsWith('}')) {
      suffix = line.includes('Desecrated')
        ? ' (desecrated)'
        : line.includes('Fractured')
          ? ' (fractured)'
          : line.includes('Enhancement')
            ? ' (enchant)'
            : line.includes('Implicit Modifier')
              ? ' (implicit)'
              : ''
      continue
    }
    if (line === '--------') suffix = ''
    const stripped = line.replace(/(\d+(?:\.\d+)?)\([^)]*\)/g, '$1')
    out.push(suffix && stripped ? stripped + suffix : stripped)
  }
  return out.join('\n')
}

const read = (dir: string, name: string) => fs.readFileSync(path.join(dir, `${name}.txt`), 'utf8')
const enNames = fs.readdirSync(EN_DIR).filter(f => f.endsWith('.txt')).map(f => f.replace(/\.txt$/, '')).sort()
const PAIRS = enNames.filter(n => fs.existsSync(path.join(ZH_DIR, `${n}.txt`)))
const TABLET_ZH = path.join(HERE, 'Parser/fixtures/delirium-tablet-magic.zh.txt')

const en = new Map<string, ReturnType<typeof build>>()
const zh = new Map<string, ReturnType<typeof build>>()
let tabletZh: ReturnType<typeof build>
const DESEC = ['boots-rare-luxurious-slippers-01', 'helmet-rare-kamasan-tiara-01', 'wand-rare-dueling-wand-01']
const enPlain = new Map<string, ParsedItem>()

beforeAll(async () => {
  setupTests({ language: 'en' })
  await init('en')
  for (const n of enNames) en.set(n, build(read(EN_DIR, n), `en/${n}`, 'en'))
  // 解析要在對應語系的資料載入時做(assets/data 是模組層級全域)
  for (const n of DESEC) enPlain.set(n, parse(toPlainFormat(read(EN_DIR, n)), `${n}(plain)`))
  setupTests({ language: 'cmn-Hant' })
  await init('cmn-Hant')
  for (const n of PAIRS) zh.set(n, build(read(ZH_DIR, n), `cmn-Hant/${n}`, 'cmn-Hant'))
  tabletZh = build(fs.readFileSync(TABLET_ZH, 'utf8'), 'delirium-tablet-magic.zh', 'cmn-Hant')
  fs.mkdirSync(SNAP_DIR, { recursive: true })
}, 180_000)

describe('PoE2 英文客戶端(en 剪貼簿 → intl 查詢)', () => {
  it('台服 + 英文客戶端不是支援的組合(英文客戶端只走國際服)', () => {
    expect(isSupportedCombination('tw', 'en')).toBe(false)
    expect(isSupportedCombination('intl', 'en')).toBe(true)
  })

  it('涵蓋類別:傳奇 / 稀有裝備 / 通貨 / 技能寶石 / Waystone / 碑牌 / 珠寶,詞綴類型含 fractured / crafted / desecrated', () => {
    const cats = new Set([...en.values()].map(b => `${b.item.rarity ?? '-'}/${b.item.category ?? '-'}`))
    for (const want of ['Unique/Amulet', 'Unique/Ring', 'Unique/Jewel', 'Rare/Wand', 'Rare/Helmet', 'Rare/Boots', 'Rare/Spear', 'Rare/Jewel', 'Rare/Map', 'Magic/TowerAugment', '-/Currency', '-/Gem']) {
      expect(cats.has(want), `缺 ${want}:${[...cats].join(', ')}`).toBe(true)
    }
    const types = new Set([...en.values()].flatMap(b => b.item.newMods.map(m => m.info.type)))
    for (const t of ['implicit', 'explicit', 'crafted', 'fractured', 'desecrated', 'enchant', 'rune']) {
      expect(types.has(t as ModifierType), `缺詞綴類型 ${t}`).toBe(true)
    }
  })

  it('有成對的繁中 fixture 可比對', () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(7)
  })

  it.each(enNames)('%s', (name) => {
    const { item, request, api } = en.get(name)!
    expect(item.unknownModifiers, `${name} 有認不出的詞綴`).toEqual([])
    expect(searchUrl({ realm: 'intl' }, LEAGUE)).toBe(`https://${REALMS.intl.host}/api/trade2/search/${LEAGUE_ENC}`)
    const url = webSearchUrl('intl', LEAGUE, request)
    expect(url.startsWith(`https://${REALMS.intl.host}/trade2/search/poe2/${LEAGUE_ENC}?q=`)).toBe(true)
    expect(url).not.toMatch(/[{}"\s]/)
    expect(JSON.parse(decodeURIComponent(url.split('?q=')[1]))).toEqual(request)

    const snapPath = path.join(SNAP_DIR, `en-${name}.intl.json`)
    const snapshot = JSON.stringify({ api, request }, null, 2) + '\n'
    if (UPDATE_MODE || !fs.existsSync(snapPath)) fs.writeFileSync(snapPath, snapshot)
    else expect(snapshot, `快照不符:${path.basename(snapPath)}(確認後 UPDATE_FIXTURES=1 更新)`).toBe(fs.readFileSync(snapPath, 'utf8'))

    for (const n of nameAndType(request)) expect(n, `intl 名稱應為 ASCII:${n}`).not.toMatch(CJK)
    const ids = ((request.query.stats ?? []) as any[]).flatMap(g => g.filters.map((f: any) => f.id))
    expect(ids.every((id: unknown) => typeof id === 'string' && (id as string).length > 0)).toBe(true)
    expect(item.info.refName).not.toMatch(CJK)
  })

  describe('中英成對:同一件物品兩種語言的複製文字 → 同一份 trade query', () => {
    const modSig = (item: ParsedItem) => item.newMods.map(m => ({
      type: m.info.type, generation: m.info.generation, tier: m.info.tier,
      stats: m.stats.map(s => `${s.stat.ref}=${s.roll?.value}[${s.roll?.min},${s.roll?.max}]`)
    }))

    it.each(PAIRS)('%s', (name) => {
      const a = en.get(name)!
      const b = zh.get(name)!
      expect(a.request).toEqual(b.request)
      expect(a.api).toBe(b.api)
      expect(a.item.info.refName).toBe(b.item.info.refName)
      expect(modSig(a.item)).toEqual(modSig(b.item))
    })

    // 碑牌「增加#%經驗獲得」:en 資料把 `… Experience gain in Map` 併在泛稱 `… Experience gain`(兩個 trade id)底下,
    // zh 資料有獨立的 `in Map` 條目(單一 id)。所以英文端多放一個泛稱 id 在 `count`(任一)群組裡 ——
    // 召回更廣、含對的那個,不是缺口。其餘(類型、其他詞綴、數值)逐項相同,繁中的每個 id 英文都有。
    it('tablet-delirium-magic-01(繁中版在 Parser/fixtures;英文多一個泛稱經驗 id,其餘相同)', () => {
      const a = en.get('tablet-delirium-magic-01')!
      expect(a.item.info.refName).toBe(tabletZh.item.info.refName)
      expect(a.request.query.type).toEqual(tabletZh.request.query.type)
      expect(a.request.query.filters).toEqual(tabletZh.request.query.filters)
      const ids = (r: any) => (r.query.stats as any[]).flatMap(g => g.filters.map((f: any) => f.id)).sort()
      const enIds = ids(a.request)
      const zhIds = ids(tabletZh.request)
      expect(zhIds.every(id => enIds.includes(id))).toBe(true)
      expect(enIds.filter(id => !zhIds.includes(id))).toEqual(['explicit.stat_3666934677'])
      expect(zhIds).toContain('explicit.stat_57434274')
    })
  })

  describe('褻瀆詞綴 Tier(英文進階複製 vs 英文一般複製)', () => {
    const desecrated = (item: ParsedItem) => item.newMods.filter(m => m.info.type === ModifierType.Desecrated)
    const key = (m: ParsedItem['newMods'][number]) => m.stats.map(s => s.stat.ref).join(' + ')

    it.each(DESEC)('%s', (name) => {
      const text = read(EN_DIR, name)
      const advanced = en.get(name)!.item
      const truth = desecrated(advanced)
      expect(truth.length).toBeGreaterThan(0)
      for (const m of truth) {
        // 進階複製:遊戲自帶 Tier,推定不得動它
        expect(m.info.tier, key(m)).toBeTypeOf('number')
        expect(m.info.tierInferred, key(m)).toBeUndefined()
      }
      // 進階格式的 Tier 與繁中進階複製相同
      const zhTruth = desecrated(zh.get(name)!.item)
      expect(truth.map(m => [key(m), m.info.tier])).toEqual(zhTruth.map(m => [key(m), m.info.tier]))

      const plainText = toPlainFormat(text)
      expect(plainText).not.toMatch(/\{/)
      expect(plainText).toMatch(/ \(desecrated\)$/m)
      const plain = enPlain.get(name)!
      const got = desecrated(plain)
      expect(got.map(key).sort()).toEqual(truth.map(key).sort())
      for (const m of truth) {
        const p = got.find(g => key(g) === key(m))!
        expect({ tier: p.info.tier, inferred: p.info.tierInferred, candidates: p.info.tierCandidates }, `${name}: ${key(m)}`)
          .toEqual({ tier: m.info.tier, inferred: true, candidates: undefined })
      }
      expect(plain.unknownModifiers).toEqual([])
    })
  })
})
