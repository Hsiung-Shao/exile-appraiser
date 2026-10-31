// 商店頁插槽 / 連結改版:連結 / 顏色片段不再用 `.`,連結類勾選「任一成立」併成一個 term(anyGroup 'sockets'),屬性類各自一個 AND term。
// V1–V7;API 見 regex/src/pages/frag.ts(linkedSockets / coloredLinks / rgbGroup / linkColors)與 vendor-pages.ts。
import { describe, expect, it } from 'vitest'
import { combine } from '../src/combine'
import { loadAllPagesFor } from '../src/node'
import { coloredLinks, linkColors, linkedSockets, rgbGroup } from '../src/pages'
import { decodeShare, encodeShare, resolveState } from '../src/share'
import type { RegexPage } from '../src/data'

/** 以 JS 正則(不分大小寫,同遊戲搜尋)比對 */
const hits = (frag: string | null, lines: string[]): boolean[] => {
  expect(frag, '片段不可為 null').not.toBeNull()
  const re = new RegExp(frag!, 'i')
  return lines.map(l => re.test(l))
}

/** 查詢字串切成 term(引號內為一個 term) */
function terms (q: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (const ch of q) {
    if (ch === '"') { inQuote = !inQuote; continue }
    if (ch === ' ' && !inQuote) { if (cur) out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

describe('V1 任意 n 連不再用萬用字元', () => {
  it('n=2..6 回傳片段,不含 `.`', () => {
    for (let n = 2; n <= 6; n++) {
      const f = linkedSockets(n)
      expect(f, `n=${n}`).not.toBeNull()
      expect(f!.includes('.'), `n=${n} 片段 ${f}`).toBe(false)
    }
  })
  it('n=1、7 回 null', () => {
    expect(linkedSockets(1)).toBeNull()
    expect(linkedSockets(7)).toBeNull()
  })
})

describe('V2 任意 3 連只中插槽行', () => {
  it('中 R-G-B、R-G-B-W、Sockets: R-G-B;不中斷開的、物理傷害、元素傷害、x-y-z', () => {
    const lines = ['插槽: R-G-B', '插槽: R-G-B-W', '插槽: R-G B', '物理傷害: 10-20', '元素傷害: 5-10, 3-6', 'x-y-z', 'Sockets: R-G-B']
    expect(hits(linkedSockets(3), lines)).toEqual([true, true, false, false, false, false, true])
  })
})

describe('V3 全彩 n 連排除白插槽', () => {
  it('coloredLinks(3):中 R-G-B 與帶白尾巴的 R-G-B-W;不中 R-W-B', () => {
    expect(hits(coloredLinks(3), ['插槽: R-G-B', '插槽: R-W-B', '插槽: R-G-B-W'])).toEqual([true, false, true])
  })
})

describe('V4 指定顏色相鄰照舊', () => {
  it("linkColors('rrg'):中 R-R-G、R-G-R;不中 R-B-R-G", () => {
    expect(hits(linkColors('rrg'), ['插槽: R-R-G', '插槽: R-G-R', '插槽: R-B-R-G'])).toEqual([true, true, false])
  })
})

describe('V5 紅綠藍同組不必相鄰', () => {
  it("rgbGroup('插槽'):中 R-B-B-G、R-G-B;不中 R-G B(藍在別組)、Bringer of Rain、物品等級", () => {
    const f = rgbGroup('插槽')
    expect(f, '片段不可為 null').not.toBeNull()
    expect(f!.startsWith('插槽'), `片段 ${f}`).toBe(true)
    expect(f!.includes('(?='), `片段 ${f}`).toBe(true)
    expect(hits(f, ['插槽: R-B-B-G', '插槽: R-G B', '插槽: R-G-B', 'Bringer of Rain', '物品等級: 85'])).toEqual([true, false, true, false, false])
  })
})

describe('商店頁組合', () => {
  const pages = loadAllPagesFor('poe1')
  const vendor = pages.find(p => p.id === 'vendor_items') as RegexPage
  const idx = (id: string): number => vendor.entries.findIndex(e => e.id === id)

  it('V6 連結類任一成立、屬性類同時成立:links 與 colored_links 併成同一個 term(`|` 相連),品質另一個 term', () => {
    const picks = ['links', 'colored_links', 'quality'].map(idx)
    expect(picks.every(i => i >= 0), `商店頁項目 index ${picks}`).toBe(true)
    const r = combine({
      lang: 'zh',
      mode: 'any',
      pages: [{ page: vendor, picks, values: { links: { choice: '3' }, colored_links: { choice: '3' }, quality: { min: 20 } } }]
    })
    const a = linkedSockets(3)!
    const b = coloredLinks(3)!
    const ts = terms(r.query)
    const sock = ts.filter(t => t.includes(a) && t.includes(b))
    expect(sock.length, `query ${r.query}`).toBe(1)
    expect([`${a}|${b}`, `${b}|${a}`], `query ${r.query}`).toContain(sock[0])
    const other = ts.filter(t => t !== sock[0])
    expect(other.length, `query ${r.query}`).toBe(1)
    expect(other[0].includes('品質'), `query ${r.query}`).toBe(true)
    expect(r.query.includes(' '), `query ${r.query}`).toBe(true)
  })

  it('V7 舊存值照樣還原:分享碼含 links=3、link_colors=rgb,解碼套用後兩項都勾回、missed 0', async () => {
    const code = await encodeShare({
      v: 2, game: 'poe1', mode: 'any',
      pages: { vendor_items: ['links', 'link_colors'] },
      sections: {},
      numeric: { vendor_items: { links: { choice: '3' }, link_colors: { choice: 'rgb' } } },
      custom: [], excludes: []
    })
    const d = await decodeShare(code)
    expect(d.warnings).toEqual([])
    const r = resolveState(d.state, pages)
    expect(r.unknownPages).toEqual([])
    expect(r.missed).toBe(0)
    expect(r.picks.vendor_items).toEqual([idx('links'), idx('link_colors')].sort((x, y) => x - y))
    expect(r.values.vendor_items.links).toEqual({ choice: '3' })
    expect(r.values.vendor_items.link_colors).toEqual({ choice: 'rgb' })
    // 套用後仍能組出查詢
    const q = combine({ lang: 'zh', mode: 'any', pages: [{ page: vendor, picks: r.picks.vendor_items, values: r.values.vendor_items }] })
    expect(q.query.length).toBeGreaterThan(0)
  })
})

describe('V9 連結片段不中英文連字號單字(插槽字母不可黏在單字裡)', () => {
  const lines = ['Transfer-attuned Spirit Shield', 'Two-Toned Boots', 'Sockets: R-G', 'Sockets: W-R-G-B']
  it('linkedSockets(2..6):物品名兩行全不中;2 連中第 3、4 行', () => {
    for (let n = 2; n <= 6; n++) {
      const h = hits(linkedSockets(n), lines)
      expect(h.slice(0, 2), `linkedSockets(${n}) = ${linkedSockets(n)}`).toEqual([false, false])
      if (n === 2) expect(h.slice(2), `linkedSockets(2) = ${linkedSockets(2)}`).toEqual([true, true])
    }
  })
  it('coloredLinks(2..6):物品名兩行全不中;3 連中第 4 行', () => {
    for (let n = 2; n <= 6; n++) {
      const h = hits(coloredLinks(n), lines)
      expect(h.slice(0, 2), `coloredLinks(${n})`).toEqual([false, false])
      if (n === 3) expect(h[3], 'coloredLinks(3) 中 Sockets: W-R-G-B').toBe(true)
    }
  })
})
