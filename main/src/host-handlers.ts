/**
 * main 端所有 IPC handler 的單一登錄表(WP-P):同一張表同時給 `ipcMain`(Electron renderer)與
 * 瀏覽器預覽伺服器(`preview-server.ts` 的 `~rpc`)用;事件一律走 `Broadcaster.broadcast`,
 * 同時送 webContents 與(放行清單內的)預覽 client。
 *
 * - `invoke`:`ipcMain.handle`(renderer `ipcRenderer.invoke`),回傳值即結果;預覽端可呼叫(除非 `preview: false`)。
 * - `send`:`ipcMain.on`(renderer `ipcRenderer.send`,不回傳);預覽端一律不開放(shim 端 no-op)。
 * - `sync`:`ipcMain.on` + `e.returnValue`(preload 啟動時的 `sendSync`);預覽端的值由 boot script 烤入。
 */
import { ipcMain, type WebContents } from 'electron'
import type { PreviewHandler } from './preview-server'

export type HandlerSource = 'electron' | 'preview'
export interface HandlerCtx {
  source: HandlerSource
  /** 預覽端的 client id(boot script 產生;`config-changed` 的 `source` 用它讓發起的分頁略過自己的回音)。 */
  clientId?: string
}
export type HostHandler = (ctx: HandlerCtx, ...args: any[]) => unknown
export interface HandlerEntry {
  kind: 'invoke' | 'send' | 'sync'
  fn: HostHandler
  /** false = 預覽端不能呼叫(視窗控制、overlay 相關)。`send` / `sync` 一律不開放。 */
  preview?: boolean
}
export type HandlerTable = Record<string, HandlerEntry>

const ELECTRON_CTX: HandlerCtx = { source: 'electron' }

/** 對 ipcMain 逐一註冊(行為與原本散在 main.ts / AppUpdater / WidgetAreaTracker 的 `ipcMain.handle/on` 相同)。 */
export function registerIpc (table: HandlerTable): void {
  for (const [channel, entry] of Object.entries(table)) {
    if (entry.kind === 'invoke') {
      ipcMain.handle(channel, (_e, ...args: unknown[]) => entry.fn(ELECTRON_CTX, ...args))
    } else if (entry.kind === 'send') {
      ipcMain.on(channel, (_e, ...args: unknown[]) => { void entry.fn(ELECTRON_CTX, ...args) })
    } else {
      ipcMain.on(channel, (e, ...args: unknown[]) => { e.returnValue = entry.fn(ELECTRON_CTX, ...args) })
    }
  }
}

/** 預覽伺服器用的 handler 子集(只含 `invoke` 且沒標 `preview: false` 的)。 */
export function previewHandlers (table: HandlerTable): Record<string, PreviewHandler> {
  const out: Record<string, PreviewHandler> = {}
  for (const [channel, entry] of Object.entries(table)) {
    if (entry.kind !== 'invoke' || entry.preview === false) continue
    out[channel] = (ctx, ...args) => entry.fn({ source: 'preview', clientId: ctx.clientId }, ...args)
  }
  return out
}

/**
 * 預覽端收得到的事件。其餘(`item-text`、`focus-change`、`visibility`、`hide-exclusive-widget`、`open-settings`、
 * WP-S 的 `ocr-reveal-result`、WP-S2 的 `ocr-region-pick`、WP-R2 的 `runeshape-scan-result`)
 * 只給 overlay:預覽分頁若也收 `item-text` 會替同一件物品再查一次價,交易站限流直接加倍。
 */
export const PREVIEW_EVENTS: ReadonlySet<string> = new Set(['config-changed', 'updater-state', 'switch-game'])

export type PreviewSink = (event: string, data: unknown) => void

export class Broadcaster {
  private previewSink: PreviewSink | null = null

  constructor (private readonly webContents: () => WebContents | null) {}

  setPreviewSink (sink: PreviewSink | null): void { this.previewSink = sink }

  broadcast = (name: string, payload?: unknown): void => {
    const wc = this.webContents()
    if (wc && !wc.isDestroyed()) wc.send(name, payload)
    if (this.previewSink && PREVIEW_EVENTS.has(name)) this.previewSink(name, payload)
  }
}
