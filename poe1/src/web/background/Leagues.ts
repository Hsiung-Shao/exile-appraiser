// 上游 `web/background/Leagues.ts` 是 Vue 全域狀態;`create-item-filters.ts` 只用到 PERMANENT_SC。
// 純函式版在 core/realm/leagues.ts,這裡轉接讓上游檔案的 import 路徑不必改。
export { PERMANENT_SC } from '@exile-appraiser/core/realm/leagues'
