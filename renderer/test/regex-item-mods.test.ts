// 第 37 步:物品詞綴數值頁(RegexItemModList.vue + store `ensureItemMods`)。
// 片段 / 唯一性 / 篩選 / 書籤 / 分享碼的邏輯在 regex/test/item-mods.test.ts;這裡驗字串兩語、元件用到的鍵、
// 以及接線守門:清單載入時只放空頁(第一次開頁才讀 stats.ndjson)、沒載入前不還原那一頁、書籤 / 分享碼 / 範本先載再套用。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

const zh = JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz.regex
const en = JSON.parse(read('renderer/src/i18n/en.json')).ppz.regex

describe('物品詞綴數值頁字串', () => {
  const KEYS = ['imv_loading', 'imv_failed', 'imv_search_ph', 'imv_picked_only', 'imv_count', 'imv_more', 'imv_note', 'imv_hint']
  it('ppz.regex.imv_* 兩語都有、參數相同、沒有 vue-i18n 特殊字元', () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
    for (const k of KEYS) {
      expect(typeof zh[k], `cmn-Hant ${k}`).toBe('string')
      expect(typeof en[k], `en ${k}`).toBe('string')
      expect(params(en[k]), k).toEqual(params(zh[k]))
      for (const s of [zh[k], en[k]]) expect(s, k).not.toMatch(/[|@$]/)
    }
  })
  it('元件用到的 ppz.regex 鍵兩語都存在', () => {
    const vue = read('renderer/src/web/regex/RegexItemModList.vue')
    const used = [...vue.matchAll(/'ppz\.regex\.(\w+)'/g)].map(m => m[1])
    expect(used.length).toBeGreaterThan(6)
    for (const k of used) {
      expect(typeof zh[k], `cmn-Hant ${k}`).toBe('string')
      expect(typeof en[k], `en ${k}`).toBe('string')
    }
  })
  it('英文頁說明兩個遊戲都有', () => {
    expect(typeof en.page_note.item_mod_values).toBe('string')
    expect(typeof en.page_note.item_mod_values_poe2).toBe('string')
  })
})

describe('物品詞綴數值頁接線', () => {
  const store = read('renderer/src/web/regex/store.ts')
  const panel = read('renderer/src/web/regex/RegexPanel.vue')
  const list = read('renderer/src/web/regex/RegexItemModList.vue')
  const algo = read('renderer/src/web/regex/RegexAlgoList.vue')
  const quick = read('renderer/src/web/regex/quick.ts')
  it('清單載入時只放空頁;第一次需要才 fetch 兩語 stats.ndjson', () => {
    expect(store).toMatch(/cat\.pages\.push\(\.\.\.algoPages\(game, labels\), itemModPage\(game, null\)\)/)
    expect(store).toContain('./data/${game}/cmn-Hant/stats.ndjson')
    expect(store).toContain('./data/${game}/en/stats.ndjson')
    expect(store).toMatch(/buildItemModData\(game, parseStatsNdjson\(zh\), parseStatsNdjson\(en\)\)/)
    // 載入只在 ensureItemMods 裡(不在 fetchCatalogue 就讀)
    const fetchCat = store.slice(store.indexOf('async function fetchCatalogue'), store.indexOf('async function fetchTemplates'))
    expect(fetchCat).not.toContain('stats.ndjson')
  })
  it('沒載入前不還原那一頁;存檔有引用或選到它才載', () => {
    expect(store).toMatch(/if \(isItemModPageId\(page\.id\) && !itemModsReady\(cat\.game\)\) continue/)
    expect(store).toMatch(/void ensureItemMods\(cat\.game\)/)
    expect(store).toMatch(/if \(isItemModPageId\(id\)\) void ensureItemMods\(selGame\.value\)/)
  })
  it('書籤 / 分享碼 / 範本 / 快捷書籤先載入再套用', () => {
    expect(store).toMatch(/await prepareItemMods\(d\.state\.game/)
    expect(store).toMatch(/void prepareItemMods\(t\.state\.game/)
    expect(store).toMatch(/if \(isItemModPageId\(b\.page\)\)/)
    expect(store).toMatch(/if \(pageId && isItemModPageId\(pageId\)\) await ensureItemMods\(game\)/)
    expect(quick).toMatch(/catalogueFor\(b\.game, b\.page\)/)
  })
  it('面板:物品詞綴頁走 RegexItemModList(在一般演算法頁之前判斷),列 UI 沿用 RegexAlgoList', () => {
    const i = panel.indexOf('<RegexItemModList')
    expect(i).toBeGreaterThan(0)
    expect(panel.indexOf('<RegexAlgoList v-else-if="algoPage"')).toBeGreaterThan(i)
    expect(list).toMatch(/<RegexAlgoList[^>]*:rows-only="filtered\.rows"/)
    expect(list).toMatch(/filterItemMods\(/)
    expect(algo).toMatch(/rowsOnly: \{ type: Array/)
  })
})
