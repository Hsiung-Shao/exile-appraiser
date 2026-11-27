// speedrun 每次嘗試的紀錄(2026-11-28 使用者要求:每次嘗試都存、預設日期時間可改名、可刪、可選一筆當比較對象、可設為個人最佳)。
// 紀錄存在路線上(跟著設定檔存);run.ts 在每次分段 / 撤銷時新增或更新「這次嘗試」那一筆(同 PB 的寫法,當機不丟)。
// 改了分段結構的舊紀錄保留,但 shape 不同 → 不能比較、不能設 PB。零依賴。
import type { Route } from './routes'

export interface RunRecord {
  id: string
  /** 空字串 = 用預設名稱(日期時間) */
  name: string
  /** 開始時間(毫秒時間戳) */
  at: number
  /** 每段累計毫秒;沒到 / 跳過 = null */
  splitTimes: Array<number | null>
  finished: boolean
  /** 中途開始(跳段);不能設為個人最佳 */
  partial: boolean
  /** 開始時路線的分段結構簽章(routeShape) */
  shape: string
}

/** 每條路線最多幾筆;滿了刪最舊的(比較對象除外) */
export const HISTORY_LIMIT = 500

export function routeShape (route: Pick<Route, 'splits'>): string {
  return `${route.splits.length}#` + route.splits.map(s => s.area ?? '').join('|')
}

export function recordTotal (rec: RunRecord): number | null {
  return rec.finished ? rec.splitTimes[rec.splitTimes.length - 1] ?? null : null
}

const p2 = (n: number) => String(n).padStart(2, '0')
export function recordLabel (rec: RunRecord): string {
  if (rec.name.trim()) return rec.name
  const d = new Date(rec.at)
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

export function compatible (rec: RunRecord, route: Route): boolean {
  return rec.shape === routeShape(route)
}

/** 比較對象的累計時間(合用的紀錄);沒選或分段不同 → null(呼叫端退回 PB) */
export function compareTimes (route: Route): Array<number | null> | null {
  const rec = route.compare == null ? undefined : route.history?.find(r => r.id === route.compare)
  return rec && compatible(rec, route) ? [...rec.splitTimes] : null
}

export function setPbFromRecord (route: Route, id: string): boolean {
  const rec = route.history.find(r => r.id === id)
  if (!rec || !rec.finished || rec.partial || !compatible(rec, route)) return false
  route.pb = [...rec.splitTimes]
  return true
}

export function deleteRecord (route: Route, id: string): boolean {
  const i = route.history.findIndex(r => r.id === id)
  if (i < 0) return false
  route.history.splice(i, 1)
  if (route.compare === id) route.compare = null
  return true
}

export function addRecord (route: Route, rec: RunRecord): void {
  route.history.push(rec)
  while (route.history.length > HISTORY_LIMIT) {
    const i = route.history.findIndex(r => r.id !== route.compare)
    if (i < 0) break
    route.history.splice(i, 1)
  }
}

const isTime = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)

/** 設定檔讀進來的紀錄:壞掉的單筆略過 */
export function normHistory (v: unknown): RunRecord[] {
  if (!Array.isArray(v)) return []
  const out: RunRecord[] = []
  for (const x of v as unknown[]) {
    const o = x as Record<string, unknown> | null
    if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id || typeof o.at !== 'number' || !Number.isFinite(o.at) ||
      !Array.isArray(o.splitTimes) || !o.splitTimes.every(isTime) || typeof o.shape !== 'string') continue
    if (out.some(r => r.id === o.id)) continue
    out.push({
      id: o.id,
      name: typeof o.name === 'string' ? o.name.slice(0, 60) : '',
      at: o.at,
      splitTimes: [...o.splitTimes] as Array<number | null>,
      finished: o.finished === true,
      partial: o.partial === true,
      shape: o.shape
    })
  }
  return out.slice(-HISTORY_LIMIT)
}
