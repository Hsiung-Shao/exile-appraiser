import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { setupTests } from './vitest.setup'
import { createPresets, createTradeRequest, apiToSatisfySearch, webSearchUrl, searchUrl, fetchUrl, exchangeUrl } from '../src/index'
import { REALMS, type Realm } from '@exile-appraiser/core/realm'
import { listFixtures, runFixture, FIXTURES_DIR, UPDATE_MODE, type Fixture } from './zhTW/helpers/fixture-harness'

/**
 * Realm 層的黃金查詢(golden query),抄 poe1/test/golden-query.test.ts,換成 PoE2 路徑。
 *
 * 同一件繁中物品(E 的 zhTW 回歸網 fixture),對國際服要送英文名、對台服要送繁中名,而詞綴 id 兩邊
 * 必須一模一樣 —— 「語言無關鍵對接、禁止位置對位」的落地。每個 fixture 產生兩份快照
 * `test/golden-query/<name>.{intl,tw}.json`(不寫進 E 的 fixtures 目錄,那裡保持逐位元組),
 * 並額外斷言下列不變式(快照只是輔助,不變式才是規格):
 *
 * 1. intl 的 `query.name` / `query.type` 全是 ASCII(即 `refName`);tw 的至少一個含 CJK(或語言無關 id)。
 * 2. 兩個 realm 的 `stats[].filters[].id` 多重集合完全相同。
 * 3. 兩個 realm 除了 name/type 之外的 query 結構相同。
 * 4. API 端點是 `/api/trade2/*`、網頁是 `/trade2/search/poe2/{league}`,落在正確的 host;`?q=` 必須 URL-encode。
 *
 * 更新快照:`UPDATE_FIXTURES=1 npm test`,產出必須人工 review 後才可 commit。
 */
const LANG = 'cmn-Hant' as const
const LEAGUE = 'Runes of Aldur'
const LEAGUE_ENC = encodeURIComponent(LEAGUE)
const CJK = /[㐀-鿿]/
const SNAP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'golden-query')

function opts (realm: Realm) {
  return {
    league: LEAGUE, realm, clientLanguage: LANG, searchStatRange: 10,
    currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
  }
}

function statIds (request: any): string[] {
  return (request.query.stats as any[])
    .flatMap(g => g.filters.map((f: any) => f.id))
    .sort()
}

function nameAndType (request: any): string[] {
  const out: string[] = []
  for (const v of [request.query.name, request.query.type]) {
    if (typeof v === 'string') out.push(v)
    else if (v && typeof v === 'object' && 'option' in v) out.push(String(v.option))
  }
  return out
}

function stripNames (request: any) {
  const clone = JSON.parse(JSON.stringify(request))
  delete clone.query.name
  delete clone.query.type
  return clone
}

let fixtures: Fixture[] = []
beforeAll(async () => {
  setupTests({ language: LANG })
  await init(LANG)
  fixtures = await listFixtures(LANG)
  fs.mkdirSync(SNAP_DIR, { recursive: true })
})

describe('realm golden query(PoE2 cmn-Hant 剪貼簿 → intl / tw 兩份查詢)', () => {
  it('有 fixture 可跑', async () => {
    expect((await listFixtures(LANG)).length).toBeGreaterThan(0)
  })

  it('端點與網頁路徑是 trade2', () => {
    for (const realm of ['intl', 'tw'] as Realm[]) {
      const host = REALMS[realm].host
      expect(searchUrl({ realm }, LEAGUE)).toBe(`https://${host}/api/trade2/search/${LEAGUE_ENC}`)
      expect(fetchUrl({ realm }, ['a', 'b'], 'Q')).toBe(`https://${host}/api/trade2/fetch/a,b?query=Q`)
      expect(exchangeUrl({ realm }, LEAGUE)).toBe(`https://${host}/api/trade2/exchange/${LEAGUE_ENC}`)
      expect(webSearchUrl(realm, LEAGUE, {} as any, 'abc')).toBe(`https://${host}/trade2/search/poe2/${LEAGUE_ENC}/abc`)
    }
    // 台服聯盟 id 是繁中:路徑段必須 encode
    expect(searchUrl({ realm: 'tw' }, '阿德爾的符文')).toBe(`https://pathofexile.tw/api/trade2/search/${encodeURIComponent('阿德爾的符文')}`)
  })

  it.each(fs.readdirSync(path.join(FIXTURES_DIR, LANG)).filter(f => f.endsWith('.txt')).map(f => f.replace(/\.txt$/, '')))(
    '%s', async (name) => {
      const fixture = fixtures.find(f => f.name === name)!
      const outcome = runFixture(fixture)
      if (outcome.kind !== 'parsed') {
        // 解析失敗的樣本由 zhTW/parser-fixtures 那層負責;這裡不重複紅
        return
      }
      const item = outcome.item

      const byRealm = {} as Record<Realm, { request: any, api: string }>
      for (const realm of ['intl', 'tw'] as Realm[]) {
        const { presets, active } = createPresets(item, opts(realm))
        const preset = presets.find(p => p.id === active) ?? presets[0]
        const request = createTradeRequest(preset, item)
        byRealm[realm] = { request, api: apiToSatisfySearch(item, preset) }

        // 網頁網址落在正確 host / 路徑,且 ?q= 有 encode、可還原
        const url = webSearchUrl(realm, LEAGUE, request)
        expect(url.startsWith(`https://${REALMS[realm].host}/trade2/search/poe2/${LEAGUE_ENC}?q=`)).toBe(true)
        expect(url).not.toMatch(/[{}"\s]/)
        expect(JSON.parse(decodeURIComponent(url.split('?q=')[1]))).toEqual(request)

        // 快照
        const snapPath = path.join(SNAP_DIR, `${name}.${realm}.json`)
        const snapshot = JSON.stringify({ api: byRealm[realm].api, request }, null, 2) + '\n'
        if (UPDATE_MODE || !fs.existsSync(snapPath)) {
          fs.writeFileSync(snapPath, snapshot)
        } else {
          expect(snapshot, `快照不符:${path.basename(snapPath)}(確認後 UPDATE_FIXTURES=1 更新)`).toBe(fs.readFileSync(snapPath, 'utf8'))
        }
      }

      const intl = byRealm.intl.request
      const tw = byRealm.tw.request

      // 1. 名稱語言
      for (const n of nameAndType(intl)) expect(n, `intl 名稱應為英文:${n}`).not.toMatch(CJK)
      const twNames = nameAndType(tw)
      if (twNames.length) {
        const anyCjk = twNames.some(n => CJK.test(n))
        const identical = twNames.join('|') === nameAndType(intl).join('|')
        expect(anyCjk || identical, `tw 名稱應為繁中或語言無關 id:${twNames.join(' / ')}`).toBe(true)
      }
      // 2. stat id 多重集合相同
      expect(statIds(tw)).toEqual(statIds(intl))
      // 3. 其餘結構相同
      expect(stripNames(tw)).toEqual(stripNames(intl))
      // 沒有 undefined 的 id
      expect(statIds(intl).every(id => typeof id === 'string' && id.length > 0)).toBe(true)
    })
})
