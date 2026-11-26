// PoE1 倉庫碎片頁的偵測範圍(純函式)。2026-11-26 起偵測改成格子擬合(`fit.ts`),不再 OCR 子頁按鈕列;
// 這裡只剩「格子可能出現在畫面哪一塊」:main 擬合的搜尋範圍、設定頁 / 框選層顯示的預設區域共用同一個算法。
// 零依賴:main(esbuild)以相對路徑 import。
import { stashLeft } from './layout'

export interface Rect { x: number, y: number, w: number, h: number }

function intersect (a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

/**
 * 倉庫格子可能出現的範圍(client 像素)。倉庫面板在畫面左側(超寬螢幕補黑邊 `stashLeft`):
 * 預設 x「黑邊 − 5% 高」起寬 70% 高、y 10%–85% 高(1440 基準格子區約 x 47–840、y 266–1000,資料夾內再下移 47;
 * 刻意放寬,給非 16:9 / UI 縮放留餘地)。使用者框過區域(client 比例)→ 用那塊再各邊外擴 10%(只當先驗,框歪一點也找得到)。
 */
export function stashSearchClientRect (client: { w: number, h: number }, region?: Rect | null): Rect {
  const full: Rect = { x: 0, y: 0, w: client.w, h: client.h }
  if (region && region.w > 0 && region.h > 0) {
    const r: Rect = { x: region.x * client.w, y: region.y * client.h, w: region.w * client.w, h: region.h * client.h }
    const mx = r.w * 0.1
    const my = r.h * 0.1
    const g = intersect({ x: Math.floor(r.x - mx), y: Math.floor(r.y - my), w: Math.ceil(r.w + 2 * mx), h: Math.ceil(r.h + 2 * my) }, full)
    if (g) return g
  }
  const h = client.h
  const x0 = Math.max(0, Math.floor(stashLeft(client.w, h) - h * 0.05))
  return intersect({ x: x0, y: Math.floor(h * 0.1), w: Math.ceil(h * 0.7), h: Math.ceil(h * 0.75) }, full) ?? full
}

/** 預設搜尋範圍換成 client 比例(設定頁 / 框選層顯示「目前區域」用;使用者沒框過時 main 用的就是這一塊) */
export function defaultStashRegion (clientW: number, clientH: number): Rect {
  const s = stashSearchClientRect({ w: clientW, h: clientH })
  return { x: s.x / clientW, y: s.y / clientH, w: s.w / clientW, h: s.h / clientH }
}

/** 搜尋範圍換成擷取影像矩形(減擷取偏移、夾在影像內;完全在影像外 = 0 × 0) */
export function stashSearchImageRect (size: { w: number, h: number }, region: Rect | null | undefined, client: { w: number, h: number }, offset: { x: number, y: number }): Rect {
  const c = stashSearchClientRect(client, region)
  return intersect({ x: c.x - offset.x, y: c.y - offset.y, w: c.w, h: c.h }, { x: 0, y: 0, w: size.w, h: size.h }) ?? { x: 0, y: 0, w: 0, h: 0 }
}
