/**
 * 就地回報(2026-10-08):未解析詞綴旁的「回報這條」、清單上方的物品層級提示、查價錯誤框的「回報問題」。
 * 兩代 UnknownModifier 真掛載:有 provide(REPORT_INLINE_KEY) 才畫按鈕,點了帶詞綴原文;沒有注入時不畫。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import { createI18n } from 'vue-i18n'
import Poe1UnknownModifier from '@poe1/filters/UnknownModifier.vue'
import Poe2UnknownModifier from '../../poe2/src/web/price-check/filters/UnknownModifier.vue'
import ReportInline from '../src/web/ui/ReportInline.vue'
import { REPORT_INLINE_KEY, type InlineReporter } from '../src/web/report-inline'
import { mount, text, findAll, byAttr, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')

function i18nPlugin () {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/poe2/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({
    legacy: false,
    locale: 'cmn-Hant',
    fallbackLocale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') }
  })
}

const MOD = '增加 22% 天賦樹插槽內的已汙染魔法珠寶效果'
const stat = { text: MOD, type: 'explicit' }

function render (child: () => unknown, reporter: InlineReporter | null) {
  const errors: unknown[] = []
  const warnings: string[] = []
  const Root = defineComponent({
    setup () {
      if (reporter) provide(REPORT_INLINE_KEY, reporter)
      return child
    }
  })
  const { container, app } = mount(Root, [i18nPlugin()], (a) => {
    a.config.errorHandler = (err) => { errors.push(err) }
    a.config.warnHandler = (msg) => { warnings.push(msg) }
  })
  return { container, app, errors, warnings }
}

function click (n: MiniNode) {
  const fn = n.attrs.onClick as ((e: unknown) => void) | undefined
  expect(typeof fn).toBe('function')
  fn!({ preventDefault () {} })
}

const byAction = (c: MiniNode, a: string) => findAll(c, byAttr('data-action', a))

describe('未解析詞綴旁的回報', () => {
  for (const [name, comp, extra] of [
    ['PoE1', Poe1UnknownModifier, {}],
    ['PoE2', Poe2UnknownModifier, { itemText: 'raw' }]
  ] as const) {
    it(`${name}:有注入 → 「回報這條」,點了帶詞綴原文`, async () => {
      const calls: Array<[string, string | undefined]> = []
      const { container, errors, warnings, app } = render(() => h(comp as never, { stat, ...extra }), { report: (k, d) => { calls.push([k, d]) } })
      await nextTick()
      expect(errors).toEqual([])
      expect(warnings).toEqual([])
      const btn = byAction(container, 'report-unknown-mod')
      expect(btn.length).toBe(1)
      expect(text(btn[0])).toContain('回報這條')
      click(btn[0])
      expect(calls).toEqual([['mod', MOD]])
      app.unmount()
    })

    it(`${name}:沒有注入 → 不畫按鈕(CLI / 其他宿主)`, async () => {
      const { container, errors, app } = render(() => h(comp as never, { stat, ...extra }), null)
      await nextTick()
      expect(errors).toEqual([])
      expect(byAction(container, 'report-unknown-mod')).toEqual([])
      expect(text(container)).toContain('天賦樹插槽')
      app.unmount()
    })
  }
})

describe('物品層級提示與查價錯誤', () => {
  it('summary:顯示條數,點「回報問題」= 整件物品', async () => {
    const calls: Array<[string, string | undefined]> = []
    const { container, errors, app } = render(() => h(ReportInline, { mode: 'summary', count: 2 }), { report: (k, d) => { calls.push([k, d]) } })
    await nextTick()
    expect(errors).toEqual([])
    const box = findAll(container, byAttr('data-report', 'summary'))
    expect(box.length).toBe(1)
    expect(text(box[0])).toContain('2 條詞綴無法辨識')
    click(byAction(container, 'report-unknown-all')[0])
    expect(calls).toEqual([['item', undefined]])
    app.unmount()
  })

  it('trade:錯誤框的「回報問題」帶錯誤訊息', async () => {
    const calls: Array<[string, string | undefined]> = []
    const { container, app } = render(() => h(ReportInline, { mode: 'trade', detail: 'Query is too complex.' }), { report: (k, d) => { calls.push([k, d]) } })
    await nextTick()
    click(byAction(container, 'report-trade-error')[0])
    expect(calls).toEqual([['trade', 'Query is too complex.']])
    app.unmount()
  })

  it('沒有注入 → summary / trade 都不畫', async () => {
    for (const mode of ['summary', 'trade'] as const) {
      const { container, app } = render(() => h(ReportInline, { mode, count: 1, detail: 'x' }), null)
      await nextTick()
      expect(text(container)).toBe('')
      app.unmount()
    }
  })
})
