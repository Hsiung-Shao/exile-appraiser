/**
 * 倉庫掃描測試共用:假的格子擬合 `fit` / 已知位置驗證 `verify`(2026-11-26 起偵測改成格子擬合)。
 * 測試用 `s.target`(目前畫面上的子頁 + client 座標格子位置;null = 沒有倉庫 / 被說明框蓋住)控制「有沒有對上」。
 * 傳給 fit / verify 的是搜尋範圍影像座標:`gray(rect)` 記下 StashScan 取的搜尋範圍,fake 依它與擷取偏移在 client ↔ 影像間換算。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formulaGrid, gridRects, type FitPrior, type FitResult, type GrayImage, type StashGrid } from '../../core/src/stash/fit'
import { parseStashLayouts, STASH_SUBTABS, type StashLayoutFile, type StashSubtab } from '../../core/src/stash/layout'
import type { PhysRect } from '../src/ocr/strategy'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
/** 3.30 目前的版面表 */
export const LAYOUTS_330: StashLayoutFile = parseStashLayouts(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe1/stash/layouts.json'), 'utf8')))

export interface FitTarget { subtab: StashSubtab, grid: StashGrid }

export function createFitFakes (layouts: StashLayoutFile, getOffset: () => { x: number, y: number } = () => ({ x: 0, y: 0 })) {
  const s = {
    /** 畫面上真正的倉庫(client 座標);null = 沒對上 */
    target: null as FitTarget | null,
    /** 最近一次 `gray` 收到的搜尋範圍(影像座標) */
    area: null as PhysRect | null,
    areas: [] as PhysRect[],
    fits: 0,
    /** 每次 fit / verify 收到的影像(看 masks)與 fit 的先驗 */
    fitImgs: [] as GrayImage[],
    verifyImgs: [] as GrayImage[],
    priors: [] as FitPrior[],
    verifies: 0,
    /** 非 null = verify 一律回這個分數(測門檻邊界) */
    verifyScore: null as number | null,
    /** 擬合 / 驗證進行中要發生的事(例如按暫停熱鍵) */
    duringFit: null as (() => void) | null
  }
  const origin = () => { const o = getOffset(); const a = s.area ?? { x: 0, y: 0, width: 0, height: 0 }; return { x: a.x + o.x, y: a.y + o.y } }
  const toImage = (g: StashGrid): StashGrid => { const o = origin(); return { H: g.H, x: g.x - o.x, y: g.y - o.y } }
  const toClient = (g: StashGrid): StashGrid => { const o = origin(); return { H: g.H, x: g.x + o.x, y: g.y + o.y } }
  return {
    s,
    /** 目前畫面 = 這個子頁,格子位置照舊公式(client 寬高、資料夾偏移) */
    show (subtab: StashSubtab, clientW: number, clientH: number, yOffset = 0): FitTarget {
      s.target = { subtab, grid: formulaGrid(layouts, subtab, clientW, clientH, yOffset) }
      return s.target
    },
    none () { s.target = null },
    /** 掛在 `ScanCapture.gray`:記下搜尋範圍 */
    gray (rect: PhysRect): Uint8Array {
      s.area = { ...rect }
      s.areas.push({ ...rect })
      return new Uint8Array(1)
    },
    fit (img: GrayImage, file: StashLayoutFile, prior: FitPrior): FitResult | null {
      s.fits++
      s.fitImgs.push(img)
      s.priors.push(prior)
      s.duringFit?.()
      const t = s.target
      if (!t) return null
      const grid = toImage(t.grid)
      const rects = gridRects(file, t.subtab, grid)
      const scores = Object.fromEntries(STASH_SUBTABS.map(st => [st, st === t.subtab ? 1 : 0])) as Record<StashSubtab, number>
      return { subtab: t.subtab, rects, score: 1, scores, box: rects[0]?.w ?? 0, grid }
    },
    verify (img: GrayImage, _file: StashLayoutFile, subtab: StashSubtab, grid: StashGrid): number {
      s.verifies++
      s.verifyImgs.push(img)
      if (s.verifyScore != null) return s.verifyScore
      const t = s.target
      if (!t || t.subtab !== subtab) return 0
      const c = toClient(grid)
      return Math.abs(c.x - t.grid.x) < 0.5 && Math.abs(c.y - t.grid.y) < 0.5 && Math.abs(c.H - t.grid.H) < 0.5 ? 1 : 0
    }
  }
}
