/**
 * P2(查價面板 B 改版):價格區 PriceHero 兩種模式與「你的這一疊」卡真掛載(Q6 / Q7)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import PriceHero from '../src/web/price-panel/PriceHero.vue'
import StackCard from '../src/web/price-panel/StackCard.vue'
import type { ItemHeroView, MarketView, StackView } from '../src/web/price-panel/price-hero'
import { mount, text, findAll, byAttr, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')

function i18nPlugin () {
  const load = (lang: string) => JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

async function render (comp: unknown, props: Record<string, unknown>) {
  const warnings: string[] = []
  const errors: unknown[] = []
  const Root = defineComponent({ setup: () => () => h(comp as never, props) })
  const { container, app } = mount(Root, [i18nPlugin()], (a) => {
    a.config.warnHandler = (m) => { warnings.push(m) }
    a.config.errorHandler = (e) => { errors.push(e) }
  })
  await nextTick()
  return { container, app, warnings, errors }
}

const one = (root: MiniNode, attr: string) => {
  const hits = findAll(root, byAttr(attr))
  expect(hits, attr).toHaveLength(1)
  return hits[0]
}
const imgs = (n: MiniNode) => findAll(n, x => x.tag === 'img').map(x => x.attrs.src)

describe('PriceHero 一般物品模式', () => {
  it('有結果:顯示建議售價(混沌石圖示)、最低、中位、符合 10000+', async () => {
    const view: ItemHeroView = {
      state: 'ready', converted: true, few: false, total: '10000+',
      suggested: { amount: 1, unit: 'chaos' }, min: { amount: 1, unit: 'chaos' }, median: { amount: 1.5, unit: 'chaos' }
    }
    const { container, warnings, errors } = await render(PriceHero, { game: 'poe1', mode: 'item', view })
    expect(text(one(container, 'data-hero-suggested'))).toBe('1')
    expect(imgs(one(container, 'data-hero-suggested'))).toEqual(['/images/chaos.png'])
    expect(text(one(container, 'data-hero-min'))).toBe('1 c')
    expect(text(one(container, 'data-hero-median'))).toBe('1.5 c')
    expect(text(one(container, 'data-hero-total'))).toBe('10000+')
    expect(text(container)).toContain('建議售價')
    expect(findAll(container, byAttr('data-hero-few'))).toEqual([])
    expect(warnings).toEqual([])
    expect(errors).toEqual([])
  })
  it('筆數少:標「筆數少」、中位顯示 —', async () => {
    const view: ItemHeroView = { state: 'ready', converted: true, few: true, total: '2', suggested: { amount: 3, unit: 'exalted' }, min: { amount: 3, unit: 'exalted' } }
    const { container } = await render(PriceHero, { game: 'poe2', mode: 'item', view })
    expect(text(one(container, 'data-hero-few'))).toBe('筆數少')
    expect(text(one(container, 'data-hero-median'))).toBe('—')
    expect(imgs(one(container, 'data-hero-suggested'))).toEqual(['/images/poe2/exa.png'])
  })
  it('讀取中 / 沒有結果:只顯示狀態列', async () => {
    const loading = await render(PriceHero, { game: 'poe1', mode: 'item', view: { state: 'loading', total: '', few: false, converted: false } })
    expect(text(one(loading.container, 'data-hero-status'))).toContain('查詢中')
    const empty = await render(PriceHero, { game: 'poe1', mode: 'item', view: { state: 'empty', total: '0', few: false, converted: false } })
    expect(text(one(empty.container, 'data-hero-status'))).toContain('沒有符合的掛單')
    expect(findAll(empty.container, byAttr('data-hero-suggested'))).toEqual([])
  })
})

describe('PriceHero 通貨模式', () => {
  const market: MarketView = {
    loading: false,
    itemIcon: 'https://web.poecdn.com/divine.png',
    itemName: '神聖石',
    rate: { min: 301, max: 301, currency: 'exalted' },
    fraction: true,
    change: { forecast: 'down', text: '19 %', graph: { points: [0, -2, -5, -9, -12, -15, -19], drawMin: -25, drawMax: 5 } },
    volumeValue: { amount: '332', unit: 'exalted' },
    volumeItems: { amount: '1.1' },
    highest: 'exalted'
  }
  it('PoE2:1 X → N 崇高石、跌幅 + 走勢、三格成交量,圖示走 /images/poe2/', async () => {
    const { container, warnings, errors } = await render(PriceHero, { game: 'poe2', mode: 'currency', market })
    expect(text(one(container, 'data-hero-from'))).toBe('1')
    expect(text(one(container, 'data-hero-rate'))).toBe('301')
    expect(imgs(one(container, 'data-hero-rate'))).toEqual(['/images/poe2/exa.png'])
    const change = one(container, 'data-price-change')
    expect(change.attrs['data-tone']).toBe('down')
    expect(text(change)).toContain('▼ 19 %')
    expect(findAll(change, byAttr('data-sparkline'))).toHaveLength(1)
    expect(text(one(container, 'data-volume-value'))).toContain('332')
    expect(imgs(one(container, 'data-volume-value'))).toEqual(['/images/poe2/exa.png'])
    expect(imgs(one(container, 'data-volume-item'))).toEqual([market.itemIcon])
    expect(imgs(one(container, 'data-highest-volume'))).toEqual(['/images/poe2/exa.png'])
    expect(warnings).toEqual([])
    expect(errors).toEqual([])
  })
  it('PoE1 同資料改用 /images/ 圖;沒有成交量時不畫成交量格', async () => {
    const { container } = await render(PriceHero, {
      game: 'poe1', mode: 'currency',
      market: { ...market, rate: { min: 360, max: 360, currency: 'chaos' }, volumeValue: undefined, volumeItems: undefined, highest: undefined }
    })
    expect(imgs(one(container, 'data-hero-rate'))).toEqual(['/images/chaos.png'])
    expect(findAll(container, byAttr('data-volume-value'))).toEqual([])
    expect(findAll(container, byAttr('data-highest-volume'))).toEqual([])
  })
  it('點走勢 emit open(開 poe.ninja)', async () => {
    let opened = 0
    const { container } = await render(PriceHero, { game: 'poe2', mode: 'currency', market, onOpen: () => { opened++ } })
    ;(one(container, 'data-price-change').attrs.onClick as () => void)()
    expect(opened).toBe(1)
  })
})

describe('StackCard(你的這一疊)', () => {
  it('庫存 × N 與堆疊上限 × M,金額配單位圖示', async () => {
    const stack: StackView = { have: { count: 16, value: { amount: 16, unit: 'div' } }, oneStack: { count: 10, value: { amount: 10, unit: 'div' } } }
    const { container, warnings } = await render(StackCard, { game: 'poe2', stack })
    expect(text(one(container, 'data-stack-have'))).toBe('庫存 × 16 = 16')
    expect(imgs(one(container, 'data-stack-max'))).toEqual(['/images/poe2/divine.png'])
    expect(text(container)).toContain('你的這一疊')
    expect(warnings).toEqual([])
  })
})
