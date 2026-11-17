// 地圖詞綴檢查改用正則書籤上色(2026-11-18 使用者裁定):書籤篩選、勾到的詞綴 → 紅 / 綠、新舊寫法、設定讀寫。真實 data/regex 與 data/poe1,不送輸入。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pageKeysOf, parseRegexCatalogue, type RegexBookmark } from '@exile-appraiser/regex'
import { bookmarkLabels, bookmarkMarks, findMapCheckBookmark, mapCheckBookmarks, mapCheckRefAfterRename, mapCheckRefOf, markOfStat, normMapCheckBookmark, pickMapCheckBookmark } from '../src/web/map-check-bookmark'
import { _roundTripForTest } from '../src/web/Config'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const pages = parseRegexCatalogue(read('data/regex/regex_poe1.json'), 'poe1').pages
const stats = read('data/poe1/cmn-Hant/stats.ndjson').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)).flatMap((r: any) => r.stats ?? [r])
const statOf = (ref: string) => stats.find((s: any) => s.ref === ref)

/** 在某頁勾指定詞綴 id 存成書籤 */
function bookmark (name: string, page: string, mode: RegexBookmark['mode'], ids: string[], game: RegexBookmark['game'] = 'poe1'): RegexBookmark {
  const p = pages.find(x => x.id === page)!
  const picked = ids.map(id => p.entries.findIndex(e => e.id === id))
  expect(picked.every(i => i >= 0), `${page} ${ids.join(',')}`).toBe(true)
  return { name, page, game, mode, lang: 'zh', ...pageKeysOf(p, picked) }
}

describe('上色規則(R1、R2)', () => {
  it('排除書籤勾到的詞綴標紅,沒勾的不上色', () => {
    const m = bookmarkMarks(pages, bookmark('危險', 'map_mods', 'none', ['MapPoisoningMapWorlds']))!
    expect(markOfStat(m, statOf('Monsters Poison on Hit').matchers)).toBe('bad')
    expect(markOfStat(m, statOf('Monsters fire # additional Projectiles').matchers)).toBeNull()
  })

  it('any / all 書籤勾到的詞綴標綠', () => {
    for (const mode of ['any', 'all'] as const) {
      const m = bookmarkMarks(pages, bookmark('想要', 'map_mods', mode, ['MapMonsterMultipleProjectilesWorlds']))!
      expect(markOfStat(m, statOf('Monsters fire # additional Projectiles').matchers), mode).toBe('good')
    }
  })

  it('沒有書籤 → 不上色', () => {
    expect(bookmarkMarks(pages, undefined)).toBeNull()
    expect(markOfStat(null, statOf('Monsters Poison on Hit').matchers)).toBeNull()
  })
})

// R3(3.30 新舊寫法)在 renderer/test-vue/map-check-mount.test.ts:兩份剪貼簿解析出同一條詞綴,整條詞綴的 matcher 拿去比對

describe('書籤選單(R4)', () => {
  it('只列 PoE1、地圖 / 劫盜契約 / 探險日誌頁的書籤;自訂字串書籤與其他頁不列', () => {
    const list: RegexBookmark[] = [
      bookmark('地圖', 'map_mods', 'none', ['MapPoisoningMapWorlds']),
      { name: '契約', page: 'heist_contracts', game: 'poe1', mode: 'any', lang: 'zh', keys: [], alt: [] },
      { name: '日誌', page: 'logbook_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: [], alt: [] },
      { name: '藥劑', page: 'flask_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: [], alt: [] },
      { name: '自訂', page: '@custom', game: 'poe1', mode: 'any', lang: 'zh', keys: ['"x"'], alt: [] },
      { name: '二代', page: 'map_mods', game: 'poe2', mode: 'any', lang: 'zh', keys: [], alt: [] }
    ]
    expect(mapCheckBookmarks(list).map(b => b.name)).toEqual(['地圖', '契約', '日誌'])
  })
})

describe('同名書籤(審查第 3 輪)', () => {
  const a = { ...bookmark('危險', 'map_mods', 'none', ['MapPoisoningMapWorlds']), folder: 'T16' }
  const b = { ...bookmark('危險', 'map_mods', 'none', ['MapMonsterMultipleProjectilesWorlds']), folder: '契約' }
  const c = bookmark('想要', 'map_mods', 'any', ['MapPoisoningMapWorlds'])
  const list = [a, b, c]

  it('識別 = 資料夾 + 名稱,兩個同名書籤各自選得到', () => {
    expect(findMapCheckBookmark(list, mapCheckRefOf(a, list))).toBe(a)
    expect(findMapCheckBookmark(list, mapCheckRefOf(b, list))).toBe(b)
    expect(findMapCheckBookmark(list, null)).toBeUndefined()
  })

  it('資料夾對不上(書籤被移到別的資料夾)退回第一個同名', () => {
    expect(findMapCheckBookmark(list, { folder: '已刪的資料夾', name: '危險' })).toBe(a)
    expect(findMapCheckBookmark(list, { folder: '', name: '沒有這個' })).toBeUndefined()
  })

  it('同資料夾(都在未分類)的同名書籤:第二個也選得到,下拉文字加序號(審查第 4 輪)', () => {
    const x = bookmark('T16', 'map_mods', 'none', ['MapPoisoningMapWorlds'])
    const y = bookmark('T16', 'map_mods', 'any', ['MapMonsterMultipleProjectilesWorlds'])
    const two = [x, y]
    expect(mapCheckRefOf(y, two)).toEqual({ folder: '', name: 'T16', nth: 1 })
    expect(findMapCheckBookmark(two, mapCheckRefOf(x, two))).toBe(x)
    expect(findMapCheckBookmark(two, mapCheckRefOf(y, two))).toBe(y)
    expect(bookmarkLabels(two)).toEqual(['T16', 'T16 (2)'])
    // 第二個被刪掉 → 退回第一個同名
    expect(findMapCheckBookmark([x], { folder: '', name: 'T16', nth: 1 })).toBe(x)
  })

  it('下拉文字:同名的加資料夾區分,其他只顯示名稱;不重複', () => {
    const labels = bookmarkLabels(list)
    expect(labels).toEqual(['T16 / 危險', '契約 / 危險', '想要'])
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('正則書籤改名時一起更新(使用者要求)', () => {
  const mk = (name: string, folder?: string) => ({ ...bookmark(name, 'map_mods', 'none', ['MapPoisoningMapWorlds']), ...(folder ? { folder } : {}) })

  it('改名的是地圖檢查選中的書籤 → 設定跟著換名字', () => {
    const list = [mk('危險'), mk('想要')]
    expect(mapCheckRefAfterRename(list, { folder: '', name: '危險' }, 0, 'T16 危險')).toEqual({ folder: '', name: 'T16 危險' })
  })

  it('改的是別的書籤 → 不動設定(回 undefined)', () => {
    const list = [mk('危險'), mk('想要')]
    expect(mapCheckRefAfterRename(list, { folder: '', name: '危險' }, 1, '別的')).toBeUndefined()
    expect(mapCheckRefAfterRename(list, null, 0, '別的')).toBeUndefined()
  })

  it('同資料夾同名:改掉前一個,選中的第二個仍對得到;別的書籤改成同名搶到前面也還是原本那個', () => {
    const list = [mk('T16'), mk('T16')]
    // 選第二個(nth 1),把第一個改名 → 第二個變成唯一的 T16(nth 0)
    expect(mapCheckRefAfterRename(list, { folder: '', name: 'T16', nth: 1 }, 0, 'X')).toEqual({ folder: '', name: 'T16' })
    const three = [mk('A'), mk('T16')]
    // 選 T16(index 1),把 index 0 改成 T16 → 原本那個變成同名第二個
    expect(mapCheckRefAfterRename(three, { folder: '', name: 'T16' }, 0, 'T16')).toEqual({ folder: '', name: 'T16', nth: 1 })
  })

  it('非地圖頁的書籤改名不影響', () => {
    const list = [mk('危險'), { name: '藥劑', page: 'flask_mods', game: 'poe1' as const, mode: 'any' as const, lang: 'zh' as const, keys: [], alt: [] }]
    expect(mapCheckRefAfterRename(list, { folder: '', name: '危險' }, 1, '危險')).toBeUndefined()
  })
})

describe('只有一個地圖書籤時自動選它(使用者要求)', () => {
  const one = bookmark('唯一', 'map_mods', 'none', ['MapPoisoningMapWorlds'])
  const two = bookmark('第二', 'map_mods', 'any', ['MapPoisoningMapWorlds'])
  it('沒選過(null)且只有一個 → 用它;兩個以上不猜', () => {
    expect(pickMapCheckBookmark([one], null)).toBe(one)
    expect(pickMapCheckBookmark([one, two], null)).toBeUndefined()
  })
  it('明確選「不上色」(false)→ 不自動選', () => {
    expect(pickMapCheckBookmark([one], false)).toBeUndefined()
  })
  it('選過的照選過的;選的已刪掉 → 也退回唯一那個', () => {
    expect(pickMapCheckBookmark([one, two], { folder: '', name: '第二' })).toBe(two)
    expect(pickMapCheckBookmark([one], { folder: '', name: '已刪' })).toBe(one)
  })
  it('設定讀寫:false 原樣保留', () => {
    expect(normMapCheckBookmark(false)).toBe(false)
    const { serialized } = _roundTripForTest(JSON.stringify({ mapCheckBookmark: false }))
    expect(JSON.parse(serialized).mapCheckBookmark).toBe(false)
  })
})

describe('設定讀寫(R6)', () => {
  it('沒有 / 壞值 → null;{ folder, name } 原樣讀回', () => {
    for (const bad of [undefined, null, '', '   ', 3, {}, { name: '' }, { folder: 1, name: 'x' }]) expect(normMapCheckBookmark(bad), JSON.stringify(bad)).toBeNull()
    expect(normMapCheckBookmark({ name: '危險' })).toEqual({ folder: '', name: '危險' })
    expect((_roundTripForTest('{"game":"poe1"}').config as any).mapCheckBookmark).toBeNull()
    const v = { folder: 'T16', name: '危險詞綴' }
    const { config, serialized } = _roundTripForTest(JSON.stringify({ mapCheckBookmark: v }))
    expect((config as any).mapCheckBookmark).toEqual(v)
    expect(JSON.parse(serialized).mapCheckBookmark).toEqual(v)
    // 舊版獨立標記的設定不再讀寫
    expect(JSON.parse(serialized).mapCheck).toBeUndefined()
  })
})
