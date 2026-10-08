/**
 * 2026-10-08 APT 式懸浮選單真掛載:按鈕列、正則書籤 PoE1 / PoE2 切換與每列字串預覽、速查表空狀態、「設定」emit、✕ 收起。
 * 資料讀 repo(data/regex)、不連網、不送任何輸入(點擊只呼叫元件的事件處理)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { initConfig } from '../src/web/Config'
import { ensureStateLoaded, useRegexStore } from '../src/web/regex/store'
import FloatMenu from '../src/web/overlay/FloatMenu.vue'
import { floatMenuSection } from '../src/web/overlay/float-menu-state'
import { mount, text, findAll, byAttr, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')

function i18nPlugin () {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/poe2/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

const settle = async (ms = 30) => { for (let i = 0; i < 5; i++) { await nextTick(); await new Promise(r => setTimeout(r, ms)) } }
const byAction = (c: MiniNode, a: string) => findAll(c, byAttr('data-action', a))
function click (n: MiniNode | undefined) {
  expect(n).toBeTruthy()
  const fn = n!.attrs.onClick as ((e: unknown) => void) | undefined
  expect(typeof fn).toBe('function')
  fn!({ preventDefault () {}, stopPropagation () {} })
}

function render () {
  const errors: unknown[] = []
  const warnings: string[] = []
  const events: string[] = []
  const Root = defineComponent({
    setup: () => () => h(FloatMenu, {
      settingsOpen: false,
      onClose: (r: string) => { events.push(`close:${r}`) },
      onSettings: () => { events.push('settings') }
    })
  })
  const { container, app } = mount(Root, [i18nPlugin()], (a) => {
    a.config.errorHandler = (err) => { errors.push(err) }
    a.config.warnHandler = (msg) => { warnings.push(msg) }
  })
  return { container, app, errors, warnings, events }
}

beforeAll(async () => {
  await initConfig()
  await ensureStateLoaded()
  const store = useRegexStore()
  store.ui.bookmarks.splice(0, store.ui.bookmarks.length,
    { name: '地圖一', page: 'map_mods', game: 'poe2', mode: 'any', lang: 'zh', keys: [], alt: [] } as never,
    { name: 'PoE1 書籤', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: [], alt: [] } as never)
}, 120_000)

describe('FloatMenu 真掛載', () => {
  it('按鈕列;「設定」emit settings、✕ emit close', async () => {
    floatMenuSection.value = ''
    const { container, errors, warnings, events, app } = render()
    await settle()
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    const s = text(container)
    for (const w of ['流亡鑑價', '設定', '正則書籤', '速查表']) expect(s).toContain(w)
    click(byAction(container, 'menu-settings')[0])
    click(byAction(container, 'menu-close')[0])
    expect(events).toEqual(['settings', 'close:✕'])
    app.unmount()
  })

  it('正則書籤:預設目前遊戲(PoE2),切 PoE1 改「點一下複製」;每列有名稱', async () => {
    floatMenuSection.value = ''
    const { container, errors, app } = render()
    await settle()
    click(byAction(container, 'menu-bookmarks')[0])
    await settle()
    expect(errors).toEqual([])
    let items = findAll(container, byAttr('data-menu', 'bm-item'))
    expect(items.map(n => n.attrs['data-bm'])).toEqual(['地圖一'])
    expect(text(container)).toContain('目前遊戲 · 點一下貼進遊戲')
    const poe1 = findAll(container, byAttr('data-game', 'poe1'))[0]
    click(poe1)
    await settle()
    items = findAll(container, byAttr('data-menu', 'bm-item'))
    expect(items.map(n => n.attrs['data-bm'])).toEqual(['PoE1 書籤'])
    expect(text(container)).toContain('不是目前的遊戲 · 點一下複製')
    app.unmount()
  })

  it('速查表:沒匯入 → 空狀態(測試環境沒有檔案對話框 → 提示在程式視窗匯入)', async () => {
    floatMenuSection.value = ''
    const { container, errors, app } = render()
    await settle()
    click(byAction(container, 'menu-sheet')[0])
    await settle()
    expect(errors).toEqual([])
    expect(findAll(container, byAttr('data-menu', 'sheet-empty')).length).toBe(1)
    expect(text(container)).toContain('還沒有速查表')
    expect(findAll(container, byAttr('data-layer', 'sheet-zoom'))).toEqual([])
    app.unmount()
  })
})
