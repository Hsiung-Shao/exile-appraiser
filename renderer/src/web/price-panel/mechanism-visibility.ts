// 2026-10-16 查價面板「機制」開關(使用者實機回饋:機制按鈕太佔畫面)。純函式(不 import vue)。
// 設定 `priceCheck.showMechanism`:預設關;關著時只有模式被改過(不是該列原本機制,見 mechanism-toggle.ts
// `mechanismDefault`)的列顯示機制按鈕。

export const DEFAULT_SHOW_MECHANISM = false

/** 只有 true 是開,其他值(舊設定檔沒有、壞值)一律關 */
export function normShowMechanism (v: unknown): boolean {
  return v === true
}
