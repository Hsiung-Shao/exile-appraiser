/**
 * 2026-10-08 使用者回報:PoE1 未鑑定傳奇(羊毛之鞋)查價區空白。原因:PoE1 沒接 APT 的 UnidentifiedResolver,
 * CheckedItem 的 `show`(未鑑定傳奇且沒選定)把整塊藏掉。補上後:列出這個底材的傳奇,點一個 → 物品換成已選定,CheckedItem 顯示。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter } from '../../poe1/src/index'
import { parseClipboard, type ParsedItem } from '@/parser'
import UnidentifiedResolver from '@poe1/unidentified-resolver/UnidentifiedResolver.vue'
import { mount, text, findAll, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')

function i18nPlugin () {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/poe1/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

// 使用者回報的剪貼簿(原樣)
const WOOL_SHOES = [
  '物品種類: 鞋子', '稀有度: 傳奇', '羊毛之鞋', '--------', '能量護盾: 7', '--------', '插槽: W ', '--------',
  '物品等級: 75', '--------', '未鑑定', '--------', '貼模傳奇 (鈷藍)'
].join('\n')

beforeAll(async () => {
  await poe1Adapter.loadData(poe1DataSource(path.join(ROOT, 'data/poe1')), 'cmn-Hant')
}, 300_000)

describe('PoE1 未鑑定傳奇選擇', () => {
  it('羊毛之鞋:列出可能的傳奇,點一個 → 已選定的物品(CheckedItem 不再藏起)', async () => {
    const item = parseClipboard(WOOL_SHOES)._unsafeUnwrap()
    expect(item.isUnidentified).toBe(true)
    expect(item.info.unique).toBeUndefined()
    const picked: ParsedItem[] = []
    const errors: unknown[] = []
    const Root = defineComponent({ setup: () => () => h(UnidentifiedResolver, { item, onIdentify: (x: ParsedItem) => { picked.push(x) } }) })
    const { container, app } = mount(Root, [i18nPlugin()], (a) => { a.config.errorHandler = (e) => { errors.push(e) } })
    await nextTick()
    expect(errors).toEqual([])
    expect(text(container)).toContain('羊毛之鞋')
    const buttons = findAll(container, (n: MiniNode) => n.tag === 'button')
    // 羊毛之鞋底材目前只有一件傳奇 → 上游行為:自動選定(App.vue 換成已選定的物品),同時仍列出那一件
    expect(buttons.length).toBe(1)
    expect(picked.length).toBeGreaterThanOrEqual(1)
    expect(picked[0].info.unique?.base).toBe('Wool Shoes')
    expect(picked[0].isUnidentified).toBe(true)
    // 點選同樣送出
    const before = picked.length
    ;(buttons[0].attrs.onClick as () => void)()
    expect(picked.length).toBe(before + 1)
    app.unmount()
  })

  it('App.vue 兩代都接 UnidentifiedResolver', () => {
    const app = fs.readFileSync(path.join(ROOT, 'renderer/src/web/App.vue'), 'utf8')
    expect(app).toContain("loadedGame.value === 'poe2' ? Poe2.UnidentifiedResolver : Poe1UnidentifiedResolver")
    expect(app).toContain("import Poe1UnidentifiedResolver from '@poe1/unidentified-resolver/UnidentifiedResolver.vue'")
  })
})
