/**
 * 一鍵回報的 UI 接線(純邏輯在 ./feedback.ts)。
 *
 * 入口三處:App.vue 底列「回報這件」、解析錯誤框「回報」、設定 › 關於「回報問題」(無物品,只帶環境資訊)。
 * 查詢 JSON:該物品載入後若真的送出過查詢(`Host.lastTradeQuery`,IPC.ts 在 POST search/exchange 時記下)就附上實際送出的;
 * 沒有(例如還沒搜尋、或 CheckedItem 內部改過篩選但沒送)就用 poe1 / poe2 的 `createPresets` 取 active 預設、
 * `createTradeRequest` 以預設篩選重算,並在內文註明。
 * 不含 accountName:`buildReport` 本身只讀白名單欄位,查詢 JSON 也會移除帳號類的鍵。
 */
import { shallowRef } from 'vue'
import { createPresets as poe1CreatePresets, createTradeRequest as poe1CreateTradeRequest, type ParsedItem } from '@exile-appraiser/poe1'
import * as Poe2 from '@poe2-entry'
import type { PresetOptions } from '@exile-appraiser/core/games/adapter'
import { AppConfig } from './Config'
import { Host } from './background/IPC'
import { loadedGame } from './games/active'
import { buildReport, copyReport, openIssue, type OpenIssuePath, type Report } from './feedback'

export interface ReportContext {
  clipboard?: string
  item?: unknown
  error?: string
  /** 物品載入(解析)的時間;之後送出的查詢才算這件物品的。 */
  loadedAt?: number
}

/** 最近一次回報動作的結果(UI 顯示提示用;`at` 讓同一路徑連按兩次也會刷新)。 */
export const reportStatus = shallowRef<{ kind: OpenIssuePath | 'copied' | 'error', at: number, message?: string } | null>(null)

function presetOptions (): PresetOptions & { defaultAllSelected: boolean } {
  const c = AppConfig()
  const pc = c.priceCheck
  return {
    league: c.leagueId ?? '',
    realm: c.realm,
    clientLanguage: c.language,
    searchStatRange: pc.searchStatRange,
    currency: pc.defaultCurrency,
    collapseListings: pc.collapseListings,
    activateStockFilter: pc.activateStockFilter,
    merchantOnly: pc.merchantOnly,
    defaultAllSelected: pc.defaultAllSelected
  }
}

/** 以預設篩選重算查詢(拿不到 CheckedItem 內部狀態時)。失敗回 undefined(不擋回報)。 */
function recomputeRequest (item: unknown): unknown {
  try {
    const opts = presetOptions()
    if (loadedGame.value === 'poe2') {
      const it = item as Poe2.Poe2ParsedItem
      const { presets, active } = Poe2.createPresets(it, opts)
      const preset = presets.find(p => p.id === active) ?? presets[0]
      return preset ? Poe2.createTradeRequest(preset, it) : undefined
    }
    const { presets, active } = poe1CreatePresets(item as ParsedItem, opts)
    const preset = presets.find(p => p.id === active) ?? presets[0]
    return preset ? poe1CreateTradeRequest(preset) : undefined
  } catch (e) {
    console.warn('[report] 重算查詢失敗', e)
    return undefined
  }
}

export function makeReport (ctx: ReportContext): Report {
  const c = AppConfig()
  let request: unknown
  let requestNote: string | undefined
  if (ctx.item) {
    const sent = Host.lastTradeQuery.value
    if (sent && ctx.loadedAt != null && sent.at >= ctx.loadedAt) {
      request = sent.body
      requestNote = `實際送出的查詢 / Query actually sent: POST ${sent.url.replace(/^https?:\/\/[^/]+/, '')}`
    } else {
      request = recomputeRequest(ctx.item)
      if (request !== undefined) requestNote = '以預設篩選重算(面板上改過的篩選不在內) / Recomputed with default filters'
    }
  }
  return buildReport({
    game: loadedGame.value,
    realm: c.realm,
    language: c.language,
    uiLanguage: c.uiLanguage,
    version: Host.version,
    clipboard: ctx.clipboard,
    item: ctx.item,
    request,
    requestNote,
    error: ctx.error,
    platform: typeof navigator !== 'undefined' ? navigator.userAgent : undefined
  })
}

const deps = {
  openExternal: (url: string) => Host.openExternal(url),
  writeClipboard: (text: string) => navigator.clipboard.writeText(text)
}

export async function reportIssue (ctx: ReportContext): Promise<OpenIssuePath | null> {
  try {
    const res = await openIssue(makeReport(ctx), deps)
    console.log(`[report] 開啟 issue 頁面(${res.path},網址 ${res.url.length} 字元)`)
    reportStatus.value = { kind: res.path, at: Date.now() }
    return res.path
  } catch (e) {
    console.error('[report] 回報失敗', e)
    reportStatus.value = { kind: 'error', at: Date.now(), message: (e as Error).message }
    return null
  }
}

export async function copyIssueReport (ctx: ReportContext): Promise<void> {
  try {
    await copyReport(makeReport(ctx), deps)
    reportStatus.value = { kind: 'copied', at: Date.now() }
  } catch (e) {
    console.error('[report] 複製失敗', e)
    reportStatus.value = { kind: 'error', at: Date.now(), message: (e as Error).message }
  }
}
