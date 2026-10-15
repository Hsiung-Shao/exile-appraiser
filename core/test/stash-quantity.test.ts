/**
 * 倉庫碎片頁堆疊數量(數字模板比對,core/src/stash/quantity.ts)V1–V6。
 * 基準:core/test/stash/fixtures/qty/(使用者 2000×1125 截圖裁左側 700 px + 人工判讀 truth.json;一般 60 格、聖甲蟲 115 格、合成空格 14 個)。
 * 模板(data/poe1/stash/digit-templates.json)由同一批截圖產生 → 用全模板讀同一批格子會偏樂觀;
 * V1 另做「留一驗證」(每格用其他 174 格的樣本重建模板)當作對沒看過的格子的準確度估計,兩者都要過門檻。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import {
  QTY_HIGH_CONFIDENCE, buildDigitTemplates, decodeQtyCrop, digitSamples, parseDigitTemplates, qtyCrop, readCellQuantity,
  type DigitTemplates, type QtyImage, type QtyResult
} from '../src/stash/quantity'
import { cellRects, parseStashLayouts, type StashSubtab } from '../src/stash/layout'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FIX = path.join(ROOT, 'core/test/stash/fixtures/qty')
const TRUTH = JSON.parse(fs.readFileSync(path.join(FIX, 'truth.json'), 'utf8')) as {
  clientH: number
  files: Record<StashSubtab, string>
  general: number[]
  scarabs: number[]
  empties: Record<StashSubtab, Array<{ x: number, y: number }>>
  /** 第二批截圖(2026-10-15) */
  more: Array<{ tab: StashSubtab, file: string, values: number[], train?: boolean }>
}
const LAYOUTS = parseStashLayouts(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe1/stash/layouts.json'), 'utf8')))
const TEMPLATE_FILE = path.join(ROOT, 'data/poe1/stash/digit-templates.json')
const TEMPLATES = parseDigitTemplates(JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf8')))
const TABS: StashSubtab[] = ['general', 'scarabs']

async function loadImage (tab: StashSubtab, height?: number): Promise<QtyImage> {
  let s = sharp(path.join(FIX, TRUTH.files[tab])).removeAlpha()
  if (height) s = s.resize({ height, kernel: 'lanczos3' })
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

interface Tally { ok: number, wrong: string[], unknown: string[], wrongHigh: string[] }
function tally (results: Array<{ id: string, truth: number, r: QtyResult }>): Tally {
  const t: Tally = { ok: 0, wrong: [], unknown: [], wrongHigh: [] }
  for (const { id, truth, r } of results) {
    if (r.qty === truth) t.ok++
    else if (r.qty == null) t.unknown.push(`${id} ${truth}→${r.raw ?? r.reason}`)
    else {
      t.wrong.push(`${id} ${truth}→${r.qty}(${r.confidence}/${r.margin})`)
      if (r.confidence >= QTY_HIGH_CONFIDENCE) t.wrongHigh.push(`${id} ${truth}→${r.qty}`)
    }
  }
  return t
}

async function readAll (templates: (tab: StashSubtab, i: number) => DigitTemplates, height?: number): Promise<Tally> {
  const out: Array<{ id: string, truth: number, r: QtyResult }> = []
  for (const tab of TABS) {
    const img = await loadImage(tab, height)
    const rects = cellRects(LAYOUTS, tab, img.height)
    rects.forEach((r, i) => out.push({ id: `${tab}#${i}`, truth: TRUTH[tab][i], r: readCellQuantity(img, r, templates(tab, i), { clientH: img.height }) }))
  }
  return tally(out)
}

describe('V1 兩張截圖逐格讀數量', () => {
  it('全模板:175 格錯 0、不確定 ≤ 8', async () => {
    const t = await readAll(() => TEMPLATES)
    console.log(`[V1 全模板] 正確 ${t.ok}/175,錯 ${t.wrong.length} ${t.wrong.join('; ')},不確定 ${t.unknown.length} ${t.unknown.join('; ')}`)
    // 2026-10-15 使用者選「放寬一點」的低分門檻(< 0.70 且次佳差 < 0.15):改前 169 / 0 / 6
    expect(t.wrong).toEqual([])
    expect(t.unknown.length).toBeLessThanOrEqual(8)
    expect(t.wrongHigh).toEqual([])
  })

  it('留一驗證(每格用其他格的樣本重建模板):錯 0、不確定 ≤ 10', async () => {
    const H = TRUTH.clientH
    const per = new Map<string, Array<{ d: number, v: Float64Array }>>()
    for (const tab of TABS) {
      const img = await loadImage(tab)
      cellRects(LAYOUTS, tab, H).forEach((r, i) => per.set(`${tab}#${i}`, digitSamples(qtyCrop(img, r, H, H), TRUTH[tab][i])))
    }
    const t = await readAll((tab, i) => {
      const self = `${tab}#${i}`
      return buildDigitTemplates([...per].filter(([k]) => k !== self).flatMap(([, v]) => v), H)
    })
    console.log(`[V1 留一] 正確 ${t.ok}/175,錯 ${t.wrong.length} ${t.wrong.join('; ')},不確定 ${t.unknown.length} ${t.unknown.join('; ')}`)
    // 改前 166 / 錯 1(19→10 @0.693/0.123)/ 8
    expect(t.wrong).toEqual([])
    expect(t.unknown.length).toBeLessThanOrEqual(10)
    expect(t.wrongHigh).toEqual([])
  })
})

describe('V2 空格判空', () => {
  it('合成空格 14 個全部 null 且 reason = empty', async () => {
    const got: string[] = []
    for (const tab of TABS) {
      const img = await loadImage(tab)
      const box = cellRects(LAYOUTS, tab, img.height)[0].w
      for (const e of TRUTH.empties[tab]) {
        const r = readCellQuantity(img, { x: e.x, y: e.y, w: box, h: box }, TEMPLATES, { clientH: img.height })
        got.push(`${r.qty}/${r.reason}`)
      }
    }
    expect(got).toHaveLength(14)
    expect(got).toEqual(Array(14).fill('null/empty'))
  })
})

/** 把影像某塊塗成某色(RGB 3 通道) */
function paint (img: QtyImage, x0: number, y0: number, w: number, h: number, rgb = [0, 0, 0]): QtyImage {
  const data = Uint8Array.from(img.data as Uint8Array)
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const p = (y * img.width + x) * img.channels
      data[p] = rgb[0]; data[p + 1] = rgb[1]; data[p + 2] = rgb[2]
    }
  }
  return { ...img, data }
}

describe('V3 低信心回未知', () => {
  async function blurred (sigma: number): Promise<{ wrong: string[], unknown: number }> {
    const wrong: string[] = []
    let unknown = 0
    for (const tab of TABS) {
      const { data, info } = await sharp(path.join(FIX, TRUTH.files[tab])).removeAlpha().blur(sigma).raw().toBuffer({ resolveWithObject: true })
      const img = { data, width: info.width, height: info.height, channels: info.channels }
      cellRects(LAYOUTS, tab, img.height).forEach((r, i) => {
        const q = readCellQuantity(img, r, TEMPLATES, { clientH: img.height })
        if (q.qty == null) unknown++
        else if (q.qty !== TRUTH[tab][i]) wrong.push(`${tab}#${i} ${TRUTH[tab][i]}→${q.qty}(${q.confidence})`)
      })
    }
    console.log(`[V3 糊化 σ ${sigma}] 錯 ${wrong.length} ${wrong.join('; ')}、不確定 ${unknown}`)
    return { wrong, unknown }
  }

  it('輕度糊化(高斯 σ 0.6)後讀到的數字一個都不錯(寧缺勿錯)', async () => {
    const r = await blurred(0.6)
    expect(r.wrong).toEqual([])
  })

  it('中度糊化(σ 1.0)錯 ≤ 1 格且錯的不標高信心;其餘退回不確定', async () => {
    const r = await blurred(1.0)
    // 放寬門檻不擋 11→14 @0.718/0.226(使用者 2026-10-15 選擇)
    expect(r.wrong.length).toBeLessThanOrEqual(1)
    for (const w of r.wrong) expect(Number(w.match(/\(([\d.]+)\)$/)![1])).toBeLessThan(QTY_HIGH_CONFIDENCE)
    expect(r.unknown).toBeGreaterThan(0)
  })

  it('數字下半截被截掉(塗黑)→ 不回錯數字', async () => {
    const img0 = await loadImage('scarabs')
    const rects = cellRects(LAYOUTS, 'scarabs', img0.height)
    const results: string[] = []
    for (const i of [0, 2, 8, 24, 45]) {
      const r = rects[i]
      const img = paint(img0, r.x - 3, r.y + 13, Math.round(r.w * 0.85), 10)
      const q = readCellQuantity(img, r, TEMPLATES, { clientH: img.height })
      results.push(`${TRUTH.scarabs[i]}→${q.qty}`)
      expect(q.qty === null || q.qty === TRUTH.scarabs[i]).toBe(true)
    }
    console.log(`[V3 截斷] ${results.join(' ')}`)
  })

  it('沒有樣本的數字模板(全 null)→ 一律 empty,不丟例外', async () => {
    const img = await loadImage('general')
    const empty: DigitTemplates = { ...TEMPLATES, digits: Array(10).fill(null) }
    const r = readCellQuantity(img, cellRects(LAYOUTS, 'general', img.height)[16], empty, { clientH: img.height })
    expect(r).toMatchObject({ qty: null, reason: 'empty' })
  })
})

describe('V4 漏讀一位被擋', () => {
  it('87 從 7 的中線起塗黑(切點 17)→ null;切點 14–16 讀成 8 是已知錯讀(改前就有)', async () => {
    const img0 = await loadImage('scarabs')
    const rects = cellRects(LAYOUTS, 'scarabs', img0.height)
    for (const i of [46, 102]) {
      expect(TRUTH.scarabs[i]).toBe(87)
      const r = rects[i]
      // 切點 = 裁切區座標(裁切區左緣 = 格 x − 3);7 的模板視窗左緣在 x = 11–12(依版本),17 = 視窗中線之後。
      // 切點固定(2026-10-15 描邊過濾):原本取自判讀結果的 7 位置,判讀一變切點就跟著移 → 成了另一個測試
      const read = (cut: number): QtyResult => {
        const cutX = r.x - 3 + cut
        return readCellQuantity(paint(img0, cutX, r.y, r.x + r.w - cutX, Math.round(r.h * 0.65)), r, TEMPLATES, { clientH: img0.height })
      }
      const res = [14, 15, 16, 17].map(c => read(c))
      console.log(`[V4] #${i} 切點 14–17:${res.map(q => `${q.qty}(${q.reason} ${q.raw ?? ''} ${q.confidence})`).join(' / ')}`)
      expect(res[3].qty).toBeNull()
      // 已知錯讀(code review 2026-10-15,新舊版相同):只剩 7 左側 2–5 欄 → 鄰位筆畫量 < 1.3 倍、沒有純白殘留 → 讀成 8。
      // 精確鎖住:改善後這裡會轉紅,屆時改成 toBeNull
      for (const q of res.slice(0, 3)) expect(q.qty).toBe(8)
    }
  })
})

describe('V20 裁切區邊緣的描邊過濾', () => {
  // 補邊(四周多取 outlineRgbRadius 算完裁回)評估後不採用(V18、V19 各多 1 格不確定,docs/stash-prices.md):
  // 鎖住現況 = 只有右緣 2 欄與延伸裁切區不同;日後採用補邊時差異變 0 → 這條轉紅,改成 toEqual([])
  it('不補邊(已評估不採用):與往右延伸的裁切區只在右緣 2 欄有差異', async () => {
    let edgeInk = 0
    const diffs: string[] = []
    let inner = 0
    for (const tab of TABS) {
      const img = await loadImage(tab)
      cellRects(LAYOUTS, tab, img.height).forEach((r, n) => {
        const a = qtyCrop(img, r, img.height, TEMPLATES.baseClientH)
        const b = qtyCrop(img, r, img.height, TEMPLATES.baseClientH, undefined, 6)
        for (let j = 0; j < a.h; j++) {
          for (let i = 0; i < a.w; i++) {
            const va = a.white[j * a.w + i]
            if (i >= a.w - 2 && a.ink[j * a.w + i] > 0) edgeInk++
            if (Math.abs(va - b.white[j * b.w + i]) <= 1e-3) continue
            diffs.push(`${tab}#${n}(${i},${j})`)
            if (i < a.w - 2) inner++
          }
        }
      })
    }
    console.log(`[V20 邊緣] 右緣 2 欄有筆畫的像素 ${edgeInk},不一致 ${diffs.length} ${diffs.slice(0, 8).join(' ')}`)
    // 右緣真的有筆畫(否則這條測不到東西)
    expect(edgeInk).toBeGreaterThan(0)
    expect(inner).toBe(0)
    expect(diffs.length).toBeGreaterThan(0)
  })

  it('被遮罩的鄰居當成暗(描邊):旁邊被遮掉的筆畫像素不被削弱', async () => {
    const img = await loadImage('scarabs')
    const H = img.height
    const rects = cellRects(LAYOUTS, 'scarabs', H)
    // 找一個被描邊過濾削弱的筆畫像素,遮掉它左右任一鄰居
    let hit: { n: number, i: number, j: number, ni: number } | null = null
    for (let n = 0; n < rects.length && !hit; n++) {
      const a = qtyCrop(img, rects[n], H, TEMPLATES.baseClientH)
      for (let p = 0; p < a.w * a.h && !hit; p++) {
        const i = p % a.w
        if (i < 1 || i >= a.w - 1 || a.ink[p] < 50 || a.white[p] > a.ink[p] * 0.5) continue
        hit = { n, i, j: Math.floor(p / a.w), ni: i + 1 }
      }
    }
    expect(hit).not.toBeNull()
    const { n, i, j, ni } = hit!
    const a = qtyCrop(img, rects[n], H, TEMPLATES.baseClientH)
    const m = qtyCrop(img, rects[n], H, TEMPLATES.baseClientH, [{ x: a.x0 + ni, y: a.y0 + j, w: 1, h: 1 }])
    const p = j * a.w + i
    console.log(`[V20 遮罩] 聖甲蟲 #${n} (${i},${j}) ink ${a.ink[p].toFixed(1)} 無遮罩 ${a.white[p].toFixed(1)} 遮右鄰 ${m.white[p].toFixed(1)}`)
    expect(m.masked![j * a.w + ni]).toBe(1)
    expect(m.white[p]).toBeCloseTo(a.ink[p], 3)
  })
})

describe('V5 縮放到不同 client 高', () => {
  it('截圖放大到 1440 高:錯 0、不確定 ≤ 8', async () => {
    const t = await readAll(() => TEMPLATES, 1440)
    console.log(`[V5 1440] 正確 ${t.ok}/175,錯 ${t.wrong.length} ${t.wrong.join('; ')},不確定 ${t.unknown.length} ${t.unknown.join('; ')}`)
    // 改前 170 / 0 / 5
    expect(t.wrong).toEqual([])
    expect(t.unknown.length).toBeLessThanOrEqual(8)
    expect(t.wrongHigh).toEqual([])
  })

  it('1440 高的空格仍判空', async () => {
    for (const tab of TABS) {
      const img = await loadImage(tab, 1440)
      const k = 1440 / TRUTH.clientH
      const box = cellRects(LAYOUTS, tab, img.height)[0].w
      for (const e of TRUTH.empties[tab]) {
        const r = readCellQuantity(img, { x: Math.round(e.x * k), y: Math.round(e.y * k), w: box, h: box }, TEMPLATES, { clientH: img.height })
        expect(`${r.qty}/${r.reason}`).toBe('null/empty')
      }
    }
  })

  it('耗時:一頁(聖甲蟲 115 格)讀完 < 200 ms(只防退化;實測約 30 ms,負載下 50–70 ms)', async () => {
    const img = await loadImage('scarabs', 1440)
    const rects = cellRects(LAYOUTS, 'scarabs', img.height)
    // 暖機後量 5 次取最快(避開 vitest 並行其他檔案時的排程雜訊)
    let ms = Infinity
    for (let rep = 0; rep < 6; rep++) {
      const t0 = performance.now()
      for (const r of rects) readCellQuantity(img, r, TEMPLATES, { clientH: img.height })
      if (rep) ms = Math.min(ms, performance.now() - t0)
    }
    console.log(`[V5 耗時] 聖甲蟲 1440 一頁 ${ms.toFixed(1)} ms`)
    // 門檻寬鬆:一般負載(vitest 並行)下 50–70 ms 屬正常,不讓 npm test 隨機紅;只擋數量級的退化
    expect(ms).toBeLessThan(200)
  })
})

async function loadComposite (tab: StashSubtab, edit: (img: QtyImage) => QtyImage, height?: number): Promise<QtyImage> {
  const img = edit(await loadImage(tab))
  if (!height) return img
  const { data, info } = await sharp(Buffer.from(img.data as Uint8Array), { raw: { width: img.width, height: img.height, channels: img.channels as 3 } })
    .resize({ height, kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/** 複製影像一塊(1125 原解析度) */
function copyBlock (img: QtyImage, sx: number, sy: number, w: number, h: number, dx: number, dy: number): QtyImage {
  const data = Uint8Array.from(img.data as Uint8Array)
  const ch = img.channels
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((sy + y) * img.width + sx + x) * ch
      const d = ((dy + y) * img.width + dx + x) * ch
      for (let c = 0; c < ch; c++) data[d + c] = (img.data as Uint8Array)[s + c]
    }
  }
  return { ...img, data }
}

describe('V14 code review 修正(寧缺勿錯)', () => {
  it('4 位數堆疊(三位數後面再拼一位)不得讀成三位數 ok', async () => {
    const img0 = await loadImage('scarabs')
    const r = cellRects(LAYOUTS, 'scarabs', img0.height)[24]
    expect(TRUTH.scarabs[24]).toBe(100)
    const chain = decodeQtyCrop(qtyCrop(img0, r, img0.height, TEMPLATES.baseClientH), TEMPLATES).chain!
    expect(chain.map(c => c.d).join('')).toBe('100')
    const last = chain[2]
    const adv = last.x - chain[1].x
    // 末位的模板視窗(裁切區座標,左緣 = 格 x − 3)往右複製一個字距 = 「1000」
    const four = (img: QtyImage) => copyBlock(img, r.x - 3 + last.x, r.y + last.y, 11, 15, r.x - 3 + last.x + adv, r.y + last.y)
    for (const height of [undefined, 1440]) {
      const img = await loadComposite('scarabs', four, height)
      const rr = cellRects(LAYOUTS, 'scarabs', img.height)[24]
      const q = readCellQuantity(img, rr, TEMPLATES, { clientH: img.height })
      console.log(`[V14 4 位數] ${height ?? 1125}:${q.qty}(${q.reason} ${q.raw ?? ''})`)
      expect(q.reason === 'ok' && String(q.qty).length === 3).toBe(false)
      expect(q.qty === null || q.qty === 1000).toBe(true)
    }
  })

  it('單獨讀到「0」回 null(堆疊數不可能是 0),不當成空格', async () => {
    const img0 = await loadImage('general')
    const r = cellRects(LAYOUTS, 'general', img0.height)[20]
    expect(TRUTH.general[20]).toBe(70)
    const chain = decodeQtyCrop(qtyCrop(img0, r, img0.height, TEMPLATES.baseClientH), TEMPLATES).chain!
    // 塗掉「7」(首位視窗左緣到第二位視窗左緣)→ 只剩「0」
    const img = paint(img0, r.x - 3 + chain[0].x, r.y, chain[1].x - chain[0].x, Math.round(r.h * 0.65))
    const q = readCellQuantity(img, r, TEMPLATES, { clientH: img.height })
    console.log(`[V14 單獨 0] ${q.qty}(${q.reason} ${q.raw ?? ''})`)
    expect(q.qty).toBeNull()
    expect(q.reason).not.toBe('empty')
  })

  it('格子超出影像 → null 且不是 empty', async () => {
    const img = await loadImage('general')
    const box = cellRects(LAYOUTS, 'general', img.height)[0].w
    const q = readCellQuantity(img, { x: img.width - 8, y: 300, w: box, h: box }, TEMPLATES, { clientH: img.height })
    expect(q.qty).toBeNull()
    expect(q.reason).not.toBe('empty')
  })

  it('已知錯讀:留一 19→10 回不確定;σ 1.0 糊化 11→14(放寬門檻不擋)不標高信心', async () => {
    const H = TRUTH.clientH
    const imgs = await loadImage('scarabs')
    const rects = cellRects(LAYOUTS, 'scarabs', H)
    expect([TRUTH.scarabs[80], TRUTH.scarabs[94]]).toEqual([19, 11])
    const samples: Array<{ d: number, v: Float64Array }> = []
    for (const tab of TABS) {
      const img = tab === 'scarabs' ? imgs : await loadImage(tab)
      cellRects(LAYOUTS, tab, H).forEach((r, i) => { if (!(tab === 'scarabs' && i === 80)) samples.push(...digitSamples(qtyCrop(img, r, H, H), TRUTH[tab][i])) })
    }
    const loo = readCellQuantity(imgs, rects[80], buildDigitTemplates(samples, H), { clientH: H })
    const { data, info } = await sharp(path.join(FIX, TRUTH.files.scarabs)).removeAlpha().blur(1.0).raw().toBuffer({ resolveWithObject: true })
    const blur = readCellQuantity({ data, width: info.width, height: info.height, channels: info.channels }, rects[94], TEMPLATES, { clientH: H })
    console.log(`[V14 已知錯讀] 留一 #80 ${loo.qty}(${loo.reason} ${loo.confidence}/${loo.margin}),σ 1.0 #94 ${blur.qty}(${blur.reason} ${blur.confidence}/${blur.margin})`)
    expect(loo.qty).toBeNull()
    expect(blur.qty === null || blur.confidence < QTY_HIGH_CONFIDENCE).toBe(true)
  })
})

describe('V18 第二批截圖(2026-10-15,聖甲蟲頁、玩家移動過物品)', () => {
  it('驗證用(不進訓練):115 格錯 0、不確定 ≤ 3;右側單獨欄 7 / 50 / 87 / 22 / 41 / 11 / 2 / 20 至少讀到 5 格', async () => {
    const m = TRUTH.more[0]
    const { data, info } = await sharp(path.join(FIX, m.file)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const img = { data, width: info.width, height: info.height, channels: info.channels }
    const rects = cellRects(LAYOUTS, m.tab, img.height)
    expect(rects).toHaveLength(m.values.length)
    const out = rects.map((r, i) => ({ id: `${m.file}#${i}`, truth: m.values[i], r: readCellQuantity(img, r, TEMPLATES, { clientH: img.height }) }))
    const t = tally(out)
    console.log(`[V18 第二批] 正確 ${t.ok}/115,錯 ${t.wrong.length} ${t.wrong.join('; ')},不確定 ${t.unknown.length} ${t.unknown.join('; ')}`)
    expect(t.wrong).toEqual([])
    // 不確定:#100 7(灰白聖甲蟲圖示緊貼數字 → 漏讀檢查擋下)、#102 87(7 疊在圖示上)、#107 20(低分);描邊過濾前另有 #2 31
    expect(t.unknown.length).toBeLessThanOrEqual(3)
    const col = out.slice(100, 108)
    expect(col.map(o => o.truth)).toEqual([7, 50, 87, 22, 41, 11, 2, 20])
    expect(col.filter(o => o.r.qty === o.truth).length).toBeGreaterThanOrEqual(5)
  })
})

describe('V19 原生 2560×1440 擷取(2026-10-15 使用者「存下倉庫擷取畫面」)', () => {
  const NFIX = path.join(ROOT, 'core/test/stash/fixtures/qty-native')
  const NT = JSON.parse(fs.readFileSync(path.join(NFIX, 'truth.json'), 'utf8')) as {
    clientH: number
    sets: Array<{ tab: StashSubtab, file: string, masks: Array<{ x: number, y: number, w: number, h: number }>, cells: Array<{ rect: { x: number, y: number, w: number, h: number }, truth: number }> }>
  }
  async function readNative (templates: DigitTemplates, withMask?: boolean): Promise<Tally>
  async function readNative (templates: DigitTemplates, withMask: boolean, raw: true): Promise<QtyResult[]>
  async function readNative (templates: DigitTemplates, withMask = false, raw = false): Promise<Tally | QtyResult[]> {
    const out: Array<{ id: string, truth: number, r: QtyResult }> = []
    for (const s of NT.sets) {
      const { data, info } = await sharp(path.join(NFIX, s.file)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      const img = { data, width: info.width, height: info.height, channels: info.channels }
      s.cells.forEach((c, i) => out.push({ id: `${s.tab}#${i}`, truth: c.truth, r: readCellQuantity(img, c.rect, templates, { clientH: NT.clientH, mask: withMask ? s.masks : undefined }) }))
    }
    return raw ? out.map(o => o.r) : tally(out)
  }

  it('格數與版面一致(聖甲蟲 115、一般 60)', () => {
    expect(NT.sets.map(s => [s.tab, s.cells.length])).toEqual([['scarabs', 115], ['general', 60]])
  })

  it('175 格錯 0、不確定 ≤ 5', async () => {
    const t = await readNative(TEMPLATES)
    console.log(`[V19 原生] 正確 ${t.ok}/175,錯 ${t.wrong.length} ${t.wrong.join('; ')},不確定 ${t.unknown.length} ${t.unknown.join('; ')}`)
    expect(t.wrong).toEqual([])
    // 描邊過濾前 7 格(聖甲蟲 #5 49、#24 100、#34 39、#80 19、#100 7、#102 87,一般 #49 1);之後 #24 100、#102 87 讀得到
    expect(t.unknown.length).toBeLessThanOrEqual(5)
  })

  it('帶擷取當下的徽章遮罩:錯 0,蓋到數字帶的格回 masked(執行時改走 peek)', async () => {
    const t = await readNative(TEMPLATES, true)
    const res = await readNative(TEMPLATES, true, true)
    const masked = res.filter(r => r.reason === 'masked').length
    // NT.sets 順序 = 聖甲蟲 115 格、一般 60 格(上一個 it 守住)
    const maskedScarabs = res.slice(0, 115).filter(r => r.reason === 'masked').length
    const general = res.slice(115)
    const maskedGeneral = general.filter(r => r.reason === 'masked').length
    const okGeneral = general.filter((r, i) => r.qty === NT.sets[1].cells[i].truth).length
    console.log(`[V19 原生 + 遮罩] 正確 ${t.ok}/175,錯 ${t.wrong.length},不確定 ${t.unknown.length}(masked ${masked}:聖甲蟲 ${maskedScarabs}、一般 ${maskedGeneral};一般正確 ${okGeneral})`)
    expect(t.wrong).toEqual([])
    // 聖甲蟲頁徽章緊貼數字帶 → 幾乎全部 masked;沒被蓋到的格與無遮罩時同樣最多 5 格不確定
    expect(t.unknown.length - masked).toBeLessThanOrEqual(5)
    // 上下限(H3):一般頁徽章不蓋數字帶 → 0 格 masked、讀到 ≥ 59 格;聖甲蟲頁 masked 不超過格數
    expect(maskedGeneral).toBe(0)
    expect(t.ok).toBeGreaterThanOrEqual(59)
    expect(maskedScarabs).toBeLessThanOrEqual(115)
  })
})

describe('V6 模板資料可重現', () => {
  it('build 腳本重跑輸出逐位元組相同、MANIFEST 相符、記錄來源截圖 sha256', async () => {
    const mod = await import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, 'scripts/build-stash-digit-templates.mjs')).href) as { buildTemplatesJson: () => Promise<string>, MANIFEST_PREFIX: string }
    const json = await mod.buildTemplatesJson()
    const onDisk = fs.readFileSync(TEMPLATE_FILE, 'utf8')
    expect(json).toBe(onDisk)
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/MANIFEST.json'), 'utf8'))
    expect(manifest.sources[mod.MANIFEST_PREFIX]).toBeTruthy()
    expect(manifest.files['data/poe1/stash/digit-templates.json'].sha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(TEMPLATE_FILE)).digest('hex'))
    for (const s of TEMPLATES.sources ?? []) {
      expect(s.sha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, s.file))).digest('hex'))
    }
    // 第一批兩張 + 第二批聖甲蟲一張(2026-10-15)
    expect(TEMPLATES.sources).toHaveLength(2 + TRUTH.more.filter(m => m.train !== false).length)
    expect(TEMPLATES.baseClientH).toBe(TRUTH.clientH)
    expect(TEMPLATES.counts.every(n => n > 0)).toBe(true)
  })
})
