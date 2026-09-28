/**
 * 目前「資料已載入完成」的遊戲。設定的 `game` 一改,main.ts 先重載該遊戲的資料集與 app_i18n,
 * 載完才更新這個值 —— App.vue 依它選 parser 與 CheckedItem,所以不會拿舊遊戲的資料去解析新遊戲的物品。
 */
import { shallowRef } from 'vue'
import type { Game } from '@exile-appraiser/core/realm'

export const loadedGame = shallowRef<Game>('poe1')
