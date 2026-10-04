// 移植自 Awakened PoE Trade `main/src/windowing/OverlayWindow.ts`(MIT)。
// exile-appraiser: WebSocket server → `send(channel, payload)`(webContents.send);BrowserWindow 由 main.ts 建立後傳入;
//               不開 webview、不自動開 DevTools;狀態變化印 log(開發/驗證用)。
// 第五輪 30.4:`isInteractable` 改成 getter / setter,改變時同步通知 `onInteractableChange`(main 的 overlay 閒置隱藏:
//               取得焦點前要先把被閒置隱藏的視窗顯示出來,所以 assertOverlayActive 先設旗標再 activateOverlay)。
import { BrowserWindow, dialog } from 'electron'
import { OverlayController } from 'electron-overlay-window'
import type { GameWindow } from './GameWindow'
import type { FocusChangeEvent } from '@ipc/types'

export type SendToRenderer = (channel: string, payload?: unknown) => void

export class OverlayWindow {
  private _isInteractable = false
  /** 第五輪 30.4:可互動狀態改變(同步呼叫;main 的 OverlayIdleHider.setInteractable) */
  public onInteractableChange: ((v: boolean) => void) | null = null
  get isInteractable (): boolean { return this._isInteractable }
  set isInteractable (v: boolean) {
    if (this._isInteractable === v) return
    this._isInteractable = v
    this.onInteractableChange?.(v)
  }

  public wasUsedRecently = true
  private overlayKey: string = 'Shift + Space'
  private isOverlayKeyUsed = false

  constructor (
    public readonly window: BrowserWindow,
    private send: SendToRenderer,
    private poeWindow: GameWindow
  ) {
    this.poeWindow.on('active-change', this.handlePoeWindowActiveChange)
    this.poeWindow.onAttach(this.handleOverlayAttached)
    this.window.webContents.on('before-input-event', this.handleExtraCommands)
  }

  assertOverlayActive = () => {
    if (!this.isInteractable) {
      console.log('[overlay] assertOverlayActive → overlay 取得焦點(可點擊)')
      this.isInteractable = true
      OverlayController.activateOverlay()
      this.poeWindow.isActive = false
    }
  }

  assertGameActive = () => {
    if (this.isInteractable) {
      console.log('[overlay] assertGameActive → 焦點還給遊戲')
      this.isInteractable = false
      OverlayController.focusTarget()
      this.poeWindow.isActive = true
    }
  }

  toggleActiveState = () => {
    this.isOverlayKeyUsed = true
    if (this.isInteractable) {
      this.assertGameActive()
    } else {
      this.assertOverlayActive()
    }
  }

  updateOpts (overlayKey: string, windowTitle: string, game?: string) {
    this.overlayKey = overlayKey
    this.poeWindow.attach(this.window, windowTitle, game)
  }

  /** 只改 overlay 焦點鍵(已 attach 後的 host-config 更新用,不再碰 attach)。 */
  setOverlayKey (overlayKey: string) {
    this.overlayKey = overlayKey
  }

  private handleExtraCommands = (event: Electron.Event, input: Electron.Input) => {
    if (input.type !== 'keyDown') return

    let { code, control: ctrlKey, shift: shiftKey, alt: altKey } = input

    if (code.startsWith('Key')) {
      code = code.slice('Key'.length)
    } else if (code.startsWith('Digit')) {
      code = code.slice('Digit'.length)
    }

    if (shiftKey && altKey) code = `Shift + Alt + ${code}`
    else if (ctrlKey && shiftKey) code = `Ctrl + Shift + ${code}`
    else if (ctrlKey && altKey) code = `Ctrl + Alt + ${code}`
    else if (altKey) code = `Alt + ${code}`
    else if (ctrlKey) code = `Ctrl + ${code}`
    else if (shiftKey) code = `Shift + ${code}`

    switch (code) {
      case 'Escape':
      case 'Ctrl + W': {
        console.log(`[overlay] overlay 內按 ${code} → 回遊戲`)
        event.preventDefault()
        process.nextTick(this.assertGameActive)
        break
      }
      case this.overlayKey: {
        event.preventDefault()
        process.nextTick(this.toggleActiveState)
        break
      }
    }
  }

  private handleOverlayAttached = (hasAccess?: boolean) => {
    if (hasAccess === false) {
      console.error('[overlay] 遊戲以系統管理員身分執行,overlay 無法存取')
      dialog.showErrorBox(
        'PoE window - No access',
        'Path of Exile 以系統管理員身分執行。\n' +
        'Path of Exile is running with administrator rights.\n' +
        '\n' +
        '請以系統管理員身分重新啟動 ExileAppraiser。\n' +
        'You need to restart ExileAppraiser with administrator rights.'
      )
    }
  }

  private handlePoeWindowActiveChange = (isActive: boolean) => {
    if (isActive && this.isInteractable) {
      this.isInteractable = false
    }
    const payload: FocusChangeEvent = {
      game: isActive,
      overlay: this.isInteractable,
      usingHotkey: this.isOverlayKeyUsed
    }
    console.log(`[overlay] focus-change game=${payload.game} overlay=${payload.overlay} usingHotkey=${payload.usingHotkey}`)
    this.send('focus-change', payload)
    this.isOverlayKeyUsed = false
  }
}
