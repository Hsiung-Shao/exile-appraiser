// exile-appraiser(WP-S 兩段式):`src/ocr/strategy.ts` 的路徑選擇(cached / two-pass / full)。不啟動 Electron、不跑 WinRT:
// 假的 recognize 從「畫面上的行」(poe2 fixture well-of-souls-fullscreen-02 的 OCR 快照,換成 client 座標)裡回傳落在裁切框內的行。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLocateIndex, type LocateTiersLike } from '../../poe2/src/desecration/ocr-locate'
import type { OcrTextLine } from '../../poe2/src/desecration/ocr-text'
import {
  PanelRegionCache, cacheKey, ocrScale, regionRect, regionSearchRect, smartRecognize,
  type PhysRect, type RecognizeRect
} from '../src/ocr/strategy'
import { loadLocateIndex, tiersCandidates } from '../src/ocr/locate-data'

const ROOT = path.resolve(__dirname, '../..')
const index = buildLocateIndex(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe2/desecration/tiers.json'), 'utf8')) as LocateTiersLike)
const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'poe2/test/desecration/fixtures/ocr/well-of-souls-fullscreen-02.ocr.json'), 'utf8')) as {
  srcW: number, srcH: number, scale: number, lines: OcrTextLine[]
}
const SCREEN: OcrTextLine[] = snap.lines.map(l => ({ text: l.text, x: l.x / snap.scale, y: l.y / snap.scale, w: l.w / snap.scale, h: l.h / snap.scale }))
const SEARCH: PhysRect = { x: 0, y: 0, width: snap.srcW, height: snap.srcH }
const MODS = ['增 加 71 % 護 甲 值 和 閃 避', '+ 60 護 甲 值', '+ 59 閃 避 值', '+ 16 最 大 生 命']

const inside = (l: OcrTextLine, r: PhysRect) => l.x >= r.x && l.y >= r.y && l.x + l.w <= r.x + r.width && l.y + l.h <= r.y + r.height

/** 假 OCR:回傳 screen 裡完全落在框內的行;`atScale1` 可改寫 ×1 看到的東西(模擬低倍率認不出字) */
function fake (screen: OcrTextLine[], opts: { atScale1?: (lines: OcrTextLine[]) => OcrTextLine[] } = {}) {
  const calls: Array<{ rect: PhysRect, scale: number }> = []
  const recognize: RecognizeRect = async (rect, scale) => {
    calls.push({ rect, scale })
    let lines = screen.filter(l => inside(l, rect))
    if (scale === 1 && opts.atScale1) lines = opts.atScale1(lines)
    return { lines, ms: 10 * scale }
  }
  return { recognize, calls }
}

const key = cacheKey({ w: snap.srcW, h: snap.srcH }, { x: 0, y: 0 }, SEARCH)
const names = (r: { stages: Array<{ name: string }> }) => r.stages.map(s => s.name)

describe('smartRecognize', () => {
  it('快取空 → two-pass(第 1 段整張 ×1、第 2 段面板區 ×3),記下快取;再按 → cached', async () => {
    const cache = new PanelRegionCache()
    const f = fake(SCREEN)
    const a = await smartRecognize({ recognize: f.recognize, index, cache, key, search: SEARCH })
    expect(a.stage).toBe('two-pass')
    expect(names(a)).toEqual(['locate', 'detail'])
    expect(f.calls[0]).toEqual({ rect: SEARCH, scale: 1 })
    expect(f.calls[1].scale).toBe(3)
    const crop = f.calls[1].rect
    expect(crop.x + crop.width).toBeLessThanOrEqual(1300)
    expect(a.lines.map(l => l.text).filter(t => MODS.includes(t))).toHaveLength(4)
    expect(a.stages[0].hits).toBe(4)
    expect(a.stages[1].hits).toBe(4)
    expect(a.ocrMs).toBe(10 + 30)
    expect(cache.get(key)).toEqual(crop)

    const b = await smartRecognize({ recognize: f.recognize, index, cache, key, search: SEARCH })
    expect(b.stage).toBe('cached')
    expect(names(b)).toEqual(['cached'])
    expect(f.calls[2]).toEqual({ rect: crop, scale: 3 })
    expect(b.lines.map(l => l.text).filter(t => MODS.includes(t))).toHaveLength(4)
  })

  it('面板換位置 → 快取區對不到(too-few-hits)→ 清快取改走 two-pass', async () => {
    const cache = new PanelRegionCache()
    const f = fake(SCREEN)
    await smartRecognize({ recognize: f.recognize, index, cache, key, search: SEARCH })
    const moved = SCREEN.map(l => ({ ...l, y: l.y + (MODS.includes(l.text) ? -400 : 0) }))
    const g = fake(moved)
    const r = await smartRecognize({ recognize: g.recognize, index, cache, key, search: SEARCH })
    expect(r.stage).toBe('two-pass')
    expect(names(r)).toEqual(['cached', 'locate', 'detail'])
    expect(r.stages[0].rejected).toBe('too-few-hits')
    expect(r.lines.map(l => l.text).filter(t => MODS.includes(t))).toHaveLength(4)
    expect(cache.get(key)!.y).toBeLessThan(200)
  })

  it('第 1 段(×1)一行都不像詞綴 → full(整張 ×3);full 找得到面板就寫快取', async () => {
    const cache = new PanelRegionCache()
    const f = fake(SCREEN, { atScale1: ls => ls.filter(l => !MODS.includes(l.text)) })
    const r = await smartRecognize({ recognize: f.recognize, index, cache, key, search: SEARCH })
    expect(r.stage).toBe('full')
    expect(names(r)).toEqual(['locate', 'full'])
    expect(r.stages[0].rejected).toBe('no-candidate')
    expect(f.calls[1]).toEqual({ rect: SEARCH, scale: ocrScale(SEARCH.width, SEARCH.height) })
    expect(r.scale).toBe(3)
    expect(cache.get(key)).toBeDefined()
    const again = await smartRecognize({ recognize: f.recognize, index, cache, key, search: SEARCH })
    expect(again.stage).toBe('cached')
  })

  it('第 2 段沒框完整(貼邊)→ full', async () => {
    const cache = new PanelRegionCache()
    // ×1 只看到「+60護甲值」;×3 的面板區裡,詞綴全擠在框頂端(模擬面板比預期高、一部分在框外)
    const recognize: RecognizeRect = async (rect, scale) => {
      if (scale === 1) return { lines: SCREEN.filter(l => l.text === '+ 60 護 甲 值'), ms: 10 }
      if (rect.width === SEARCH.width) return { lines: SCREEN, ms: 30 }
      return {
        lines: [
          { text: '+ 60 護 甲 值', x: rect.x + 100, y: rect.y + 1, w: 90, h: 18 },
          { text: '+ 59 閃 避 值', x: rect.x + 100, y: rect.y + 29, w: 90, h: 18 }
        ],
        ms: 30
      }
    }
    const r = await smartRecognize({ recognize, index, cache, key, search: SEARCH })
    expect(r.stage).toBe('full')
    expect(names(r)).toEqual(['locate', 'detail', 'full'])
    expect(r.stages[1].rejected).toBe('touches-edge')
  })

  it('沒有模板索引(讀不到 tiers.json)→ 只走 full;forceFull 不讀不寫快取', async () => {
    const cache = new PanelRegionCache()
    const f = fake(SCREEN)
    const a = await smartRecognize({ recognize: f.recognize, index: null, cache, key, search: SEARCH })
    expect(a.stage).toBe('full')
    expect(names(a)).toEqual(['full'])
    expect(cache.get(key)).toBeUndefined()
    const b = await smartRecognize({ recognize: f.recognize, index, cache, key, search: SEARCH, forceFull: true })
    expect(names(b)).toEqual(['full'])
    expect(cache.get(key)).toBeUndefined()
  })

  it('ocrScale:面板區 / 2000×1125 → 3;4K → 2(MaxImageDimension 上限)', () => {
    expect(ocrScale(495, 300)).toBe(3)
    expect(ocrScale(2000, 1125)).toBe(3)
    expect(ocrScale(3840, 2160)).toBe(2)
  })

  it('快取鍵含 client 大小、擷取偏移與搜尋範圍', () => {
    expect(cacheKey({ w: 1920, h: 1080 }, { x: 0, y: 0 }, SEARCH)).not.toBe(cacheKey({ w: 2560, h: 1440 }, { x: 0, y: 0 }, SEARCH))
    expect(cacheKey({ w: 1920, h: 1080 }, { x: 0, y: 0 }, SEARCH)).not.toBe(cacheKey({ w: 1920, h: 1080 }, { x: 5, y: 0 }, SEARCH))
  })
})

// ---- WP-S2:框選區域 ----

/** WP-S 版的 regionRect(比例 × 影像大小),夾進影像後當對照組 */
function legacyRegionRect (img: { w: number, h: number }, region: { x: number, y: number, w: number, h: number }): PhysRect {
  const x = Math.round(region.x * img.w)
  const y = Math.round(region.y * img.h)
  const w = Math.max(1, Math.round(Math.min(1 - region.x, region.w) * img.w))
  const h = Math.max(1, Math.round(Math.min(1 - region.y, region.h) * img.h))
  return { x, y, width: Math.min(img.w - x, w), height: Math.min(img.h - y, h) }
}

describe('regionSearchRect(client 比例 → 影像像素)', () => {
  it('視窗完全在螢幕內(client = 影像、offset 0):與舊版結果相同(抽 400 組)', () => {
    let seed = 7
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    for (const img of [{ w: 2000, h: 1125 }, { w: 1920, h: 1080 }, { w: 2560, h: 1440 }, { w: 1366, h: 768 }]) {
      for (let i = 0; i < 100; i++) {
        const x = Math.round(rnd() * 9000) / 10000
        const y = Math.round(rnd() * 9000) / 10000
        const region = { x, y, w: Math.round(rnd() * (1 - x) * 10000) / 10000 || 0.01, h: Math.round(rnd() * (1 - y) * 10000) / 10000 || 0.01 }
        const want = legacyRegionRect(img, region)
        expect(regionSearchRect(img, region, { client: img, offset: { x: 0, y: 0 } })).toEqual(want)
        expect(regionSearchRect(img, region)).toEqual(want)
      }
    }
  })

  it('視窗左側跑出螢幕 100 px:比例以 client 換算再減偏移(舊版會偏 50 px)', () => {
    const frame = { client: { w: 2000, h: 1125 }, offset: { x: 100, y: 0 } }
    const img = { w: 1900, h: 1125 }
    const region = { x: 0.19, y: 0.4444, w: 0.275, h: 0.2489 }
    // client 像素 380–930 × 500–780 → 影像像素 280–830
    expect(regionSearchRect(img, region, frame)).toEqual({ x: 280, y: 500, width: 550, height: 280 })
    expect(legacyRegionRect(img, region).x).toBe(361)
  })

  it('區域一部分在螢幕外 → 夾進影像;整個在螢幕外 → null(= 整張)', () => {
    const frame = { client: { w: 2000, h: 1125 }, offset: { x: 0, y: 200 } }
    const img = { w: 2000, h: 925 }
    expect(regionSearchRect(img, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, frame)).toEqual({ x: 200, y: 0, width: 400, height: 138 })
    expect(regionSearchRect(img, { x: 0.1, y: 0, w: 0.2, h: 0.1 }, frame)).toBeNull()
    expect(regionRect(img, { x: 0.1, y: 0, w: 0.2, h: 0.1 }, frame)).toEqual({ x: 0, y: 0, width: 2000, height: 925 })
    expect(regionSearchRect(img, null, frame)).toBeNull()
    expect(regionSearchRect(img, { x: 0.5, y: 0.5, w: 0, h: 0.1 }, frame)).toBeNull()
  })
})

describe('locate-data', () => {
  it('從 main/dist 找得到 repo 的 data/poe2/desecration/tiers.json,模板數與直接建的索引相同', async () => {
    const dist = path.join(ROOT, 'main/dist')
    expect(tiersCandidates(dist)[1]).toBe(path.join(ROOT, 'data/poe2/desecration/tiers.json'))
    const logs: string[] = []
    const idx = await loadLocateIndex(dist, m => { logs.push(m) })
    expect(idx?.list.length).toBe(index.list.length)
    expect(logs.join('\n')).toContain('面板定位模板')
  })
})
