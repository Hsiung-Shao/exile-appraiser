// 移植自 Awakened PoE Trade `main/src/windowing/GameWindow.ts`(MIT)。
// exile-appraiser: attach 事件多印 log(含 game);多 onDetach(倉庫頁籤捲動放掉掛鉤)。
// 效能修正第 17 步加回 screenshot()(OCR 擷取;原本移植時因沒有 OCR 而去掉)。
import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import { OverlayController, type AttachEvent } from 'electron-overlay-window'

export interface GameWindow {
  on: (event: 'active-change', listener: (isActive: boolean) => void) => this
}
export class GameWindow extends EventEmitter {
  private _isActive = false
  private _isTracking = false

  get bounds () { return OverlayController.targetBounds }

  get isActive () { return this._isActive }

  set isActive (active: boolean) {
    if (this.isActive !== active) {
      this._isActive = active
      this.emit('active-change', this._isActive)
    }
  }

  get isTracking () { return this._isTracking }

  attach (window: BrowserWindow | undefined, title: string, game?: string) {
    if (!this._isTracking) {
      OverlayController.events.on('focus', () => { console.log('[overlay] 遊戲視窗 focus'); this.isActive = true })
      OverlayController.events.on('blur', () => { console.log('[overlay] 遊戲視窗 blur'); this.isActive = false })
      OverlayController.events.on('detach', () => { console.log('[overlay] detach(遊戲視窗關閉)') })
      // attach log 只在這裡註冊一次(onAttach 有多處呼叫,放在它裡面會每次 attach 印多行)
      OverlayController.events.on('attach', (e: AttachEvent) => {
        console.log(`[overlay] attach hasAccess=${e.hasAccess} fullscreen=${e.isFullscreen} bounds=${e.x},${e.y} ${e.width}x${e.height}`)
      })
      console.log(`[overlay] attachByTitle "${title}"${game ? ` (game=${game})` : ''}`)
      OverlayController.attachByTitle(window, title, { hasTitleBarOnMac: true })
      this._isTracking = true
    } else {
      // 原生碼只允許 attach 一次(windows.c 以 strcmp 比對單一標題);換標題/換遊戲由 main.ts 重新啟動處理
      console.log(`[overlay] 已在追蹤視窗;"${title}" 需重新啟動才生效`)
    }
  }

  /**
   * 目前 attach 的遊戲 client 區截圖(BGRA top-down,寬高 = 原生最後收到的 attach / moveresize bounds;非 win32 throw)。
   * 呼叫端是 `ocr/capture.ts` `createOverlayClientCapture`(會驗尺寸 / 全黑,不行就退回 desktopCapturer)。
   */
  screenshot (): Buffer {
    return OverlayController.screenshot()
  }

  /** 遊戲視窗關閉(electron-overlay-window detach;不一定伴隨 blur)。倉庫頁籤捲動用來放掉 uiohook 掛鉤 */
  onDetach (cb: () => void) {
    OverlayController.events.on('detach', () => { cb() })
  }

  onAttach (cb: (hasAccess: boolean | undefined) => void) {
    OverlayController.events.on('attach', (e: AttachEvent) => { cb(e.hasAccess) })
  }
}
