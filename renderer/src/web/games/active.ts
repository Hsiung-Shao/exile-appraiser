/**
 * 目前「資料已載入完成」的遊戲。設定的 `game` 一改,main.ts 先重載該遊戲的資料集與 app_i18n,
 * 載完才更新這個值 —— App.vue 依它選 parser 與 CheckedItem,所以不會拿舊遊戲的資料去解析新遊戲的物品。
 */
import { shallowRef } from 'vue'
import type { Game, Language } from '@exile-appraiser/core/realm'

export const loadedGame = shallowRef<Game>('poe1')

/**
 * 第 27 步:目前查價資料集的語系(= 面板上這件物品的解析語系)。國際服會依複製文字自動判斷語言,
 * 所以可能 ≠ 設定的客戶端語言(`AppConfig().language`)。`useIntlSite`(送英文名與否)、一鍵回報重算查詢依它;
 * 還沒載入 = undefined(用設定的客戶端語言)。
 */
export const dataLanguage = shallowRef<Language | undefined>(undefined)
