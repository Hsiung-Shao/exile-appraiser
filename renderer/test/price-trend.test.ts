// 第 24 步:查價面板「通貨價格區」(PoE1 / PoE2 PriceTrend.vue、StackValue.vue)的純邏輯與接線守門。
// 價格一律來自錄製的 poe.ninja 回應(core/test/recordings/ninja/),不打網路;畫面另以無頭瀏覽器 + 假 host 截圖驗。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  autoCurrencyFor, createNinjaClient, lookupPrice, ninjaDetailsUrl, toSnapshot, type NinjaQuery, type NinjaSnapshot
} from '@exile-appraiser/core/ninja'
import type { HttpFetch, HttpResponse } from '@exile-appraiser/core/http'
import {
  coreCurrencyIcon, priceHitFields, sparklineGeometry, toPoe2Entry, volumeParts
} from '../src/web/background/price-trend'
import { createPoe2PriceSource, type Poe2NinjaLike } from '../src/web/background/poe2-price-source'
import { CURRENCY_VOLUME_OPTIONS, hasCurrencyVolume } from '../src/web/settings/tabs/price-check-options'
import { defaultPriceCheck } from '../src/web/Config'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const REC = 'core/test/recordings/ninja'

function response (body: string): HttpResponse {
  return { ok: true, status: 200, headers: new Headers(), json: async () => JSON.parse(body), text: async () => body }
}
/** 錄製檔當 poe.ninja;沒錄的類別 404 */
function recHttp (dir: string): HttpFetch {
  return async (url) => {
    const u = new URL(url)
    const kind = u.pathname.includes('/exchange/') ? 'exchange' : 'item'
    const file = path.join(root, dir, kind + '_' + u.searchParams.get('type') + '.json')
    if (!fs.existsSync(file)) return { ...response('not found'), ok: false, status: 404 }
    return response(fs.readFileSync(file, 'utf8'))
  }
}
async function snapshotOf (game: 'poe1' | 'poe2'): Promise<NinjaSnapshot> {
  const client = createNinjaClient({
    http: recHttp(game === 'poe1' ? REC : REC + '/poe2'), game, league: game === 'poe1' ? 'Allflame' : 'Forbidden Rites', sleep: async () => {}, now: () => 1
  })
  return toSnapshot(await client.fetchAll(game === 'poe1' ? undefined : { exchange: ['Currency', 'Runes', 'SoulCores'], item: [] }))
}

/** renderer Prices.ts findPriceByQuery 的同一套組法(Vue 以外的部分) */
function hitOf (snap: NinjaSnapshot, q: NinjaQuery) {
  const hit = lookupPrice(snap, q)
  if (!hit) return null
  return {
    chaos: hit.entry.c, url: ninjaDetailsUrl(snap.game, snap.league, hit, q), count: hit.entry.n,
    lowConfidence: hit.entry.lc, detailsId: hit.entry.id ?? '', ...priceHitFields(hit.key, hit.entry)
  }
}

describe('priceHitFields(快照命中 → 走勢 / 成交量欄位)', () => {
  it('PoE1 Divine Orb:exchange、7 點走勢、每小時成交量(chaos)、成交量最大 = chaos', async () => {
    const snap = await snapshotOf('poe1')
    const hit = hitOf(snap, { ns: 'ITEM', name: 'Divine Orb' })!
    expect(hit).toMatchObject({
      chaos: 371.7, exchange: true, volumeChaos: 1450816, maxVolumeCurrency: 'chaos', graphChange: 1.02,
      graph: [0.22, -0.15, -0.83, 0.05, 0.9, 3.98, 1.02]
    })
    // 命運卡也是 exchange 類
    expect(hitOf(snap, { ns: 'DIVINATION_CARD', name: 'Arrogance of the Vaal' })).toMatchObject({ exchange: true, volumeChaos: 2.83 })
  })
  it('PoE1 傳奇(item overview):不是 exchange、沒有成交量(通貨價格區不顯示)', async () => {
    const snap = await snapshotOf('poe1')
    const hit = hitOf(snap, { ns: 'UNIQUE', name: 'Sundance', baseType: 'Clasped Boots' })!
    expect(hit.exchange).toBe(false)
    expect(hit.volumeChaos).toBeUndefined()
    expect(hit.graph).toEqual([0, -27, -26, -35, 0, 0, 0])
  })
  it('快照沒有走勢 → graph []', () => {
    expect(priceHitFields('currency|X', { c: 1, n: 0, lc: false, t: 'Currency' })).toEqual({ graph: [], exchange: true })
    expect(priceHitFields('unique|X|Y', { c: 1, n: 0, lc: false, t: 'UniqueArmour', v: -1 })).toEqual({ graph: [], exchange: false })
  })
})

describe('toPoe2Entry / createPoe2PriceSource(PoE2 查價元件的價格源)', () => {
  it('chaos → divine(EE2 單位);成交量同樣換 divine;沒有成交量就不帶鍵', async () => {
    const snap = await snapshotOf('poe2')
    const hit = hitOf(snap, { ns: 'ITEM', name: "Aldur's Legacy" })!
    const e = toPoe2Entry(hit, snap.divineRate!)!
    expect(e.primaryValue).toBeCloseTo(385.3, 9)
    expect(e.volumePrimaryValue).toBeCloseTo(13228, 3)
    expect(e).toMatchObject({ maxVolumeCurrency: 'divine', cx: true, detailsId: 'aldurs-legacy', sparkline: { totalChange: 15.12 } })
    expect(e.sparkline.data).toHaveLength(7)
    const noVol = toPoe2Entry({ ...hit, volumeChaos: undefined }, snap.divineRate!)!
    expect('volumePrimaryValue' in noVol).toBe(false)
    expect(toPoe2Entry(hit, undefined)).toBeNull()
  })

  function fakeNinja (snap: NinjaSnapshot | null): Poe2NinjaLike & { fetches: number } {
    const n = {
      fetches: 0,
      snapshot: { value: snap },
      xchgRate: { value: snap?.divineRate ?? undefined },
      exaltedRate: { value: snap?.exaltedRate ?? undefined },
      findPriceByQuery: (q: NinjaQuery) => (snap ? hitOf(snap, q) : null),
      queuePricesFetch () { n.fetches++ },
      initialLoading: () => false
    }
    return n
  }

  it('有 PoE2 價格表:find / rates / revision;queuePricesFetch 轉交', async () => {
    const snap = await snapshotOf('poe2')
    const ninja = fakeNinja(snap)
    const src = createPoe2PriceSource(() => ninja)
    expect(src.revision()).toBe('poe2|Forbidden Rites|1')
    expect(src.rates()).toEqual({ divineRate: 9.61, exaltedRate: snap.exaltedRate })
    expect(src.find({ ns: 'ITEM', name: 'Exalted Orb' })!.primaryValue).toBeCloseTo(0.001637, 9)
    expect(src.find({ ns: 'ITEM', name: 'Nope' })).toBeNull()
    src.queuePricesFetch()
    expect(ninja.fetches).toBe(1)
  })
  it('台服 / 沒有價格表 / 價格表是 PoE1 → 沒有價格(find null、revision undefined)', async () => {
    const none = createPoe2PriceSource(() => fakeNinja(null))
    expect(none.revision()).toBeUndefined()
    expect(none.find({ ns: 'ITEM', name: 'Divine Orb' })).toBeNull()
    const poe1 = createPoe2PriceSource(() => fakeNinja(null))
    expect(poe1.find({ ns: 'ITEM', name: 'Divine Orb' })).toBeNull()
    const p1 = await snapshotOf('poe1')
    const wrongGame = createPoe2PriceSource(() => fakeNinja(p1))
    expect(wrongGame.revision()).toBeUndefined()
    expect(wrongGame.find({ ns: 'ITEM', name: 'Divine Orb' })).toBeNull()
  })
})

describe('autoCurrency 單位(core ninja/units.ts)', () => {
  const p1 = { divineRate: 200 }
  const p2 = { divineRate: 9.61, exaltedRate: 9.61 / 610.9 }
  it('PoE1 與 APT 相同:> 0.94 div 換 div、0.94–1.06 顯示 1 div;區間看上限', () => {
    expect(autoCurrencyFor('poe1', 50, p1)).toEqual({ min: 50, max: 50, currency: 'chaos' })
    expect(autoCurrencyFor('poe1', 195, p1)).toEqual({ min: 1, max: 1, currency: 'div' })
    expect(autoCurrencyFor('poe1', 400, p1)).toEqual({ min: 2, max: 2, currency: 'div' })
    expect(autoCurrencyFor('poe1', [100, 300], p1)).toEqual({ min: 0.5, max: 1.5, currency: 'div' })
    expect(autoCurrencyFor('poe1', 5000, {})).toEqual({ min: 5000, max: 5000, currency: 'chaos' })
  })
  it('PoE2:≥ 1 div 換神聖石,否則崇高石(與符文塑形徽章相同);coreOnly 不換 div;沒有 exalted 匯率 → chaos', () => {
    const ex = autoCurrencyFor('poe2', 0.5 * 9.61, p2)
    expect(ex.currency).toBe('exalted')
    expect(ex.min).toBeCloseTo(305.45, 6)
    expect(autoCurrencyFor('poe2', 9.61, p2)).toEqual({ min: 1, max: 1, currency: 'div' })
    expect(autoCurrencyFor('poe2', 7.5 * 9.61, p2).currency).toBe('div')
    expect(autoCurrencyFor('poe2', 9.61, p2, { coreOnly: true }).currency).toBe('exalted')
    expect(autoCurrencyFor('poe2', 2, { divineRate: 9.61 })).toEqual({ min: 2, max: 2, currency: 'chaos' })
  })
})

describe('成交量設定 / 圖示 / 走勢圖', () => {
  it('四選一,值與 EE2 相同;預設 both', () => {
    expect(CURRENCY_VOLUME_OPTIONS.map(o => o.value)).toEqual(['none', 'value', 'item', 'both'])
    expect(defaultPriceCheck().currencyVolume).toBe('both')
    expect(volumeParts('none')).toEqual({ value: false, item: false })
    expect(volumeParts('value')).toEqual({ value: true, item: false })
    expect(volumeParts('item')).toEqual({ value: false, item: true })
    expect(volumeParts('both')).toEqual({ value: true, item: true })
    expect(volumeParts(undefined)).toEqual({ value: false, item: false })
  })
  it('通貨圖示與 EE2 CoreCurrencyImg 同一張對照', () => {
    expect(coreCurrencyIcon('divine')).toBe('/images/divine.png')
    expect(coreCurrencyIcon('div')).toBe('/images/divine.png')
    expect(coreCurrencyIcon('chaos')).toBe('/images/chaos.png')
    expect(coreCurrencyIcon('exalted')).toBe('/images/exa.png')
    expect(coreCurrencyIcon('mirror')).toBe('/images/404.png')
  })
  it('sparklineGeometry:最小值貼底、最大值貼頂、面積封到底;點數不足或範圍 0 → null', () => {
    const g = sparklineGeometry([0, 10, 5], 0, 10, 48, 32)!
    expect(g.line).toBe('M0 32 L24 0 L48 16')
    expect(g.area).toBe('M0 32 L24 0 L48 16 L48 32 L0 32 Z')
    expect(sparklineGeometry([1], 0, 10, 48, 32)).toBeNull()
    expect(sparklineGeometry([1, 2], 3, 3, 48, 32)).toBeNull()
  })
  it('設定頁兩代都顯示(只依伺服器 v-if,第 39 步:台服沒有 poe.ninja 不顯示)、綁 currencyVolume;字串兩語都有', () => {
    const vue = read('renderer/src/web/settings/tabs/PriceCheck.vue')
    expect(vue).toMatch(/<div v-if="showVolume" class="srow">\s*<span class="k">\{\{ t\('ppz\.currency_volume'\) \}\}/)
    expect(vue).toContain('showVolume: computed(() => hasCurrencyVolume(config.realm))')
    expect(hasCurrencyVolume('intl')).toBe(true)
    expect(hasCurrencyVolume('tw')).toBe(false)
    expect(vue).toMatch(/pc\.currencyVolume = o\.value/)
    for (const lang of ['en', 'cmn-Hant']) {
      const ppz = JSON.parse(read('renderer/src/i18n/' + lang + '.json')).ppz
      for (const k of ['currency_volume', 'currency_volume_hint', 'highest_volume', 'per_hour', ...CURRENCY_VOLUME_OPTIONS.map(o => o.key.replace('ppz.', ''))]) {
        expect(typeof ppz[k], lang + ' ppz.' + k).toBe('string')
        expect(ppz[k].length).toBeGreaterThan(0)
      }
    }
  })
})

describe('接線守門', () => {
  it('兩代 CheckedItem 都掛 PriceTrend / StackValue', () => {
    for (const f of ['poe1/src/web/price-check/CheckedItem.vue', 'poe2/src/web/price-check/CheckedItem.vue']) {
      const src = read(f)
      expect(src, f).toMatch(/<price-trend\s/)
      expect(src, f).toMatch(/<stack-value\s/)
    }
  })
  it('PriceTrend / StackValue 只對 exchange 類顯示;不用 apexcharts;檔頭有 MIT 出處', () => {
    const files = {
      'poe1/src/web/price-check/trends/PriceTrend.vue': /if \(!trend\.exchange\) return/,
      'poe2/src/web/price-check/trends/PriceTrend.vue': /if \(!entry\.cx\) return/,
      'poe1/src/web/price-check/expected-value/StackValue.vue': /findPriceByQuery\(id\)\?\.exchange/,
      'poe2/src/web/price-check/stack-value/StackValue.vue': /findPriceByQuery\(id\)\?\.cx/
    }
    for (const [f, re] of Object.entries(files)) {
      const src = read(f)
      expect(src, f).toMatch(re)
      expect(src, f).not.toMatch(/from ['"]vue3-apexcharts['"]|<vue-apexcharts/)
      expect(src, f).toMatch(/MIT/)
    }
    expect(JSON.parse(read('renderer/package.json')).dependencies?.['vue3-apexcharts']).toBeUndefined()
  })
  it('剪貼簿查價兩代都算「有人在查價」(queuePricesFetch;節流與 20 分鐘閘門在 load 內)', () => {
    const src = read('renderer/src/web/background/Prices.ts')
    expect(src).toMatch(/Host\.onItemText\(\(\) => \{\s*queuePricesFetch\(\)\s*\}\)/)
    expect(src).toMatch(/if \(realm !== 'intl' \|\| !league\?\.id \|\| !league\.isPopular\) return null/)
  })
  it('快取讀取中又有人查價:先等快取讀完再判斷新鮮度(不因 snapshot 暫時為 null 就上網抓)', () => {
    const src = read('renderer/src/web/background/Prices.ts')
    expect(src).toMatch(/cacheLoading = \(async \(\) => \{/)
    expect(src).toMatch(/if \(cacheLoading\) \{\s*await cacheLoading\s*if \(targetKey\.value !== key\) return\s*\}\s*if \(!force\)/)
  })
  it('main.ts 注入 PoE2 價格源', () => {
    expect(read('renderer/src/main.ts')).toMatch(/Poe2\.setPriceSource\(createPoe2PriceSource\(\(\) => usePoeninja\(\)\)\)/)
  })
})
