// wiki 熱鍵:開啟流程、設定欄位、熱鍵總表與字串、App.vue 接線。純函式 / 讀原始碼,不開瀏覽器、不送輸入。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { openItemOnPoedb } from '../src/web/poedb-open'
import { _roundTripForTest } from '../src/web/Config'
import { OPTIONAL_HOTKEY_FIELDS, hotkeyTable } from '../src/web/settings/hotkey-table'
import { hotkeySlots, type HotkeyConfigLike } from '../src/web/settings/hotkey-conflicts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

describe('設定往返(W7)', () => {
  it('W7 全新與舊設定檔(沒有 hotkeyWiki)→ 空字串,且寫進檔', () => {
    for (const raw of [null, '{"game":"poe1"}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect((config as any).hotkeyWiki).toBe('')
      expect(JSON.parse(serialized).hotkeyWiki).toBe('')
    }
  })

  it('W7 壞值(非字串)→ 回空字串', () => {
    for (const bad of [123, null, { a: 1 }, ['x']]) {
      const { config } = _roundTripForTest(JSON.stringify({ hotkeyWiki: bad }))
      expect((config as any).hotkeyWiki, JSON.stringify(bad)).toBe('')
    }
  })

  it('W7 設過的值讀得回來、寫得出去', () => {
    const { config, serialized } = _roundTripForTest(JSON.stringify({ hotkeyWiki: 'Ctrl + Shift + W' }))
    expect((config as any).hotkeyWiki).toBe('Ctrl + Shift + W')
    expect(JSON.parse(serialized).hotkeyWiki).toBe('Ctrl + Shift + W')
    expect((_roundTripForTest(serialized).config as any).hotkeyWiki).toBe('Ctrl + Shift + W')
  })
})

describe('熱鍵總表與衝突檢查(W8)', () => {
  function fullConfig (game: 'poe1' | 'poe2'): HotkeyConfigLike {
    return {
      hotkey: 'D', hotkeyHold: 'Ctrl', hotkeyLocked: 'Ctrl + Alt + D', overlayKey: 'Shift + Space', game,
      hotkeyOcrReveal: 'Ctrl + Shift + R', hotkeyOcrRegion: '', hotkeyRuneshapeToggle: '', hotkeyRuneshapeRegion: '',
      revealAutoEnabled: true, runeshapeEnabled: true, hotkeyStashToggle: '', hotkeyStashRegion: '', stashPricesEnabled: true,
      commands: [], stashSearch: [], hotkeyRegexQuick: '', regexBookmarkHotkeys: [],
      hotkeyPoedb: 'Ctrl + Shift + Q', hotkeyWiki: 'ctrl+shift+w', hotkeyTimerToggle: 'F1', hotkeyTimerReset: 'F2'
    } as HotkeyConfigLike
  }

  it('W8 overlay 與 window 模式:tools 群組 poedb 的下一列是 wiki(欄位 hotkeyWiki、選填)', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      for (const overlay of [true, false]) {
        const g = hotkeyTable(fullConfig(game), { overlay }).find(x => x.id === 'tools')
        expect(g, `${game} overlay=${overlay}`).toBeDefined()
        const i = g!.rows.findIndex(r => r.id === 'poedb')
        expect(i, `${game} overlay=${overlay} 要有 poedb`).toBeGreaterThan(-1)
        const next = g!.rows[i + 1]
        expect(next, `${game} overlay=${overlay} poedb 後面要有一列`).toBeDefined()
        expect(next.kind === 'edit' ? [next.id, next.field, next.optional === true] : next.id).toEqual(['wiki', 'hotkeyWiki', true])
      }
    }
  })

  it('W8 hotkeyWiki 列入選填熱鍵清單', () => {
    expect(OPTIONAL_HOTKEY_FIELDS).toContain('hotkeyWiki')
  })

  it('W8 衝突檢查涵蓋 wiki,且值經正規化', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      expect(hotkeySlots(fullConfig(game)).find(s => s.id === 'wiki')?.hotkey, game).toBe('Ctrl + Shift + W')
    }
  })
})

describe('wiki 事件開網頁(W9)', () => {
  const mk = (resolveUrl: (t: string) => Promise<string | null>) => {
    const open = vi.fn()
    const log = vi.fn()
    return { open, log, deps: { resolveUrl, open, log, tag: 'wiki' } }
  }
  const expectWikiLog = (log: ReturnType<typeof vi.fn>) => {
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toMatch(/^\[wiki\]/)
    expect(log.mock.calls[0][0]).not.toMatch(/^\[poedb\]/)
  }

  it('W9 解析不出物品(null)→ 不開網頁、log 以 [wiki] 開頭', async () => {
    const { open, log, deps } = mk(async () => null)
    expect(await openItemOnPoedb('clip', deps)).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expectWikiLog(log)
  })

  it('W9 resolveUrl 丟例外 → 不往外拋、不開網頁、log 以 [wiki] 開頭', async () => {
    const { open, log, deps } = mk(async () => { throw new Error('parse boom') })
    await expect(openItemOnPoedb('clip', deps)).resolves.toBe(false)
    expect(open).not.toHaveBeenCalled()
    expectWikiLog(log)
  })

  it('W9 App.vue 原始碼同時用到 wikiUrl 與 poe2wikiUrl', () => {
    const app = read('renderer/src/web/App.vue')
    expect(app).toMatch(/\bwikiUrl\b/)
    expect(app).toContain('poe2wikiUrl')
  })

  it('W9 ppz.hk.wiki 兩語都是非空字串', () => {
    for (const file of ['cmn-Hant', 'en']) {
      const v = JSON.parse(read(`renderer/src/i18n/${file}.json`)).ppz?.hk?.wiki
      expect(typeof v, `${file} ppz.hk.wiki`).toBe('string')
      expect((v as string).trim().length, `${file} ppz.hk.wiki`).toBeGreaterThan(0)
    }
  })
})
