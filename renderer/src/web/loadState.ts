/**
 * 切遊戲 / 客戶端語言 / 介面語言時的重載狀態(main.ts 寫、App.vue 讀):
 * 面板頂端顯示 pulse 列(loading),失敗顯示錯誤 + 重試(error)。
 * 啟動時的第一次載入由 index.html 內嵌的 placeholder 負責(Vue 還沒掛上)。
 */
import { shallowRef } from 'vue'

export type ReloadPhase = 'idle' | 'loading' | 'error'

export const reloadPhase = shallowRef<ReloadPhase>('idle')
export const reloadError = shallowRef('')

let retryFn: (() => Promise<void>) | null = null

/** 包一次重載:期間 phase = loading,失敗 → error 並記住這次的工作給「重試」。 */
export async function runReload (work: () => Promise<void>): Promise<void> {
  retryFn = async () => { await runReload(work) }
  reloadPhase.value = 'loading'
  reloadError.value = ''
  try {
    await work()
    reloadPhase.value = 'idle'
    retryFn = null
  } catch (e) {
    console.error('[app] 重載失敗', e)
    reloadError.value = e instanceof Error ? e.message : String(e)
    reloadPhase.value = 'error'
  }
}

export function retryReload (): void {
  if (retryFn) void retryFn()
}
