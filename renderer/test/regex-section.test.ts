// 第 32 步:數值條件嵌進詞綴頁(RegexNumericSection.vue)。
// 字串兩語都有且參數一致、元件用到的鍵都存在;接線守門:下拉選單只列清單頁、宿主頁上方掛數值區、
// 合併 / 單頁輸出都走 combineSels(數值區緊接宿主頁 = 與舊版合併頁逐字相同,regex/test/sections.test.ts 驗)、
// 存檔 / 書籤 / 分享碼走 regex/src/embed.ts 的純函式(不在 store 另寫一套)。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

const KEYS = ['section_title', 'section_hint', 'section_expand', 'section_collapse', 'section_count', 'section_length', 'section_none']

describe('數值區字串', () => {
  const zh = JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz.regex
  const en = JSON.parse(read('renderer/src/i18n/en.json')).ppz.regex
  it('中英文 ppz.regex.section_* 都有,參數相同', () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
    for (const k of KEYS) {
      expect(typeof zh[k], `cmn-Hant ppz.regex.${k}`).toBe('string')
      expect(typeof en[k], `en ppz.regex.${k}`).toBe('string')
      expect(params(en[k]), k).toEqual(params(zh[k]))
    }
  })
  it('元件用到的 ppz.regex 鍵兩語都存在', () => {
    for (const f of ['RegexNumericSection.vue', 'RegexAlgoList.vue']) {
      const vue = read(`renderer/src/web/regex/${f}`)
      const used = [...vue.matchAll(/'ppz\.regex\.(\w+)'/g)].map(m => m[1])
      expect(used.length, f).toBeGreaterThan(2)
      for (const k of used) {
        expect(typeof zh[k], `${f} cmn-Hant ${k}`).toBe('string')
        expect(typeof en[k], `${f} en ${k}`).toBe('string')
      }
    }
  })
  it('獨立數值頁的頁說明已移除(那兩頁不再出現在下拉選單)', () => {
    expect(en.page_note.map_numeric).toBeUndefined()
    expect(en.page_note.waystone_numeric).toBeUndefined()
  })
})

describe('數值區接線', () => {
  const panel = read('renderer/src/web/regex/RegexPanel.vue')
  const store = read('renderer/src/web/regex/store.ts')
  const algo = read('renderer/src/web/regex/RegexAlgoList.vue')
  const bm = read('renderer/src/web/regex/RegexBookmarks.vue')
  it('下拉選單只列清單頁(listed),勾選數含數值區', () => {
    expect(panel).toMatch(/v-for="p in listed"/)
    expect(panel).not.toMatch(/v-for="p in catalogue\.pages"/)
    expect(panel).toMatch(/pagePickCount\(p\)/)
  })
  it('宿主詞綴頁上方掛數值區,其後才是詞綴清單', () => {
    const i = panel.indexOf('<RegexNumericSection')
    expect(i).toBeGreaterThan(0)
    expect(panel.indexOf('<RegexList', i)).toBeGreaterThan(i)
  })
  it('合併與單頁輸出都走 combineSels;存檔 / 書籤 / 分享碼走 embed.ts 純函式', () => {
    // R10:合併改走 mergeSels(內部即 combineSels + 物品組篩選);單頁輸出與「有沒有勾選」仍直接用 combineSels
    expect(store.match(/combineSels\(cat\.pages, picks, ui\.numeric/g)?.length).toBeGreaterThanOrEqual(2)
    expect(store).toMatch(/mergeSels\(cat\.pages, picks, ui\.numeric/)
    for (const fn of ['savedPicksOf(', 'bookmarkBodyOf(', 'bookmarkApplyOf(', 'shareStateOf(', 'resolvedValues(']) {
      expect(store, fn).toContain(fn)
    }
    // 不能再把全部頁(含數值區)直接丟進 combine
    expect(store).not.toMatch(/cat\.pages\.filter\(p => \(picks\[p\.id\]/)
  })
  it('演算法列以 page.id 指定頁(不依賴目前頁),數值區用 embedded', () => {
    expect(algo).toMatch(/togglePickOn\(page\.id,/)
    expect(algo).toMatch(/clearPicksOn\(page\.id\)/)
    expect(algo).not.toMatch(/store\.picked\b/)
    expect(read('renderer/src/web/regex/RegexNumericSection.vue')).toMatch(/<RegexAlgoList v-if="!collapsed" :page="section" embedded \/>/)
  })
  it('只勾數值區也能存書籤', () => {
    expect(bm).toMatch(/:disabled="!pickedTotal"/)
  })
})
