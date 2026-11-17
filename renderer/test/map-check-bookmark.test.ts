// 地圖詞綴檢查改用正則書籤上色(2026-11-18 使用者裁定):書籤篩選、勾到的詞綴 → 紅 / 綠、新舊寫法、設定讀寫。真實 data/regex 與 data/poe1,不送輸入。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pageKeysOf, parseRegexCatalogue, type RegexBookmark } from '@exile-appraiser/regex'
import { bookmarkLabels, bookmarkMarks, findMapCheckBookmark, mapCheckBookmarks, mapCheckRefOf, markOfStat, normMapCheckBookmark } from '../src/web/map-check-bookmark'
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
    expect(findMapCheckBookmark(list, mapCheckRefOf(a))).toBe(a)
    expect(findMapCheckBookmark(list, mapCheckRefOf(b))).toBe(b)
    expect(findMapCheckBookmark(list, null)).toBeUndefined()
  })

  it('資料夾對不上(書籤被移到別的資料夾)退回第一個同名', () => {
    expect(findMapCheckBookmark(list, { folder: '已刪的資料夾', name: '危險' })).toBe(a)
    expect(findMapCheckBookmark(list, { folder: '', name: '沒有這個' })).toBeUndefined()
  })

  it('下拉文字:同名的加資料夾區分,其他只顯示名稱;不重複', () => {
    const labels = bookmarkLabels(list)
    expect(labels).toEqual(['T16 / 危險', '契約 / 危險', '想要'])
    expect(new Set(labels).size).toBe(labels.length)
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
