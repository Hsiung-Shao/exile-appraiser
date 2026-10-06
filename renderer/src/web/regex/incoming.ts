/**
 * 一鍵從 PobTools 送正則分享碼:`incoming-share.ts` 的流程接上 store(單例)。
 * App.vue 收到 main 的 `regex-share`(或啟動時 `regexShareTake`)→ 開設定 › 正則 → `incomingShare.receive`;
 * RegexPanel.vue 顯示確認對話框(`incomingShare.view`)。
 */
import { decodeShare } from '@exile-appraiser/regex'
import { createIncomingShare } from './incoming-share'
import { applySharedState, currentComboOf, prepareShareState } from './store'

export const incomingShare = createIncomingShare({
  decode: decodeShare,
  prepare: prepareShareState,
  current: currentComboOf,
  apply: applySharedState,
  log: (msg) => { console.log(msg) }
})
