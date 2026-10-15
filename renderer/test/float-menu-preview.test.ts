/** 懸浮選單書籤預覽快取:模組層級、鍵含全部內容欄位、資料狀態改變失效、讓出主執行緒 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPreviewCache, previewCacheKey } from '../src/web/overlay/float-menu-preview'

const ROOT = path.resolve(__dirname, '../..')
const vue = fs.readFileSync(path.join(ROOT, 'renderer/src/web/overlay/FloatMenu.vue'), 'utf8')

function setup (limit?: number) {
  const bms: Record<string, unknown>[] = [{ game: 'poe1', page: 'p', keys: ['a'], mode: 'any', lang: 'zh', hotkey: 'F1', folder: 'x', numeric: { a: 5 } }]
  let tag = 'idle'
  let calls = 0
  const cache = createPreviewCache({ bookmarkAt: i => bms[i], stateTag: () => tag, compute: async () => { calls++; return `q${calls}` }, limit })
  return { bms, cache, calls: () => calls, setTag: (t: string) => { tag = t } }
}

describe('懸浮選單書籤預覽快取', () => {
  it('同一書籤第二次載入不再重算', async () => {
    const s = setup()
    const a = await s.cache.ensure(0)
    const b = await s.cache.ensure(0)
    expect(b).toBe(a)
    expect(s.calls()).toBe(1)
    expect(s.cache.peek(0)).toBe(a)
  })
  it('只改 hotkey 或 folder 不影響快取鍵', () => {
    const b = { game: 'poe1', page: 'p', keys: ['a'], hotkey: 'F1', folder: 'x' }
    expect(previewCacheKey({ ...b, hotkey: 'F2', folder: 'y' }, 't')).toBe(previewCacheKey(b, 't'))
  })
  it('數值欄位不同時快取鍵不同', () => {
    const b = { game: 'poe1', page: 'p', keys: ['a'], numeric: { a: 5 } }
    expect(previewCacheKey({ ...b, numeric: { a: 6 } }, 't')).not.toBe(previewCacheKey(b, 't'))
  })
  it('書籤數值改變後會重算', async () => {
    const s = setup()
    await s.cache.ensure(0)
    s.bms[0] = { ...s.bms[0], numeric: { a: 9 } }
    expect(s.cache.peek(0)).toBeUndefined()
    await s.cache.ensure(0)
    expect(s.calls()).toBe(2)
  })
  it('資料載入狀態改變時快取失效', async () => {
    const s = setup()
    await s.cache.ensure(0)
    s.setTag('ready')
    expect(s.cache.peek(0)).toBeUndefined()
    await s.cache.ensure(0)
    expect(s.calls()).toBe(2)
  })
  it('空字串結果不快取', async () => {
    const cache = createPreviewCache({ bookmarkAt: () => ({ game: 'poe1' }), stateTag: () => 't', compute: async () => '' })
    await cache.ensure(0)
    expect(cache.size).toBe(0)
  })
  it('超過上限就清空重來', async () => {
    const bms = Array.from({ length: 5 }, (_, i) => ({ game: 'poe1', page: String(i) }))
    const cache = createPreviewCache({ bookmarkAt: i => bms[i], stateTag: () => 't', compute: async i => `v${i}`, limit: 3 })
    for (let i = 0; i < 5; i++) await cache.ensure(i)
    expect(cache.size).toBeLessThanOrEqual(3)
  })
  it('FloatMenu 改用模組層級快取且每筆之間讓出主執行緒', () => {
    expect(vue).toContain('sharedPreviewCache')
    expect(vue).not.toMatch(/await regexBookmarkPreview\(/)
    expect(vue).toMatch(/setTimeout\(r, 0\)/)
  })
})
