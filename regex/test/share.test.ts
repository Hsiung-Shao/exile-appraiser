// share.ts:分享碼往返、解碼驗證、範本檔;state.ts schema 2 / 3。
// 第 32 步:分享碼 v2(數值條件在 `sections` / `numeric[宿主頁]`);v1 舊碼的遷移往返在 sections.test.ts。
import { describe, expect, it } from 'vitest'
import { loadAllPagesFor, loadTemplatesFile } from '../src/node'
import {
  base64url, decodeShare, encodeShare, fromBase64url, normalizeShareState, parseTemplates, resolveState, type ShareState
} from '../src/share'
import { defaultRegexState, parseRegexState, serializeRegexState } from '../src/state'
import { applyPageKeys, pageKeysOf } from '../src/pages'
import { combine } from '../src/combine'

const sample: ShareState = {
  v: 2,
  game: 'poe1',
  mode: 'none',
  pages: { map_mods: ['#% more Monster Life', 'Monsters Blind on Hit'] },
  sections: { map_mods: ['tier', 'quantity'] },
  numeric: { map_mods: { tier: { min: 16 }, quantity: { min: 80, max: 150 } } },
  custom: ['自訂 一', 'Custom "two"'],
  excludes: ['反射', '無法回復']
}

describe('base64url', () => {
  it('任意位元組往返(0–300 長度)', () => {
    for (let n = 0; n <= 300; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255)
      const s = base64url(b)
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/)
      expect(Array.from(fromBase64url(s))).toEqual(Array.from(b))
    }
  })
})

describe('分享碼', () => {
  it('encode → decode 往返相同', async () => {
    const code = await encodeShare(sample)
    expect(code).toMatch(/^H4sI[A-Za-z0-9_-]+$/)
    const d = await decodeShare(code)
    expect(d.warnings).toEqual([])
    expect(d.state).toEqual(sample)
  })
  it('前後空白、換行容忍', async () => {
    const code = await encodeShare(sample)
    expect((await decodeShare(`  ${code.slice(0, 20)}\n${code.slice(20)}  `)).state).toEqual(sample)
  })
  it('版本不符 / 遊戲不明 / 壞碼 → 丟例外', async () => {
    expect(() => normalizeShareState({ ...sample, v: 3 })).toThrow(/版本/)
    expect(() => normalizeShareState({ ...sample, v: 1 })).not.toThrow()
    expect(() => normalizeShareState({ ...sample, game: 'poe3' })).toThrow(/遊戲/)
    await expect(decodeShare('not-a-code')).rejects.toThrow()
    await expect(decodeShare('')).rejects.toThrow()
  })
  it('未知欄位忽略並回報;型別不符的欄位丟掉並回報', () => {
    const r = normalizeShareState({ ...sample, extra: 1, custom: 'oops', numeric: { map_numeric: { tier: 5 } } })
    expect(r.warnings.some(w => w.includes('extra'))).toBe(true)
    expect(r.warnings.some(w => w.includes('custom'))).toBe(true)
    expect(r.warnings.some(w => w.includes('numeric.map_numeric.tier'))).toBe(true)
    expect(r.state.custom).toEqual([])
  })
  it('resolveState:勾選與數值還原到目前清單;不存在的頁與鍵計數', () => {
    const pages = loadAllPagesFor('poe1')
    const r = resolveState({ ...sample, pages: { ...sample.pages, gone_page: ['x'], map_mods: [...sample.pages.map_mods, 'no such mod'] } }, pages)
    expect(r.unknownPages).toEqual(['gone_page'])
    expect(r.missed).toBe(2)
    expect(r.picks.map_mods.length).toBe(2)
    expect(r.picks.map_numeric.length).toBe(2)
    expect(r.values.map_numeric.quantity).toEqual({ min: 80, max: 150 })
  })
  it('勾選 → 分享碼 → 清空 → 貼上:同一串 query', async () => {
    const pages = loadAllPagesFor('poe1')
    const mm = pages.find(p => p.id === 'map_mods')!
    const mn = pages.find(p => p.id === 'map_numeric')!
    const picks = { map_mods: [3, 17, 40], map_numeric: [0, 1] }
    const values = { tier: { min: 16 }, quantity: { min: 80 } }
    const before = combine({ lang: 'zh', mode: 'any', pages: [{ page: mm, picks: picks.map_mods }, { page: mn, picks: picks.map_numeric, values }], excludes: ['反射'] })
    const code = await encodeShare({
      v: 2, game: 'poe1', mode: 'any',
      pages: { map_mods: pageKeysOf(mm, picks.map_mods).keys },
      sections: { map_mods: pageKeysOf(mn, picks.map_numeric).keys },
      numeric: { map_mods: values }, custom: [], excludes: ['反射']
    })
    const d = await decodeShare(code)
    const r = resolveState(d.state, pages)
    const after = combine({ lang: 'zh', mode: d.state.mode, pages: [{ page: mm, picks: r.picks.map_mods }, { page: mn, picks: r.picks.map_numeric, values: r.values.map_numeric }], excludes: d.state.excludes })
    expect(after.query).toBe(before.query)
    expect(applyPageKeys(mn, d.state.sections.map_mods).picked).toEqual([0, 1])
  })
})

describe('範本 data/regex/templates.json', () => {
  const templates = loadTemplatesFile()
  it('7 個範本、兩個遊戲都有、雙語名稱', () => {
    expect(templates.length).toBe(7)
    expect(templates.filter(t => t.game === 'poe1').length).toBe(5)
    expect(templates.filter(t => t.game === 'poe2').length).toBe(2)
    for (const t of templates) {
      expect(t.name.zh && t.name.en && t.desc.zh && t.desc.en).toBeTruthy()
    }
  })
  for (const t of loadTemplatesFile()) {
    it(`${t.id}:每個鍵都還原得到,產生的字串 Verify ok`, () => {
      const pages = loadAllPagesFor(t.game)
      const r = resolveState(t.state, pages)
      expect(r.unknownPages).toEqual([])
      expect(r.missed).toBe(0)
      const sels = Object.entries(r.picks).map(([id, picks]) => ({ page: pages.find(p => p.id === id)!, picks, values: r.values[id] }))
      for (const lang of ['zh', 'en'] as const) {
        const c = combine({ lang, mode: t.state.mode, pages: sels, custom: t.state.custom, excludes: t.state.excludes })
        expect(c.query.length).toBeGreaterThan(0)
        expect(c.conflicts, `${t.id} ${lang}`).toEqual([])
        expect(c.length).toBeLessThanOrEqual(c.limit)
      }
    })
  }
  it('T17 危險詞綴範本 = 8 個勾選、None 模式', () => {
    const t = templates.find(x => x.id === 'poe1_t17_danger')!
    expect(t.state.mode).toBe('none')
    expect(resolveState(t.state, loadAllPagesFor('poe1')).picks.map_mods.length).toBe(8)
  })
  it('壞掉的範本只略過那一筆', () => {
    const r = parseTemplates({ templates: [{ id: 'ok', game: 'poe1', mode: 'any', pages: {} }, { id: 'bad', game: 'x' }, 5] })
    expect(r.templates.map(t => t.id)).toEqual(['ok'])
    expect(r.errors.length).toBe(2)
  })
})

describe('state schema 2 / 3', () => {
  it('numeric / custom / excludes / outScope / collapsed / 書籤 numeric + num 往返', () => {
    const s = defaultRegexState()
    s.numeric = { map_mods: { tier: { min: 16 } }, vendor_items: { links: { choice: '6' } } }
    s.custom = ['x']
    s.excludes = ['反射']
    s.outScope = 'page'
    s.collapsed = ['map_mods']
    s.current.push({ page: 'map_mods', keys: [], alt: [], num: ['tier'] })
    s.bookmarks.push({ name: 'b', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: [], alt: [], numeric: { tier: { min: 16 } }, num: ['tier'] })
    s.bookmarks.push({ name: 'v', page: 'vendor_items', game: 'poe1', mode: 'any', lang: 'zh', keys: ['links'], alt: ['連結'], numeric: { links: { choice: '6' } } })
    const text = serializeRegexState(s)
    expect(JSON.parse(text).schema).toBe(5) // 第 33 步起 4、第 36 步起 5
    const r = parseRegexState(text)
    expect(r.ok).toBe(true)
    expect(r.state).toEqual(s)
  })
  it('schema 1 舊檔照讀:新欄位 = 預設值', () => {
    const old = JSON.stringify({ schema: 1, game: 'poe1', page: 'map_mods', mode: 'none', lang: 'zh', bilingual: true, current: [], bookmarks: [] })
    const r = parseRegexState(old)
    expect(r.ok).toBe(true)
    expect(r.state.numeric).toEqual({})
    expect(r.state.custom).toEqual([])
    expect(r.state.excludes).toEqual([])
    expect(r.state.outScope).toBe('combined')
    expect(r.state.collapsed).toEqual([])
    expect(r.state.mode).toBe('none')
  })
})

describe('解碼上限(一鍵從 PobTools 送分享碼;與 PobTools regex_share.h 相同)', () => {
  it('分享碼超過字元上限直接拒絕(不解壓)', async () => {
    const { SHARE_MAX_CODE_CHARS, decodeShare } = await import('../src/share')
    expect(SHARE_MAX_CODE_CHARS).toBe(4 * 1024 * 1024)
    await expect(decodeShare('A'.repeat(SHARE_MAX_CODE_CHARS + 1))).rejects.toThrow('分享碼太長')
  })
  it('解壓後超過位元組上限拒絕(壓縮炸彈)', async () => {
    const { SHARE_MAX_JSON_BYTES, base64url, decodeShare } = await import('../src/share')
    expect(SHARE_MAX_JSON_BYTES).toBe(8 * 1024 * 1024)
    const zeros = new Uint8Array(SHARE_MAX_JSON_BYTES + 1024)
    const gz = new Uint8Array(await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
    await expect(decodeShare(base64url(gz))).rejects.toThrow('解壓後超過')
  })
})
