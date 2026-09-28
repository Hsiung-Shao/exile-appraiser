// 移植自 Awakened PoE Trade `main/src/windowing/OverlayVisibility.ts`(MIT)。
// exile-appraiser: server.sendEventTo → send('visibility');不需要 GameConfig。
import { uIOhook, UiohookKey } from 'uiohook-napi'
import type { OverlayWindow, SendToRenderer } from './OverlayWindow'

export class OverlayVisibility {
  private timerId: NodeJS.Timeout | undefined
  private isOverlayVisible = true

  constructor (
    private send: SendToRenderer,
    private overlay: OverlayWindow
  ) {
    uIOhook.on('keydown', (e) => {
      if (e.altKey && !e.shiftKey && !e.ctrlKey && e.keycode === UiohookKey.Alt) {
        this.makeInvisible()
      } else {
        this.makeVisible()
      }
    })

    uIOhook.on('keyup', (e) => {
      if (!e.altKey) { this.makeVisible() }
    })

    uIOhook.on('mousemove', (e) => {
      if (!e.altKey) { this.makeVisible() }
    })
  }

  private makeVisible () {
    if (this.isOverlayVisible && this.timerId === undefined) return

    if (this.timerId !== undefined) {
      clearTimeout(this.timerId)
      this.timerId = undefined
    } else {
      this.isOverlayVisible = true
      console.log('[overlay] visibility isVisible=true')
      this.send('visibility', { isVisible: this.isOverlayVisible })
    }
  }

  private makeInvisible () {
    if (!this.isOverlayVisible || this.timerId !== undefined) return

    this.timerId = setTimeout(() => {
      this.timerId = undefined
      this.isOverlayVisible = false
      console.log('[overlay] visibility isVisible=false(按住 Alt)')
      this.send('visibility', { isVisible: this.isOverlayVisible })
    }, this.overlay.isInteractable ? 85 : 275)
  }
}
