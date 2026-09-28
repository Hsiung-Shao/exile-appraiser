import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { createPresets, createTradeRequest, apiToSatisfySearch, webSearchUrl, searchUrl } from '../src/index'
import { REALMS, type Realm } from '@exile-appraiser/core/realm'
import { listFixtures, runFixture, FIXTURES_DIR, UPDATE_MODE, type Fixture } from './helpers/fixture-harness'

/**
 * Realm 層的黃金查詢(golden query)。
 *
 * 同一件繁中物品,對國際服要送英文名、對台服要送繁中名,而詞綴 id 兩邊必須一模一樣 ——
 * 這是「語言無關鍵對接、禁止位置對位」的落地。每個 fixture 產生兩份快照
 * `<name>.query.intl.json` / `<name>.query.tw.json`,並額外斷言下列不變式(快照只是輔助,
 * 不變式才是規格):
 *
 * 1. intl 的 `query.name` / `query.type` 全是 ASCII(即 `refName`);tw 的至少一個含 CJK。
 * 2. 兩個 realm 的 `stats[].filters[].id` 多重集合完全相同。
 * 3. 兩個 realm 除了 name/type 之外的 query 結構相同(filters、stats 的 min/max 都一樣)。
 * 4. API 端點與網頁網址落在正確的 host;網頁 `?q=` 必須 URL-encode。
 *
 * 更新快照:`UPDATE_FIXTURES=1 npm test`,產出必須人工 review 後才可 commit。
 */
const LANG = 'cmn-Hant' as const
const LEAGUE = 'Standard'
const CJK = /[㐀-鿿]/

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
  await init(LANG)
  fixtures = await listFixtures(LANG)
})

describe('realm golden query(cmn-Hant 剪貼簿 → intl / tw 兩份查詢)', () => {
  it('有 fixture 可跑', async () => {
    expect((await listFixtures(LANG)).length).toBeGreaterThan(0)
  })

  it.each(fs.readdirSync(path.join(FIXTURES_DIR, LANG)).filter(f => f.endsWith('.txt')).map(f => f.replace(/\.txt$/, '')))(
    '%s', async (name) => {
      const fixture = fixtures.find(f => f.name === name)!
      const outcome = await runFixture(fixture)
      if (outcome.kind !== 'parsed') {
        // 解析失敗的樣本由 parser-fixtures 那層負責;這裡不重複紅
        return
      }
      const item = outcome.item

      const byRealm = {} as Record<Realm, { request: any, api: string }>
      for (const realm of ['intl', 'tw'] as Realm[]) {
        const { presets, active } = createPresets(item, opts(realm))
        const preset = presets.find(p => p.id === active) ?? presets[0]
        const request = createTradeRequest(preset)
        byRealm[realm] = { request, api: apiToSatisfySearch(item, preset) }

        // 端點與網址落在正確 host,且 ?q= 有 encode
        expect(searchUrl({ realm }, LEAGUE)).toBe(`https://${REALMS[realm].host}/api/trade/search/${LEAGUE}`)
        const url = webSearchUrl(realm, LEAGUE, request)
        expect(url.startsWith(`https://${REALMS[realm].host}/trade/search/${LEAGUE}?q=`)).toBe(true)
        expect(url).not.toMatch(/[{}"\s]/)
        expect(JSON.parse(decodeURIComponent(url.split('?q=')[1]))).toEqual(request)

        // 快照
        const snapPath = path.join(FIXTURES_DIR, LANG, `${name}.query.${realm}.json`)
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
        // 有些物品(如傭兵流派變體)送的是語言無關內部 id,兩邊都是 ASCII,屬合法
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
