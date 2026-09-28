// 書籤與記憶狀態:改寫自 regex_selftest.cpp StateTests()(:352–509)的 T11 與 T12
// (T12 的檔案 IO 改成字串往返;原子寫入由呼叫端負責)。
import { describe, expect, it } from 'vitest'
import {
  applyKeys, collectKeys, defaultRegexState, parseRegexState, picksFor, resolveKeys, serializeRegexState, type RegexBookmark
} from '../src/state'
import { loadRegexCatalogueFile } from '../src/node'

describe('T11 saved picks resolve by the English line, and misses are counted(:354)', () => {
  const enNow = ['Monsters cannot be Leeched from', 'Monsters have increased Damage', 'Area is haunted']
  const zhNow = ['怪物不能被吸取', '怪物增加傷害', '區域鬧鬼']
  it('an unchanged entry comes back on the right row', () => {
    const r = resolveKeys(['Area is haunted'], ['區域鬧鬼'], enNow, zhNow)
    expect(r).toEqual({ picked: [false, false, true], missed: 0 })
  })
  it('a reworded English line still resolves through the Chinese one', () => {
    const r = resolveKeys(['Monsters have #% increased Damage'], ['怪物增加傷害'], enNow, zhNow)
    expect(r).toEqual({ picked: [false, true, false], missed: 0 })
  })
  it('an entry that no longer exists is counted, not ignored / and it does not tick something else', () => {
    const r = resolveKeys(['Area contains a Breach'], ['區域內有裂痕'], enNow, zhNow)
    expect(r).toEqual({ picked: [false, false, false], missed: 1 })
  })
  it('a mixed selection keeps what it can and counts what it cannot', () => {
    const r = resolveKeys(['Area is haunted', 'Gone', 'Monsters cannot be Leeched from'], ['區域鬧鬼', '沒了', '怪物不能被吸取'], enNow, zhNow)
    expect(r).toEqual({ picked: [true, false, true], missed: 1 })
  })
})

describe('T12 the state survives a round trip(:392)', () => {
  it('defaults are usable', () => {
    const a = defaultRegexState()
    expect(a.mode).toBe('any')
    expect(a.bookmarks).toEqual([])
  })
  it('page, mode, game, ticks and bookmark survive; deletes stay deleted', () => {
    const a = defaultRegexState()
    a.game = 'poe1'
    a.page = 'map_mods'
    a.mode = 'none'
    const picks = picksFor(a, 'map_mods')
    picks.keys = ['Monsters cannot be Leeched from']
    picks.alt = ['怪物不能被吸取']
    picksFor(a, 'logbook_mods') // 沒勾的頁不寫進檔案
    const bm: RegexBookmark = {
      name: '危險詞綴',
      page: 'map_mods',
      game: 'poe1',
      mode: 'none',
      lang: 'zh',
      keys: ['Monsters cannot be Leeched from', 'Players are Cursed with Enfeeble'],
      alt: ['怪物不能被吸取', '玩家被虛弱詛咒']
    }
    a.bookmarks.push(bm)
    const b = parseRegexState(serializeRegexState(a))
    expect(b.ok).toBe(true)
    expect(b.state.page).toBe(a.page)
    expect(b.state.mode).toBe(a.mode)
    expect(b.state.game).toBe(a.game)
    expect(b.state.current).toEqual([{ page: 'map_mods', keys: picks.keys, alt: picks.alt }])
    expect(b.state.bookmarks).toEqual([bm])
    b.state.bookmarks = []
    expect(parseRegexState(serializeRegexState(b.state)).state.bookmarks).toEqual([])
  })
  it('a corrupt file is refused and leaves nothing half-read behind', () => {
    const r = parseRegexState('{ this is not json')
    expect(r.ok).toBe(false)
    expect(r.state.bookmarks).toEqual([])
    expect(r.state.current).toEqual([])
  })
  it('a mode this build does not know falls back to one it does', () => {
    expect(parseRegexState('{"page":"x","mode":"someday","bookmarks":[]}').state.mode).toBe('any')
  })
  it('a file from before the game split loads with the game left empty (not guessed)', () => {
    const f = parseRegexState('{"page":"map_mods","mode":"any","bookmarks":[{"name":"x","page":"waystone_mods","keys":["a"],"alt":["b"]}]}')
    expect(f.ok).toBe(true)
    expect(f.state.game).toBe('')
    expect(f.state.bookmarks.length).toBe(1)
    expect(f.state.bookmarks[0].game).toBe('')
  })
  it('a game this build does not know is dropped, not carried', () => {
    expect(parseRegexState('{"game":"poe3","page":"x","bookmarks":[]}').state.game).toBe('')
  })
  it('nameless / pageless / keyless bookmarks are not offered', () => {
    const s = parseRegexState('{"bookmarks":[{"name":"","page":"p","keys":["a"]},{"name":"n","page":"","keys":["a"]},{"name":"n","page":"p","keys":[]}]}')
    expect(s.state.bookmarks).toEqual([])
  })
})

describe('(port) page-level keys ↔ picks on shipped data', () => {
  it('collectKeys → applyKeys returns the same rows (poe1 map_mods)', () => {
    const page = loadRegexCatalogueFile('poe1').pages[0]
    const picked = [3, 17, 42, 99]
    const { keys, alt } = collectKeys(page, picked)
    expect(keys.every(k => k.length > 0)).toBe(true)
    expect(applyKeys(page, keys, alt)).toEqual({ picked, missed: 0 })
  })
})
