// 商店頁插槽 / 連結改版:連結 / 顏色片段不再用 `.`,連結類勾選「任一成立」併成一個 term(anyGroup 'sockets'),屬性類各自一個 AND term。
// V1–V7;API 見 regex/src/pages/frag.ts(linkedSockets / coloredLinks / rgbGroup / linkColors)與 vendor-pages.ts。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { combine } from '../src/combine'
import { defaultRegexDataDir, loadAllPagesFor } from '../src/node'
import { coloredLinks, linkColors, linkedSockets, parseStatsNdjson, rgbGroup, socketColorCount } from '../src/pages'
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
    expect(f!.replace(/^\^/, '').startsWith('插槽'), `片段 ${f}`).toBe(true)
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

describe('V10 指定顏色片段不中英文連字號單字', () => {
  const lines = ['of Hair-Raising', 'Lightning-Retaliation', 'Strong-Willed', 'Sockets: R-R', 'Sockets: G-R-B']
  it('rr / rg / gw / rgb:前三行全不中', () => {
    for (const c of ['rr', 'rg', 'gw', 'rgb']) {
      expect(hits(linkColors(c), lines).slice(0, 3), `linkColors(${c}) = ${linkColors(c)}`).toEqual([false, false, false])
    }
  })
  it('rr 中 Sockets: R-R;rgb、rg 中 Sockets: G-R-B', () => {
    expect(hits(linkColors('rr'), lines)[3], `linkColors(rr) = ${linkColors('rr')}`).toBe(true)
    expect(hits(linkColors('rgb'), lines)[4], `linkColors(rgb) = ${linkColors('rgb')}`).toBe(true)
    expect(hits(linkColors('rg'), lines)[4], `linkColors(rg) = ${linkColors('rg')}`).toBe(true)
  })
})

describe('V11 插槽顏色數與紅綠藍同組只看插槽行', () => {
  const lines = ['All Sockets are Blue', 'All Sockets are Green', 'All Sockets are White', 'Sockets cannot be modified',
    'Sockets: R-G-B-W', '插槽: B-B-B', '插槽：B-B-B']
  it("socketColorCount('Sockets', r/g/b/w, 1) 與 rgbGroup('Sockets'):詞綴行全不中、Sockets: R-G-B-W 中", () => {
    for (const c of ['r', 'g', 'b', 'w']) {
      const h = hits(socketColorCount('Sockets', c, 1), lines)
      expect(h.slice(0, 4), `socketColorCount(Sockets,${c},1) = ${socketColorCount('Sockets', c, 1)}`).toEqual([false, false, false, false])
      expect(h[4], `socketColorCount(Sockets,${c},1) 應中 Sockets: R-G-B-W`).toBe(true)
    }
    const g = hits(rgbGroup('Sockets'), lines)
    expect(g.slice(0, 4), `rgbGroup(Sockets) = ${rgbGroup('Sockets')}`).toEqual([false, false, false, false])
    expect(g[4], 'rgbGroup(Sockets) 應中 Sockets: R-G-B-W').toBe(true)
  })
  it("socketColorCount('插槽','b',3):中半形與全形冒號的 B-B-B", () => {
    const h = hits(socketColorCount('插槽', 'b', 3), lines)
    expect(h.slice(5), `socketColorCount(插槽,b,3) = ${socketColorCount('插槽', 'b', 3)}`).toEqual([true, true])
  })
})

describe('V12 3 連以上片段不帶 \\b', () => {
  it('n=3..6:linkedSockets / coloredLinks 精確等於無詞界字串', () => {
    for (let n = 3; n <= 6; n++) {
      expect(linkedSockets(n), `linkedSockets(${n})`).toBe(`(-[rgbwa]){${n - 1}}`)
      expect(coloredLinks(n), `coloredLinks(${n})`).toBe(`[rgb](-[rgb]){${n - 1}}`)
    }
  })
  it("linkColors('rgb') 精確等於無詞界字串;rrg、rgbw 不含 \\b", () => {
    expect(linkColors('rgb')).toBe('b-(g-r|r-g)|g-(b-r|r-b)|r-(b-g|g-b)')
    expect(linkColors('rrg')!.includes('\\b'), `linkColors(rrg) = ${linkColors('rrg')}`).toBe(false)
    expect(linkColors('rgbw')!.includes('\\b'), `linkColors(rgbw) = ${linkColors('rgbw')}`).toBe(false)
  })
})

describe('V13 2 連 / 2 色保留 \\b', () => {
  it('linkedSockets(2) / coloredLinks(2) 精確等於帶詞界字串', () => {
    expect(linkedSockets(2)).toBe('\\b[rgbwa](-[rgbwa]){1}\\b')
    expect(coloredLinks(2)).toBe('\\b[rgb](-[rgb]){1}\\b')
  })
  it("linkColors('rg') / ('rr') 精確等於帶詞界字串", () => {
    expect(linkColors('rg')).toBe('\\b(g-r|r-g)\\b')
    expect(linkColors('rr')).toBe('\\br-r\\b')
  })
})

describe('V14 短版 n 連只中至少 n 連', () => {
  it('linkedSockets(4):中 4 連與 5 連;不中 3 連與斷開的', () => {
    const lines = ['插槽: R-G-B-W', 'Sockets: W-R-G-B-B', '插槽: R-G-B W', '插槽: R-G B-W', '插槽: R-G-B']
    expect(hits(linkedSockets(4), lines)).toEqual([true, true, false, false, false])
  })
})

describe('V15 全彩 3 連不把白插槽開頭算進去', () => {
  it('coloredLinks(3):不中 W-R-G,中 W-R-G-B', () => {
    expect(hits(coloredLinks(3), ['插槽: W-R-G', '插槽: W-R-G-B'])).toEqual([false, true])
  })
})

describe('V16 3 連以上片段不中任何物品文字', () => {
  // 語料 = PoE1 全部頁全部條目的文字欄位(zh、en、hidden*、alt*、ambient*、nameWords*)+ PoE1 stats 中英文全部詞綴行。
  // 3 連以上 / 3 色以上的片段至少要兩個 `-`,所以只用含兩個以上 `-` 的行比對(對照組用含一個以上的)。
  const TEXT_KEY = /^(zh|en|hidden(Zh|En)|alt(Zh|En)|ambient(Zh|En)|nameWords(Zh|En)|prefix|suffix)$/
  const corpus = new Set<string>()
  const addTexts = (v: unknown, key: string): void => {
    if (typeof v === 'string') { if (TEXT_KEY.test(key)) corpus.add(v) } else if (Array.isArray(v)) {
      for (const x of v) addTexts(x, key)
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) addTexts(x, k)
    }
  }
  const raw = JSON.parse(readFileSync(path.join(defaultRegexDataDir(), 'regex_poe1.json'), 'utf8'))
  for (const p of raw.pages) addTexts(p, 'page')
  const catalogueSize = corpus.size
  const statsDir = path.resolve(defaultRegexDataDir(), '..', 'poe1')
  for (const lang of ['cmn-Hant', 'en']) {
    for (const s of parseStatsNdjson(readFileSync(path.join(statsDir, lang, 'stats.ndjson'), 'utf8'))) {
      corpus.add(s.ref)
      for (const t of s.strings) corpus.add(t)
    }
  }
  const dashes = (l: string): number => l.split('-').length - 1
  const lines1 = [...corpus].filter(l => dashes(l) >= 1)
  const lines2 = lines1.filter(l => dashes(l) >= 2)

  it('語料讀到了:含目錄文字與 stats 詞綴行', () => {
    expect(catalogueSize, '目錄文字行數').toBeGreaterThan(1000)
    expect(corpus.size, 'stats 詞綴行沒讀到').toBeGreaterThan(catalogueSize)
    expect(lines2.length, '含兩個以上 - 的行').toBeGreaterThan(0)
  })

  it('linkedSockets(3..6)、coloredLinks(3..6)、linkColors 的全部 3 色與 4 色組合:全部語料行命中 0', () => {
    const frags: Array<[string, string]> = []
    for (let n = 3; n <= 6; n++) {
      for (const [name, f] of [['linkedSockets', linkedSockets(n)], ['coloredLinks', coloredLinks(n)]] as const) {
        expect(f, `${name}(${n}) 不可為 null`).not.toBeNull()
        frags.push([`${name}(${n})`, f!])
      }
    }
    const letters = ['r', 'g', 'b', 'w']
    let seqs = letters.map(c => c)
    for (let len = 2; len <= 4; len++) {
      seqs = seqs.flatMap(s => letters.map(c => s + c))
      if (len < 3) continue
      for (const s of seqs) {
        const f = linkColors(s)
        if (f !== null) frags.push([`linkColors('${s}')`, f])
      }
    }
    expect(frags.length, '片段數').toBeGreaterThanOrEqual(100)
    const bad: string[] = []
    for (const [name, f] of frags) {
      const re = new RegExp(f, 'i')
      for (const l of lines2) if (re.test(l)) bad.push(`${name} ${f} <- ${l}`)
    }
    expect(bad.length, `共 ${bad.length} 筆,前幾筆:\n${bad.slice(0, 5).join('\n')}`).toBe(0)
  })

  it('對照:linkedSockets(2) 拿掉頭尾 \\b 的版本會中同一份語料(證明語料真的有英文連字號文字)', () => {
    const re = new RegExp('[rgbwa](-[rgbwa]){1}', 'i')
    const n = lines1.filter(l => re.test(l)).length
    expect(n, '對照片段命中行數').toBeGreaterThan(0)
  })
})
