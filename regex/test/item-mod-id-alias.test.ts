import { describe, expect, it } from 'vitest'
import { bookmarkApplyOf } from '../src/embed'
import { loadAllPagesFor, loadItemModData } from '../src/node'
import { algoEntryIndex, applyPageKeys, remapAlgoValues } from '../src/pages'
import { ITEM_MOD_PAGE_IDS, itemModPage } from '../src/pages/item-mods'
import { resolveState } from '../src/share'
import type { RegexPage } from '../src/data'
import type { AlgoPage } from '../src/pages/types'

/**
 * PoE1 規則 30(2026-11-24)把「插槽中的寶石被等級 # 的 X 輔助」固定 / 隨機兩列併成一列:
 * 物品詞綴數值頁原本第二條(隨機列)的 id 是 `X|ref`,併列後同一條詞綴的 id 變成 `X`。舊存檔 / 書籤 / 分享碼要照樣還原。
 */
const pages: RegexPage[] = [...loadAllPagesFor('poe1'), itemModPage('poe1', loadItemModData('poe1'))]
const page = pages.find(p => p.id === ITEM_MOD_PAGE_IDS.poe1) as AlgoPage
const NEW_ID = 'indexable_support_128'
const OLD_ID = `${NEW_ID}|Socketed Gems are Supported by Level # Added Chaos Damage (Random Support Gem)`

describe('物品詞綴數值頁:併列前的舊項目 id 照樣還原', () => {
  it('前提:現行資料只有新 id、沒有舊 id', () => {
    expect(page.entries.some(e => e.id === NEW_ID)).toBe(true)
    expect(page.entries.some(e => e.id === OLD_ID)).toBe(false)
  })

  it('勾選:舊 id 退回 `|` 前的 id;前段也不存在的照樣算還原不到', () => {
    const i = page.entries.findIndex(e => e.id === NEW_ID)
    expect(algoEntryIndex(page, OLD_ID)).toBe(i)
    expect(applyPageKeys(page, [OLD_ID])).toEqual({ picked: [i], missed: 0 })
    expect(applyPageKeys(page, ['explicit.no_such|x'])).toEqual({ picked: [], missed: 1 })
  })

  it('數值:舊 id 的值換到新 id;現行 id 已有值時不被舊值蓋掉', () => {
    expect(remapAlgoValues(page, { [OLD_ID]: { min: 3 } })).toEqual({ [NEW_ID]: { min: 3 } })
    expect(remapAlgoValues(page, { [OLD_ID]: { min: 3 }, [NEW_ID]: { min: 9 } })).toEqual({ [NEW_ID]: { min: 9 } })
  })

  it('書籤與分享碼:勾選與數值都還原到新 id', () => {
    const a = bookmarkApplyOf(pages, { name: 'x', page: page.id, game: 'poe1', mode: 'any', lang: 'zh', keys: [OLD_ID], alt: [''], numeric: { [OLD_ID]: { min: 5 } } })!
    expect(a.missed).toBe(0)
    expect(a.values[page.id]).toEqual({ [NEW_ID]: { min: 5 } })
    const r = resolveState({ v: 2, game: 'poe1', mode: 'any', pages: { [page.id]: [OLD_ID] }, sections: {}, numeric: { [page.id]: { [OLD_ID]: { min: 7 } } }, custom: [], excludes: [] }, pages)
    expect(r.values[page.id]).toEqual({ [NEW_ID]: { min: 7 } })
  })
})
