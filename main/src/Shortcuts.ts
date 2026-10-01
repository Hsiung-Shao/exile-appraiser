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
 * - WP-S:`ocr-reveal`(`hotkeyOcrReveal`,預設 Ctrl+Shift+R)只在 overlay + PoE2 + 褻瀆自動辨識開著時註冊;觸發時只呼叫 `onOcrReveal`
 *   (2026-10-01 起 = 暫停 / 繼續褻瀆自動辨識),**不送也不放開任何按鍵**(見 docs/reveal-ocr.md)。
 * - WP-S2:`ocr-region`(`hotkeyOcrRegion`,預設空 = 不註冊)註冊條件同 `ocr-reveal`;觸發時只呼叫 `onOcrRegionPick`
 *   (renderer 開框選層),同樣不送也不放開任何按鍵。動作表抽到 `shortcut-actions.ts`(純函式,有測試)。
 * - WP-R2:`runeshape-toggle`(`hotkeyRuneshapeToggle`,預設空)= 符文塑形自動查價暫停 / 繼續;只呼叫 `onRuneshapeToggle`。
 *   2026-10-01:`runeshape-region`(`hotkeyRuneshapeRegion`,預設空)= 框選符文塑形面板,呼叫 `onOcrRegionPick('runeshape')`。
 * - 2026-10-01(移植 APT `Shortcuts.ts` 的 paste-in-chat / stash-search 分支):聊天指令與倉庫搜尋。照 APT 先放開熱鍵本身的按鍵,
 *   再交給 `text-box.ts`(寫剪貼簿 + 送按鍵序列,包在 `HostClipboard.restoreShortly`);兩個遊戲都可用,只在 overlay 模式註冊。
 *   遊戲保留鍵(`ipc/reserved-hotkeys.ts`,含 PoE2 的 Ctrl+Alt+C)不註冊。
 */
import { globalShortcut, screen } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { isModKey, KeyToElectron, mergeTwoHotkeys } from '@ipc/KeyToCode'
import type { GameId, HostConfigForMain, HotkeyRegistration, ItemTextEvent, OcrRegionPickTarget } from '@ipc/types'
import { HostClipboard } from './HostClipboard'
import { buildShortcutActions, normalizeHotkey, reservedShortcuts, sameShortcutActions, type ShortcutAction } from './shortcut-actions'
import { stashSearch, typeInChat, type TextBoxDeps } from './text-box'
import type { OverlayWindow } from './windowing/OverlayWindow'
import type { GameWindow } from './windowing/GameWindow'
import type { WidgetAreaTracker } from './windowing/WidgetAreaTracker'

type UiohookKeyT = keyof typeof UiohookKey

export { normalizeHotkey }

function shortcutToElectron (shortcut: string): string | null {
  const parts = shortcut.split(' + ').map(k => KeyToElectron[k as keyof typeof KeyToElectron])
  return parts.every(Boolean) && parts.length ? parts.join('+') : null
}

export class Shortcuts {
  private actions: ShortcutAction[] = []
  /** 目前遊戲:決定送給遊戲的複製組合鍵(PoE1 Ctrl+C / PoE2 Ctrl+Alt+C) */
  private game: GameId = 'poe1'
  private isRegistered = false
  /** 上一次 updateActions 的回傳(動作清單沒變時直接沿用,熱鍵註冊結果不變) */
  private lastResult: HotkeyRegistration | null = null
  readonly clipboard = new HostClipboard()

  constructor (
    private opts: {
      mode: 'overlay' | 'window'
      overlay?: OverlayWindow
      poeWindow?: GameWindow
      areaTracker?: WidgetAreaTracker
      onItem: (e: ItemTextEvent) => void
      /** WP-S:靈魂之井揭露面板 OCR(只在 overlay + PoE2 註冊;不送任何按鍵) */
      onOcrReveal?: () => void
      /** WP-S2:框選 OCR 區域熱鍵(註冊條件同 onOcrReveal;不送任何按鍵)。2026-10-01:`runeshape` = 符文塑形面板的框選熱鍵 */
      onOcrRegionPick?: (target: OcrRegionPickTarget) => void
      /** WP-R2:符文塑形自動查價暫停 / 繼續(不送任何按鍵) */
      onRuneshapeToggle?: () => void
    }
  ) {
    const { poeWindow } = opts
    if (opts.mode === 'overlay' && poeWindow) {
      poeWindow.on('active-change', (isActive) => {
        process.nextTick(() => {
          if (isActive === poeWindow.isActive) {
            if (isActive) {
              this.lastResult = this.register()
            } else {
              this.unregister()
              this.lastResult = { ok: true }
            }
          }
        })
      })
    }
  }

  /** 聊天指令 / 倉庫搜尋的真實送鍵(uiohook keyTap)與剪貼簿;純邏輯與按鍵序列在 text-box.ts(測試注入假的) */
  private textBoxDeps (): TextBoxDeps {
    return {
      tap: (key, mods) => { uIOhook.keyTap(UiohookKey[key as UiohookKeyT], mods.map(m => UiohookKey[m as UiohookKeyT])) },
      clipboard: this.clipboard
    }
  }

  private get shouldBeRegistered (): boolean {
    return this.opts.mode === 'window' || Boolean(this.opts.poeWindow?.isActive)
  }

  updateActions (cfg: HostConfigForMain): HotkeyRegistration {
    this.clipboard.updateOptions(cfg.restoreClipboard)
    this.game = cfg.game
    // WP-S / WP-S2:OCR 兩個熱鍵只在 overlay + PoE2 註冊;空字串 / 重複的熱鍵不註冊(shortcut-actions.ts)
    const nextActions = buildShortcutActions(cfg, this.opts.mode)
    // 動作清單(熱鍵 + 動作內容)與目前完全相同,且註冊狀態與「該不該註冊」一致 → 不 unregisterAll / 重註冊(中間空窗熱鍵會失效)
    if (this.lastResult && this.isRegistered === this.shouldBeRegistered && sameShortcutActions(this.actions, nextActions)) {
      return this.lastResult
    }
    this.actions = nextActions
    const reserved = reservedShortcuts(cfg)
    if (reserved.length) console.warn(`[shortcuts] 遊戲保留的熱鍵不註冊:${reserved.join(', ')}`)
    console.log(`[shortcuts] 複製鍵(${this.game}):${copyItemHotkey(this.game)}`)
    console.log(`[shortcuts] 動作:${this.actions.map(a => `${a.shortcut}=${a.action.type}${a.action.type === 'copy-item' && a.action.focusOverlay ? '(locked)' : ''}`).join(', ')}`)

    if (this.isRegistered) this.unregister()
    this.lastResult = this.shouldBeRegistered ? this.register() : { ok: true }
    return this.lastResult
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
    if (entry.action.type === 'ocr-reveal') {
      // WP-S:只截圖 + OCR,不動鍵盤(不放開修飾鍵、不送複製鍵)
      this.opts.onOcrReveal?.()
      return
    }
    if (entry.action.type === 'ocr-region' || entry.action.type === 'runeshape-region') {
      // WP-S2:只請 renderer 開框選層(overlay 焦點由 renderer 的 overlay-activate 取得),不動鍵盤
      this.opts.onOcrRegionPick?.(entry.action.type === 'runeshape-region' ? 'runeshape' : 'reveal')
      return
    }
    if (entry.action.type === 'runeshape-toggle') {
      // WP-R2:只切換掃描狀態,不動鍵盤
      this.opts.onRuneshapeToggle?.()
      return
    }
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
    if (action.type === 'paste-in-chat') {
      // 只記指令是第幾類,不記內容(可能含玩家名)
      console.log(`[shortcuts] 聊天指令(${action.text.startsWith('@last') ? '@last 前綴' : action.text.endsWith('@last') ? '@last 後綴' : action.text[0] ?? ''}${action.send ? ',送出' : ''})`)
      typeInChat(action.text, action.send, this.textBoxDeps())
      return
    }
    if (action.type === 'stash-search') {
      console.log('[shortcuts] 倉庫搜尋')
      stashSearch(action.text, { ...this.textBoxDeps(), assertGameActive: () => { this.opts.overlay?.assertGameActive() } })
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
