/**
 * 全域熱鍵 → 送 Ctrl+C 給遊戲 → 讀剪貼簿 → `item-text`。
 *
 * 移植自 Awakened PoE Trade `main/src/shortcuts/Shortcuts.ts`(MIT)的 `copy-item` / `toggle-overlay` 分支。
 * exile-appraiser:
 * - 只有兩個查價動作(快速 = hotkeyHold + hotkey、keepModKeys;鎖定 = hotkeyLocked、focusOverlay)加 overlayKey。
 * - overlay 模式:**只在遊戲視窗前景時註冊**(GameWindow active-change);失焦就 unregister。
 * - window(備援)模式:沒有遊戲視窗可追,一律註冊;收到物品由 main.ts 把視窗移到游標旁。
 * - PoE1:3.29 起遊戲複製一律是進階格式,固定 Ctrl+C,不讀 production_Config.ini。
 * - PoE2(WP-R):Ctrl+C 只給一般格式(沒有 `{ 前綴 …(階層：N) }` 標頭),進階格式要多按「顯示進階詞綴」鍵,
 *   遊戲預設 Alt → 送 Ctrl+Alt+C。照 Exiled Exchange 2 `main/src/shortcuts/Shortcuts.ts` 的 pressKeysToCopyItemText
 *   (`mergeTwoHotkeys("Ctrl + C", showModsKey)`,showModsKey 預設 "Alt")。EE2 另外讀 poe2_production_Config.ini 的
 *   `show_advanced_item_descriptions` 改鍵;本專案先固定 Alt(改過這個鍵的玩家待支援,見 docs/desecration-tiers.md)。
 */
import { globalShortcut, screen } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { isModKey, KeyToElectron, mergeTwoHotkeys, hotkeyToString } from '@ipc/KeyToCode'
import type { GameId, HostConfigForMain, HotkeyRegistration, ItemTextEvent } from '@ipc/types'
import { HostClipboard } from './HostClipboard'
import type { OverlayWindow } from './windowing/OverlayWindow'
import type { GameWindow } from './windowing/GameWindow'
import type { WidgetAreaTracker } from './windowing/WidgetAreaTracker'

type UiohookKeyT = keyof typeof UiohookKey

interface ShortcutAction {
  shortcut: string
  keepModKeys: boolean
  action: { type: 'copy-item', focusOverlay: boolean } | { type: 'toggle-overlay' }
}

/** 設定檔可能寫 `Ctrl+D` / `ctrl + d`;統一成 APT 的 `Ctrl + D`。 */
export function normalizeHotkey (hotkey: string): string {
  const keys = hotkey.split('+').map(s => s.trim()).filter(Boolean)
    .map(k => {
      const lower = k.toLowerCase()
      if (lower === 'ctrl' || lower === 'control') return 'Ctrl'
      if (lower === 'alt') return 'Alt'
      if (lower === 'shift') return 'Shift'
      return k.length === 1 ? k.toUpperCase() : k
    })
  return hotkeyToString(keys)
}

function shortcutToElectron (shortcut: string): string | null {
  const parts = shortcut.split(' + ').map(k => KeyToElectron[k as keyof typeof KeyToElectron])
  return parts.every(Boolean) && parts.length ? parts.join('+') : null
}

export class Shortcuts {
  private actions: ShortcutAction[] = []
  /** 目前遊戲:決定送給遊戲的複製組合鍵(PoE1 Ctrl+C / PoE2 Ctrl+Alt+C) */
  private game: GameId = 'poe1'
  private isRegistered = false
  readonly clipboard = new HostClipboard()

  constructor (
    private opts: {
      mode: 'overlay' | 'window'
      overlay?: OverlayWindow
      poeWindow?: GameWindow
      areaTracker?: WidgetAreaTracker
      onItem: (e: ItemTextEvent) => void
    }
  ) {
    const { poeWindow } = opts
    if (opts.mode === 'overlay' && poeWindow) {
      poeWindow.on('active-change', (isActive) => {
        process.nextTick(() => {
          if (isActive === poeWindow.isActive) {
            if (isActive) {
              this.register()
            } else {
              this.unregister()
            }
          }
        })
      })
    }
  }

  private get shouldBeRegistered (): boolean {
    return this.opts.mode === 'window' || Boolean(this.opts.poeWindow?.isActive)
  }

  updateActions (cfg: HostConfigForMain): HotkeyRegistration {
    this.clipboard.updateOptions(cfg.restoreClipboard)
    this.game = cfg.game
    const quick = mergeTwoHotkeys(normalizeHotkey(cfg.hotkeyHold), normalizeHotkey(cfg.hotkey))
    const locked = normalizeHotkey(cfg.hotkeyLocked)
    const overlayKey = normalizeHotkey(cfg.overlayKey)
    const actions: ShortcutAction[] = [
      { shortcut: quick, keepModKeys: true, action: { type: 'copy-item', focusOverlay: false } },
      { shortcut: locked, keepModKeys: false, action: { type: 'copy-item', focusOverlay: true } }
    ]
    if (this.opts.mode === 'overlay') {
      actions.push({ shortcut: overlayKey, keepModKeys: false, action: { type: 'toggle-overlay' } })
    }
    // 空字串 / 重複的熱鍵不註冊
    const seen = new Set<string>()
    this.actions = actions.filter(a => {
      if (!a.shortcut || seen.has(a.shortcut)) return false
      seen.add(a.shortcut)
      return true
    })
    console.log(`[shortcuts] 複製鍵(${this.game}):${copyItemHotkey(this.game)}`)
    console.log(`[shortcuts] 動作:${this.actions.map(a => `${a.shortcut}=${a.action.type}${a.action.type === 'copy-item' && a.action.focusOverlay ? '(locked)' : ''}`).join(', ')}`)

    if (this.isRegistered) this.unregister()
    if (this.shouldBeRegistered) return this.register()
    return { ok: true }
  }

  private register (): HotkeyRegistration {
    if (this.isRegistered) return { ok: true }
    this.isRegistered = true
    const failed: string[] = []
    let firstFailedAccelerator: string | undefined
    for (const entry of this.actions) {
      const accelerator = shortcutToElectron(entry.shortcut)
      const isOk = accelerator != null && globalShortcut.register(accelerator, () => { this.trigger(entry) })
      if (!isOk) {
        failed.push(entry.shortcut)
        firstFailedAccelerator ??= accelerator ?? entry.shortcut
      }
    }
    console.log(`[shortcuts] register ${this.actions.map(a => a.shortcut).join(' / ')}${failed.length ? `(失敗:${failed.join(', ')})` : ''}`)
    return failed.length
      ? { ok: false, error: `hotkey ${failed.map(s => `"${s}"`).join(', ')} is already registered by another application`, accelerator: firstFailedAccelerator }
      : { ok: true }
  }

  private unregister () {
    if (!this.isRegistered) return
    globalShortcut.unregisterAll()
    this.isRegistered = false
    console.log('[shortcuts] unregister(遊戲視窗不在前景)')
  }

  private trigger (entry: ShortcutAction) {
    console.log(`[shortcuts] 觸發 ${entry.shortcut} (${entry.action.type})`)
    if (entry.keepModKeys) {
      const nonModKey = entry.shortcut.split(' + ').filter(key => !isModKey(key))[0]
      uIOhook.keyToggle(UiohookKey[nonModKey as UiohookKeyT], 'up')
    } else {
      entry.shortcut.split(' + ').reverse().forEach(key => { uIOhook.keyToggle(UiohookKey[key as UiohookKeyT], 'up') })
    }

    const { action } = entry
    if (action.type === 'toggle-overlay') {
      this.opts.areaTracker?.removeListeners()
      this.opts.overlay?.toggleActiveState()
      return
    }

    const pressPosition = screen.getCursorScreenPoint()
    this.clipboard.readItemText()
      .then(clipboard => {
        this.opts.areaTracker?.removeListeners()
        console.log(`[shortcuts] 讀到物品文字 ${clipboard.length} 字元,focusOverlay=${action.focusOverlay},游標 ${pressPosition.x},${pressPosition.y}`)
        this.opts.onItem({ clipboard, position: pressPosition, focusOverlay: action.focusOverlay })
        const { overlay } = this.opts
        if (action.focusOverlay && overlay?.wasUsedRecently) {
          overlay.assertOverlayActive()
        }
      }).catch(() => { /* 逾時:游標下沒有物品 */ })

    const combo = copyItemHotkey(this.game)
    console.log(`[shortcuts] 送出複製鍵 ${combo}(${this.game})`)
    pressKeysToCopyItemText(
      combo,
      entry.keepModKeys ? entry.shortcut.split(' + ').filter(key => isModKey(key)) : undefined
    )
  }
}

/**
 * 送給遊戲的「複製物品文字」組合鍵。
 * - PoE1(3.29):Ctrl+C 一律是進階格式。
 * - PoE2:進階格式(含褻瀆詞綴的遊戲階層)要 Ctrl + 顯示進階詞綴鍵(預設 Alt)+ C,與 EE2 相同。
 */
export function copyItemHotkey (game: GameId): string {
  return game === 'poe2'
    ? mergeTwoHotkeys('Ctrl + C', 'Alt')
    : mergeTwoHotkeys('Ctrl + C', 'Ctrl')
}

function pressKeysToCopyItemText (combo: string, pressedModKeys: string[] = []) {
  let keys = combo.split(' + ')
  keys = keys.filter(key => key !== 'C')
  if (process.platform !== 'darwin') {
    // On non-Mac platforms, don't toggle keys that are already being pressed.
    keys = keys.filter(key => !pressedModKeys.includes(key))
  }

  for (const key of keys) {
    uIOhook.keyToggle(UiohookKey[key as UiohookKeyT], 'down')
  }

  // finally press `C` to copy text
  uIOhook.keyTap(UiohookKey.C)

  keys.reverse()
  for (const key of keys) {
    uIOhook.keyToggle(UiohookKey[key as UiohookKeyT], 'up')
  }
}
