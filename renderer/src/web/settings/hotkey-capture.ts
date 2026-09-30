/**
 * 熱鍵擷取欄(HotkeyInput.vue)的純邏輯與 overlay「按住 Alt 讓路」的判斷。
 *
 * - `keyEventToHotkey`:鍵盤事件 → APT 熱鍵字串(`Ctrl + Alt + D`);修飾鍵本身、未知鍵、F12 回 null。
 * - HotkeyInput 在**非修飾鍵按下(keydown)**時就以當下的修飾鍵組字串,不等 keyup:
 *   使用者常先放開 Alt 再放開 D,若照上游在 keyup 才組字串會得到 `Ctrl + D`。
 *   keyup 只補「沒有 keydown 的鍵」(Windows 的 PrintScreen 只送 keyup)。
 * - `hotkeyCaptureActive`:擷取欄取得焦點時為 true(App.vue 據此不因 Alt 隱藏 overlay)。
 * - `hideOverlayForAlt`:main `OverlayVisibility` 在單獨按住 Alt 時送 `visibility: false`(讓使用者看遊戲內物品說明);
 *   使用者正在設定 / 擷取熱鍵 / 框選時不隱藏 —— 否則 `visibility: hidden` 會讓取得焦點的擷取欄失焦,
 *   Ctrl+Alt+D 這類含 Alt 的組合根本收不到。
 */
import { shallowRef } from 'vue'
// 相對路徑:renderer 的 vitest 不載別名(vitest.config.mts)
import { KeyToCode, hotkeyToString } from '../../../../ipc/KeyToCode'

export interface HotkeyKeyEvent {
  code: string
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** 清除欄位的鍵(`required` 時不清除,由元件決定) */
export function isClearKey (code: string): boolean {
  return code === 'Backspace' || code === 'Delete' || code === 'Escape'
}

/** 鍵盤事件 → 熱鍵字串;修飾鍵本身 / 不支援的鍵 / F12(開發者工具)/ noModKeys 卻帶修飾鍵 → null */
export function keyEventToHotkey (e: HotkeyKeyEvent, noModKeys = false): string | null {
  let { code } = e
  if (code.startsWith('Key')) {
    code = code.slice('Key'.length)
  } else if (code.startsWith('Digit')) {
    code = code.slice('Digit'.length)
  } else if (e.key === 'Cancel' && code === 'Pause') {
    code = 'Cancel'
  }
  // AltLeft / ControlRight / ShiftLeft 等不在 KeyToCode 裡;明寫的 Ctrl / Shift / Alt 是修飾鍵本身,也不收
  if (code === 'Ctrl' || code === 'Shift' || code === 'Alt') return null
  if (!(KeyToCode as Record<string, number>)[code]) return null
  const hotkey = hotkeyToString([code], e.ctrlKey, e.shiftKey, e.altKey)
  if (hotkey.includes('F12')) return null
  if (noModKeys && hotkey.includes('+')) return null
  return hotkey
}

/** 熱鍵擷取欄取得焦點中 */
export const hotkeyCaptureActive = shallowRef(false)

export interface AltHideState {
  /** main 送來的 `visibility: false`(按住 Alt) */
  hideRequested: boolean
  /** 設定視窗顯示中 */
  settingsVisible: boolean
  /** OCR 框選層開著 */
  regionPickerOpen: boolean
  /** 熱鍵擷取欄取得焦點 */
  hotkeyCapturing: boolean
}

/** overlay 根元素是否因按住 Alt 隱藏(查價面板不論鎖定與否、符文塑形徽章照舊讓路) */
export function hideOverlayForAlt (s: AltHideState): boolean {
  if (!s.hideRequested) return false
  return !(s.settingsVisible || s.regionPickerOpen || s.hotkeyCapturing)
}
