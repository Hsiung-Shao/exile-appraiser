import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { createPresets, createTradeRequest, apiToSatisfySearch, webSearchUrl, searchUrl } from '../src/index'
import { REALMS, isSupportedCombination } from '@exile-appraiser/core/realm'
import { listFixtures, runFixture, FIXTURES_DIR, UPDATE_MODE, type Fixture } from './helpers/fixture-harness'

/**
 * 英文客戶端回歸(第 23 步):PoE1 英文 Ctrl+C 複製文字 → 解析 → 預設篩選器 → 國際服交易查詢。
 *
 * 英文客戶端只走國際服(`intl`);台服 + 英文客戶端是不支援的組合(`isSupportedCombination`)。
 *
 * fixture 來源(`fixtures/en/`):
 * - `blood-filled-vessel-01`:上游 apt-patched `renderer/test/fixtures/en/` 逐字(MIT)。
 * - 其餘與 `fixtures/cmn-Hant/` **同名成對**的檔:依同一件物品的繁中 fixture 與本專案 en 資料
 *   (`data/poe1/en/stats.ndjson` 的 ref、`client_strings.js` 的標頭 / 區段字串)手寫的英文版。
 *   物品名 / 基底 / 詞綴文字取自 en 資料(Sundance、Clasped Boots、Coursing Current Support 等);
 *   **稀有地圖 / 傭兵名等自由命名的欄位是占位**(parser 不使用,不代表遊戲真有這個名字)。
 * - `ring-rare-01`、`currency-01`、`jewel-rare-01`:英文獨有(沒有繁中對應檔),補稀有裝備(implicit / explicit /
 *   fractured / crafted)、可堆疊通貨、珠寶三類。
 *
 * 不變式(快照只是輔助):
 * 1. 全部能解析,intl 查詢的 name / type 全是 ASCII,stat id 都有值;
 * 2. 與繁中成對的物品,**同一件物品中英兩種複製文字產生完全相同的 trade query**(語言無關鍵對接);
 * 3. 網頁網址落在 intl host、`?q=` 有 encode 且可還原。
 *
 * ⚠ 兩個語系的資料集不能同時載入(`assets/data` 是模組層級全域),所以先跑完 en 再切 cmn-Hant。
 * 更新快照:`UPDATE_FIXTURES=1 npm test`,產出必須人工 review 後才可 commit。
 */
const LEAGUE = 'Standard'
const CJK = /[㐀-鿿]/
const EN_DIR = path.join(FIXTURES_DIR, 'en')

function opts (clientLanguage: 'en' | 'cmn-Hant') {
  return {
    league: LEAGUE, realm: 'intl' as const, clientLanguage, searchStatRange: 10,
    currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
  }
}

function build (fixture: Fixture, lang: 'en' | 'cmn-Hant') {
  const outcome = runFixture(fixture)
  if (outcome.kind !== 'parsed') throw new Error(`${lang}/${fixture.name} 解析失敗:${outcome.error}`)
  const item = outcome.item
  const { presets, active } = createPresets(item, opts(lang))
  const preset = presets.find(p => p.id === active) ?? presets[0]
  const request = createTradeRequest(preset)
  return { item, request, api: apiToSatisfySearch(item, preset) }
}

function statIds (request: any): string[] {
  return (request.query.stats as any[]).flatMap(g => g.filters.map((f: any) => f.id)).sort()
}
function nameAndType (request: any): string[] {
  const out: string[] = []
  for (const v of [request.query.name, request.query.type]) {
    if (typeof v === 'string') out.push(v)
    else if (v && typeof v === 'object' && 'option' in v) out.push(String(v.option))
  }
  return out
}

const enBuilt = new Map<string, ReturnType<typeof build>>()
const zhBuilt = new Map<string, ReturnType<typeof build>>()
let enFixtures: Fixture[] = []
let pairs: string[] = []

beforeAll(async () => {
  await init('en')
  enFixtures = await listFixtures('en')
  for (const f of enFixtures) enBuilt.set(f.name, build(f, 'en'))
  await loadForLang('cmn-Hant')
  const zhFixtures = await listFixtures('cmn-Hant')
  pairs = enFixtures.map(f => f.name).filter(n => zhFixtures.some(z => z.name === n))
  for (const z of zhFixtures) if (pairs.includes(z.name)) zhBuilt.set(z.name, build(z, 'cmn-Hant'))
}, 180_000)

describe('PoE1 英文客戶端(en 剪貼簿 → intl 查詢)', () => {
  it('台服 + 英文客戶端不是支援的組合(英文客戶端只走國際服)', () => {
    expect(isSupportedCombination('tw', 'en')).toBe(false)
    expect(isSupportedCombination('intl', 'en')).toBe(true)
  })

  it('涵蓋類別:傳奇 / 稀有裝備 / 通貨 / 寶石 / 地圖 / 珠寶 / 傭兵契約書 / 最後通牒', () => {
    const cats = new Set([...enBuilt.values()].map(b => `${b.item.rarity ?? '-'}/${b.item.category ?? '-'}`))
    for (const want of ['Unique/Boots', 'Rare/Ring', 'Rare/Jewel', 'Rare/Map', '-/Currency', '-/Gem']) {
      expect(cats.has(want), `缺 ${want}:${[...cats].join(', ')}`).toBe(true)
    }
    expect(enBuilt.has('mercenary-warrant-01')).toBe(true)
    expect(enBuilt.has('ultimatum-01')).toBe(true)
  })

  it('ring-rare-01 帶 implicit / fractured / crafted / explicit 四種詞綴', () => {
    const types = new Set((enBuilt.get('ring-rare-01')!.item.newMods ?? []).map((m: any) => m.info.type))
    for (const t of ['implicit', 'fractured', 'crafted', 'explicit']) expect(types.has(t), `缺 ${t}:${[...types].join(',')}`).toBe(true)
  })

  it('有成對的繁中 fixture 可比對', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(6)
  })

  it('en 解析認不出的詞綴與繁中一致(已知資料缺口不得變多)', () => {
    for (const name of pairs) {
      const en = enBuilt.get(name)!.item.unknownModifiers.length
      const zh = zhBuilt.get(name)!.item.unknownModifiers.length
      expect(en, `${name} 英文認不出的詞綴數(zh=${zh})`).toBe(zh)
    }
    // 英文獨有的三件必須全部認得
    for (const name of ['ring-rare-01', 'currency-01', 'jewel-rare-01']) {
      expect(enBuilt.get(name)!.item.unknownModifiers, name).toEqual([])
    }
  })

  it.each(fs.readdirSync(EN_DIR).filter(f => f.endsWith('.txt')).map(f => f.replace(/\.txt$/, '')))('%s', (name) => {
    const { item, request, api } = enBuilt.get(name)!
    const url = webSearchUrl('intl', LEAGUE, request)
    expect(searchUrl({ realm: 'intl' }, LEAGUE)).toBe(`https://${REALMS.intl.host}/api/trade/search/${LEAGUE}`)
    expect(url).not.toMatch(/[{}"\s]/)
    expect(JSON.parse(decodeURIComponent(url.split('?q=')[1]))).toEqual(request)

    const snapPath = path.join(EN_DIR, `${name}.query.intl.json`)
    const snapshot = JSON.stringify({ api, request }, null, 2) + '\n'
    if (UPDATE_MODE || !fs.existsSync(snapPath)) fs.writeFileSync(snapPath, snapshot)
    else expect(snapshot, `快照不符:${path.basename(snapPath)}(確認後 UPDATE_FIXTURES=1 更新)`).toBe(fs.readFileSync(snapPath, 'utf8'))

    for (const n of nameAndType(request)) expect(n, `intl 名稱應為 ASCII:${n}`).not.toMatch(CJK)
    expect(statIds(request).every(id => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(item.info.refName).not.toMatch(CJK)
  })

  describe('中英成對:同一件物品兩種語言的複製文字 → 同一份 trade query', () => {
    it.each(['boots-unique-vestigial-01', 'boots-unique-vestigial-02', 'gem-support-01', 'map-blighted-rare-01', 'mercenary-warrant-01', 'ultimatum-01', 'blood-filled-vessel-01'])(
      '%s', (name) => {
        const en = enBuilt.get(name)
        const zh = zhBuilt.get(name)
        expect(en, `缺英文 fixture ${name}`).toBeDefined()
        expect(zh, `缺繁中 fixture ${name}`).toBeDefined()
        expect(en!.request).toEqual(zh!.request)
        expect(en!.api).toBe(zh!.api)
        expect(en!.item.info.refName).toBe(zh!.item.info.refName)
      })

    // 繁中「怪物擊中時獲得 1 顆耐力球」同時對得上兩條英文詞綴(`… on Hit` 與 `… when hit`,zh 字串相同),
    // 所以繁中端本來就會把它們放進一個 `count`(任一)群組;英文端是明確的單一詞綴。
    // 這是 zh 資料的歧義、不是英文的缺口:除了這一組,其餘 query 必須逐項相同,且英文的 id 必在繁中群組裡。
    it('map-rare-01(繁中有一條歧義詞綴 → 繁中是 count 群組,英文是單一詞綴)', () => {
      const en = enBuilt.get('map-rare-01')!.request
      const zh = zhBuilt.get('map-rare-01')!.request
      const zhCount = zh.query.stats.find((g: any) => g.type === 'count')
      expect(zhCount!.filters.map((f: any) => f.id)).toContain('explicit.stat_687813731')
      const enFlat = new Set(en.query.stats.flatMap((g: any) => g.filters.map((f: any) => f.id)))
      expect(enFlat.has('explicit.stat_687813731')).toBe(true)
      const zhAnd = zh.query.stats.find((g: any) => g.type === 'and')!.filters.map((f: any) => f.id)
      expect(zhAnd.every((id: string) => enFlat.has(id))).toBe(true)
      expect(zhAnd.length).toBe(enFlat.size - 1)
      expect(en.query.type).toEqual(zh.query.type)
      expect(en.query.status).toEqual(zh.query.status)
    })
  })
})
