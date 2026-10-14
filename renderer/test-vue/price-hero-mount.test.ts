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
import type { MarketView, StackView } from '../src/web/price-panel/price-hero'
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
  it('有價值的底材時市價卡標示「底材」', async () => {
    const { container } = await render(PriceHero, { game: 'poe1', mode: 'currency', market: { ...market, baseItem: true } })
    expect(text(one(container, 'data-hero-base'))).toBe('底材')
  })
  it('一般通貨不標示底材', async () => {
    const { container } = await render(PriceHero, { game: 'poe1', mode: 'currency', market })
    expect(findAll(container, byAttr('data-hero-base'))).toEqual([])
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
  it('神聖石金額保留一位小數(12.5 不取整)', async () => {
    const stack: StackView = { have: { count: 25, value: { amount: 12.5, unit: 'div' } } }
    const { container } = await render(StackCard, { game: 'poe1', stack })
    expect(text(one(container, 'data-stack-have'))).toBe('庫存 × 25 = 12.5')
  })
  it('PriceHero 只剩通貨模式:mode="item" 不輸出任何東西', async () => {
    const { container } = await render(PriceHero, { game: 'poe1', mode: 'item' })
    expect(findAll(container, byAttr('data-price-hero'))).toEqual([])
  })
})
