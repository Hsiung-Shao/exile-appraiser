// 自訂書籤的介面接線與兩語字串(原始碼字串比對,不開瀏覽器)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** 取出以 `head` 開頭的頂層函式本體(到行首的 `}` 為止) */
function bodyOf (src: string, head: string): string {
  const i = src.indexOf(head)
  expect(i, `找不到 ${head}`).toBeGreaterThanOrEqual(0)
  const rest = src.slice(i)
  const end = rest.search(/^}/m)
  return end < 0 ? rest : rest.slice(0, end)
}

const KEYS = ['bm_custom_add', 'bm_custom_title_add', 'bm_custom_title_edit', 'bm_custom_text', 'bm_meta_custom', 'bm_edit', 'bm_save_output', 'bm_save_output_tip']

describe('自訂書籤接線', () => {
  it('T8 介面接線與兩語字串齊全', () => {
    const bookmarks = read('../src/web/regex/RegexBookmarks.vue')
    expect(bookmarks).toContain('data-regex="bm-custom-add"')
    expect(bookmarks).toContain('data-regex="bm-edit"')
    expect(bookmarks).toContain('data-regex="bm-custom-dialog"')
    // 自訂對話框要綁設定視窗的獨立字級
    expect(bookmarks).toMatch(/class="modal rx-modal" :class="fsClass" :style="fsStyle"[^>]*>\s*<div class="rx-dialog"[^>]*data-regex="bm-custom-dialog"/)

    expect(read('../src/web/regex/RegexPanel.vue')).toContain('data-regex="save-custom"')

    // 快捷送出:自訂書籤不需要載清單,判斷要在 catalogueFor 之前
    const q = bodyOf(read('../src/web/regex/quick.ts'), 'async function queryOf')
    const iCustom = q.indexOf('isCustomBookmark(')
    const iCat = q.indexOf('catalogueFor(')
    expect(iCustom).toBeGreaterThanOrEqual(0)
    expect(iCat).toBeGreaterThanOrEqual(0)
    expect(iCustom).toBeLessThan(iCat)

    const store = read('../src/web/regex/store.ts')
    expect(store).toContain('export function saveCustomBookmark')
    expect(store).toContain('export function updateCustomBookmark')
    expect(store).toContain('export const customBookmarkDraft')
    // 擋住用目前勾選覆寫自訂書籤
    expect(bodyOf(store, 'export function updateBookmark')).toContain('isCustomBookmark(')

    for (const [lang, file] of [['cmn-Hant', '../src/i18n/cmn-Hant.json'], ['en', '../src/i18n/en.json']] as const) {
      const regex = JSON.parse(read(file)).ppz.regex
      for (const k of KEYS) {
        expect(typeof regex[k], `${lang} ppz.regex.${k}`).toBe('string')
        expect(regex[k].trim().length, `${lang} ppz.regex.${k} 不可為空`).toBeGreaterThan(0)
      }
    }
  })
})
