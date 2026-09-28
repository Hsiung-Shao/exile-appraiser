// 移植自 Awakened PoE Trade `main/src/windowing/WidgetAreaTracker.ts`(MIT)。
// exile-appraiser: `OVERLAY->MAIN::track-area` 改成 `track(opts)`(main.ts 的 host-handlers 登錄表 'track-area' 呼叫);hide 走 send('hide-exclusive-widget')。
import { type Rectangle, type Point, screen } from 'electron'
import { uIOhook, type UiohookMouseEvent } from 'uiohook-napi'
import type { OverlayWindow, SendToRenderer } from './OverlayWindow'
import type { TrackAreaOpts } from '@ipc/types'

export class WidgetAreaTracker {
  private holdKey!: string
  private from!: Point
  private area!: Rectangle
  private closeThreshold!: number

  constructor (
    private send: SendToRenderer,
    private overlay: OverlayWindow
  ) {}

  track (opts: TrackAreaOpts) {
    this.holdKey = opts.holdKey
    if (process.platform === 'win32') {
      this.closeThreshold = opts.closeThreshold * opts.dpr
      this.from = screen.dipToScreenPoint(opts.from)
      // NOTE: bug in electron accepting only integers
      this.area = screen.dipToScreenRect(null, {
        x: Math.round(opts.area.x),
        y: Math.round(opts.area.y),
        width: Math.round(opts.area.width),
        height: Math.round(opts.area.height)
      })
    } else {
      this.closeThreshold = opts.closeThreshold
      this.from = opts.from
      this.area = opts.area
    }
    console.log(`[tracker] track-area holdKey=${this.holdKey} threshold=${this.closeThreshold.toFixed(1)} from=${this.from.x},${this.from.y} area=${this.area.x},${this.area.y} ${this.area.width}x${this.area.height}`)

    this.removeListeners()
    uIOhook.addListener('mousemove', this.handleMouseMove)
    uIOhook.addListener('mousedown', this.handleMouseDown)
  }

  removeListeners () {
    uIOhook.removeListener('mousemove', this.handleMouseMove)
    uIOhook.removeListener('mousedown', this.handleMouseDown)
  }

  private readonly handleMouseMove = (e: UiohookMouseEvent) => {
    const modifier = e.ctrlKey ? 'Ctrl' : (e.altKey ? 'Alt' : undefined)
    if (!this.overlay.isInteractable && modifier !== this.holdKey) {
      const distance = Math.hypot(e.x - this.from.x, e.y - this.from.y)
      if (distance > this.closeThreshold) {
        console.log(`[tracker] 游標離開 ${distance.toFixed(1)}px > ${this.closeThreshold.toFixed(1)} → hide-exclusive-widget`)
        this.send('hide-exclusive-widget')
        this.removeListeners()
      }
    } else if (isPointInsideRect(e, this.area)) {
      this.overlay.assertOverlayActive()
    } else if (this.overlay.isInteractable) {
      this.removeListeners()
      this.overlay.assertGameActive()
    }
  }

  private readonly handleMouseDown = (e: UiohookMouseEvent) => {
    if (isPointInsideRect(e, this.area)) {
      this.removeListeners()
      this.overlay.assertOverlayActive()
    }
  }
}

function isPointInsideRect (point: Point, rect: Rectangle) {
  return (
    point.x > rect.x &&
    point.x < rect.x + rect.width &&
    point.y > rect.y &&
    point.y < rect.y + rect.height
  )
}
