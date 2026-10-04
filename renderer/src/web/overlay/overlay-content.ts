/**
 * 第五輪 30.4:overlay 上目前有沒有東西要畫 → main(IPC `overlay-content`)據此閒置隱藏 overlay 視窗
 * (main `windowing/overlay-idle.ts`:全部 false 且 overlay 沒焦點 → 遊戲在前景時延遲 500 ms hide;任何一項變 true 立刻 showInactive)。
 *
 * 來源:App.vue 的查價面板 / 設定 / 框選層,加上兩個徽章層自己寫的 `overlayLayers`(`OcrBadges.vue` 不是 idle、
 * `RuneshapePrices.vue` 有徽章或層內提示)。**新增會畫在 overlay 上的東西,一定要接進這裡**,否則遊戲在前景時視窗可能是藏著的。
 * 右下角的啟動 / 辨識開關提示是另一個視窗(main `presentToast`),與這裡無關。
 */
import { reactive } from 'vue'
import type { OverlayContentState } from '@ipc/types'

/** 兩個徽章層的可見狀態(元件自己寫;卸載時寫回 false) */
export const overlayLayers = reactive({ reveal: false, rune: false })

/** App.vue 的狀態 + 徽章層 → 回報內容(純函式) */
export function overlayContentOf (
  app: { panel: boolean, settings: boolean, picker: boolean },
  layers: { reveal: boolean, rune: boolean }
): OverlayContentState {
  return { panel: app.panel, settings: app.settings, picker: app.picker, reveal: layers.reveal, rune: layers.rune }
}

/** 內容相同不重送用的鍵 */
export function overlayContentKey (c: OverlayContentState): string {
  return `${+c.panel}${+c.settings}${+c.picker}${+c.reveal}${+c.rune}`
}
