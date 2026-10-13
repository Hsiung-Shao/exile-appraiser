// PoE1 倉庫固定版面(碎片頁:一般 / 聖甲蟲;不滅之火 2026-10-14 使用者決定不做)的格子換算。
// 版面資料 data/poe1/stash/layouts.json 由 scripts/sync-stash-layouts.mjs 從 Exile-UI(Lailloken,MIT)
// `data/global/[stash-ninja] tabs.json` 同步;換算規則移植自 Exile-UI `modules/stash-ninja.ahk`(逐格相同)。
// 零依賴:main(esbuild)以相對路徑 import。

export type StashSubtab = 'general' | 'scarabs'
export const STASH_SUBTABS: readonly StashSubtab[] = ['general', 'scarabs']

/** 1440 基準座標;x 或 y 為 0 = 接續前一格(x:前一格 + box + gap;y:同前一格) */
export interface StashLayoutCell { x: number, y: number, refName: string }

export interface StashLayoutFile {
  schema: 1
  base: 1440
  /** 子頁按鈕左上角(1440 基準;0 = 接續規則同格子,間距 168) */
  buttons: Record<StashSubtab, { x: number, y: number }>
  subtabs: Record<StashSubtab, StashLayoutCell[]>
}

/** client 實體像素 */
export interface CellRect { x: number, y: number, w: number, h: number, refName: string }

const BASE = 1440

function isCoord (v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

export function parseStashLayouts (json: unknown): StashLayoutFile {
  const o = json as Partial<StashLayoutFile> | null
  if (!o || typeof o !== 'object') throw new Error('stash layouts:不是物件')
  if (o.schema !== 1 || o.base !== BASE) throw new Error('stash layouts:schema / base 不符')
  if (!o.subtabs || typeof o.subtabs !== 'object') throw new Error('stash layouts:缺 subtabs')
  if (!o.buttons || typeof o.buttons !== 'object') throw new Error('stash layouts:缺 buttons')
  for (const id of STASH_SUBTABS) {
    const cells = (o.subtabs as Record<string, unknown>)[id]
    if (!Array.isArray(cells) || !cells.length) throw new Error(`stash layouts:${id} 不是非空陣列`)
    for (const [i, c] of cells.entries()) {
      if (!c || typeof c !== 'object' || !isCoord(c.x) || !isCoord(c.y) || typeof c.refName !== 'string' || !c.refName) {
        throw new Error(`stash layouts:${id}[${i}] 格式不符`)
      }
      if (i === 0 && (c.x === 0 || c.y === 0)) throw new Error(`stash layouts:${id} 第一格必須有完整座標`)
    }
    const b = (o.buttons as Record<string, unknown>)[id] as { x?: unknown, y?: unknown } | undefined
    if (!b || !isCoord(b.x) || !isCoord(b.y)) throw new Error(`stash layouts:buttons.${id} 格式不符`)
  }
  return o as StashLayoutFile
}

/** 格子邊長(Exile-UI:vars.client.h // tabs[tab].1) */
export function cellBox (subtab: StashSubtab, clientH: number): number {
  const div = subtab === 'scarabs' ? 32 : 24
  return Math.floor(clientH / div)
}

/** 同一列相鄰格的間距(Exile-UI 預設 gap:scarabs h//160、fragments Round(h/72)) */
export function cellGap (subtab: StashSubtab, clientH: number): number {
  if (subtab === 'scarabs') return Math.floor(clientH / 160)
  return Math.round(clientH / 72)
}

// AHK:x = Floor(Format("{:.10f}", v / 1440) * h)(先取 10 位小數再乘);y = Floor((v / 1440) * h)
function scaleX (v: number, clientH: number): number {
  return Math.floor(Number((v / BASE).toFixed(10)) * clientH)
}
function scaleY (v: number, clientH: number): number {
  return Math.floor((v / BASE) * clientH)
}

export function cellRects (file: StashLayoutFile, subtab: StashSubtab, clientH: number, yOffset = 0): CellRect[] {
  const box = cellBox(subtab, clientH)
  const gap = cellGap(subtab, clientH)
  const out: CellRect[] = []
  let x = 0
  let y = 0
  for (const c of file.subtabs[subtab]) {
    x = c.x ? scaleX(c.x, clientH) : x + box + gap
    y = c.y ? scaleY(c.y, clientH) : y
    out.push({ x, y: y + yOffset, w: box, h: box, refName: c.refName })
  }
  return out
}

/** 含左上、不含右下邊界 */
export function hitCell (rects: readonly CellRect[], x: number, y: number): CellRect | null {
  for (const r of rects) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r
  }
  return null
}
