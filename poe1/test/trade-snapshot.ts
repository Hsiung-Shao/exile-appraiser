// 交易站 `/api/trade/data/stats` 存檔(docs/trade-stats.json,`update.mjs --write` 會換成最新回應)推出的 stat id 集合。
// 含選項型 id 的每個選項(`id|選項`);取代原本另存的 stat id 表(2026-11-25 刪除)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TRADE_STATS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs/trade-stats.json')

interface StatsResponse { result: Array<{ entries: Array<{ id: string, option?: { options?: Array<{ id: string | number }> } }> }> }

export function tradeIdSet (stats: StatsResponse): Set<string> {
  const ids = new Set<string>()
  for (const g of stats.result) {
    for (const e of g.entries) {
      ids.add(e.id)
      for (const o of e.option?.options ?? []) ids.add(`${e.id}|${o.id}`)
    }
  }
  return ids
}

export const readTradeIds = (): Set<string> => tradeIdSet(JSON.parse(fs.readFileSync(TRADE_STATS_FILE, 'utf8')))
