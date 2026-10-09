// R10(2026-10-09):「已選(合併)」只併目前頁的物品組、未併入提示、稀有度 / 汙染條件矛盾(conditionClash)的說明。
// 邏輯在 regex/src(sections.ts planMerge、embed.ts mergeSels、combine.ts;regex/test/merge-group.test.ts 驗);
// 這裡守接線與字串:store 合併走 mergeSels(不在 store 另寫一套)、元件用到的鍵兩語都有且參數一致。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

const KEYS: Record<string, string[]> = {
  conflict_conditionClash: ['page', 'text'],
  merge_skipped: ['n'],
  combined_empty_group: ['n'],
  condition_clash_out: []
}

describe('R10 合併只併同組:字串', () => {
  const zh = JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz.regex
  const en = JSON.parse(read('renderer/src/i18n/en.json')).ppz.regex
  it('中英文新鍵都有、參數與預期相同', () => {
    for (const [k, want] of Object.entries(KEYS)) {
      expect(typeof zh[k], `cmn-Hant ppz.regex.${k}`).toBe('string')
      expect(typeof en[k], `en ppz.regex.${k}`).toBe('string')
      expect(params(zh[k]), `zh ${k}`).toEqual(want)
      expect(params(en[k]), `en ${k}`).toEqual(want)
    }
  })
  it('繁中文案:未併入提示與矛盾說明', () => {
    expect(zh.merge_skipped).toContain('未併入')
    expect(zh.condition_clash_out).toContain('互相矛盾')
  })
})

describe('R10 合併只併同組:接線', () => {
  const store = read('renderer/src/web/regex/store.ts')
  const combinedVue = read('renderer/src/web/regex/RegexCombined.vue')
  const panelVue = read('renderer/src/web/regex/RegexPanel.vue')
  it('store 的合併輸入走 mergeSels(目前頁 id),並對外提供未併入頁數', () => {
    expect(store).toMatch(/mergeSels\(cat\.pages, picks, ui\.numeric, /)
    expect(store).toMatch(/mergeSkipped/)
    // 合併輸出不再直接用「全部有勾選的頁」
    expect(store).not.toMatch(/pages: combineSels\(cat\.pages, picks, ui\.numeric\),/)
  })
  it('合併檢視顯示未併入提示、空狀態分兩種;全部清除仍看所有勾選', () => {
    expect(combinedVue).toMatch(/'ppz\.regex\.merge_skipped'/)
    expect(combinedVue).toMatch(/'ppz\.regex\.combined_empty_group'/)
    expect(combinedVue).toMatch(/anyPicked/)
  })
  it('輸出區:conditionClash 時顯示矛盾說明、合併範圍時顯示未併入提示', () => {
    expect(panelVue).toMatch(/'ppz\.regex\.condition_clash_out'/)
    expect(panelVue).toMatch(/'ppz\.regex\.merge_skipped'/)
    expect(panelVue).toMatch(/conditionClash/)
  })
})
