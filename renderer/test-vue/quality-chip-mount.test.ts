/**
 * 2026-11-18 使用者回報實測沒看到品質膠囊:PoE1 查價面板(真掛載 CheckedItem)要畫出可輸入的品質。
 * 交易站回應用假 fetch,不連網(同 online-filter-memory-mount.test.ts)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { initConfig } from '../src/web/Config'
import { Host } from '../src/web/background/IPC'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter } from '../../poe1/src/index'
import { parseClipboard as poe1Parse } from '@/parser'
import { setTradeContextProvider as poe1SetCtx } from '../../poe1/src/web/price-check/trade/common'
import Poe1CheckedItem from '../../poe1/src/web/price-check/CheckedItem.vue'
import { mount, text, findAll, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')
const fx = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

function i18nPlugin () {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/poe1/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

beforeAll(async () => {
  await initConfig()
  await poe1Adapter.loadData(poe1DataSource(path.join(ROOT, 'data/poe1')), 'en')
  poe1SetCtx(() => ({ http: Host.httpFetch, realm: 'intl' as const, latencySeconds: 0, accountName: undefined }))
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (/\/api\/trade\/search\//.test(url)) return json({ id: 'Q', result: [], total: 0 })
    return realFetch(input, init)
  }) as typeof fetch
}, 300_000)

const settle = async () => {
  for (let i = 0; i < 5; i++) await nextTick()
  await new Promise(resolve => setTimeout(resolve, 50))
  for (let i = 0; i < 5; i++) await nextTick()
}

/** 篩選列裡名稱是「品質」的膠囊(有數字輸入框) */
const qualityChip = (c: MiniNode) => findAll(c, n => n.tag === 'div' &&
  n.children.some(ch => (ch as MiniNode).tag === 'button' && text(ch as MiniNode).trim().replace(/[:：]$/, '') === '品質') &&
  n.children.some(ch => (ch as MiniNode).tag === 'input'))

describe('PoE1 查價面板的品質膠囊', () => {
  it('issue #31 的 30% 頭盔:面板畫出品質膠囊與輸入框', async () => {
    const item = ref(poe1Parse(fx('poe1/test/fixtures/quality/helmet-q30-issue-31.en.txt'))._unsafeUnwrap())
    const errors: unknown[] = []
    const Root = defineComponent({
      setup () {
        provide('builtin-browser', () => {})
        return () => h(Poe1CheckedItem as never, { item: item.value, advancedCheck: true })
      }
    })
    const { container, app } = mount(Root, [i18nPlugin()], (a) => { a.config.errorHandler = (err) => { errors.push(err) } })
    await settle()
    expect(errors).toEqual([])
    expect(qualityChip(container).length, text(container).slice(0, 400)).toBe(1)
    app.unmount()
  }, 120_000)
})
