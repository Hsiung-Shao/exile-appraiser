# Phase 2 摘要(2026-09-28)

Phase 1(PoE1/PoE2 × 國際服/台服查價、overlay、自動切換、打包)完成後的第二階段,共七個工作包。
細節在各自文件;這裡只列「做了什麼」與「已知限制」。

| 包 | 做了什麼 | 已知限制 |
|---|---|---|
| WP1 主題 / 介面語言 | `Config` 新增 `uiLanguage`(`cmn-Hant\|en`,首次照系統語系)、`theme`(slate/light/contrast/parchment)、`accent`、`fsBase` 11–18(舊 `fontSize` 自動升級);UI 字串改由 `uiLanguage` 驅動,切換不重載資料;`renderer/src/theme/pobtools.css` 取自 PobTools `app.css` + 本地 Noto Sans TC;Tailwind `gray.*` 等以別名指向 token,移植元件不改;補齊兩遊戲缺的根鍵(`Retry` 等) | 移植元件裡寫死的 hex 色不會跟主題變(只處理到 Tailwind class) |
| WP2 UI 分頁 | 標題列(品牌、遊戲/區服徽章、聯盟下拉)、overlay 面板 PobTools 風;設定五分頁(一般/查價/熱鍵與視窗/正則/關於);`HotkeyInput.vue` 擷取熱鍵並顯示註冊錯誤;啟動/切換載入狀態與重試;錯誤框 `.card` + 複製/回報;修 MANIFEST commit 顯示 | overlay 真遊戲流程(熱鍵、鎖定、失焦)需使用者實測 |
| WP3 自動更新 | `main/src/AppUpdater.ts`(electron-updater,GitHub provider):啟動一次 + 每 16h、`autoDownload=false`(**2026-09-30 改為設定 `autoUpdate` 預設開:自動下載、結束程式時套用**,見 release-flow.md)、portable → `not-supported` 導 Releases、`--no-updates`;404 只記 log;產物檔名固定無空白(`latest.yml` 對得上);離線驗證 `scripts/make-fake-update-feed.mjs` | 沒有 code signing(SmartScreen 會警告);GitHub repo 與第一版 Release 未建立,真流程未驗。見 [release-flow.md](release-flow.md) |
| WP4 關於 / 回報 / 托盤 i18n | 關於分頁(版本、資料來源 commit、更新狀態、連結列、贊助純文字、第三方致謝 + 授權 modal);`renderer/src/web/feedback.ts` 一鍵回報(預填 issue,> 6000 字元改剪貼簿,剝帳號/token 鍵);托盤選單雙語(`main/src/tray-strings.ts`,跟 `uiLanguage`) | issue 網址指向尚未建立的 repo,建 repo 前點了會 404 |
| WP5 Poe Regex | 新 workspace `regex/`(逐函式移植 PobTools `regex_gen.cpp` 等,碼點版)+ `data/regex/`(`scripts/sync-regex-data.mjs` 單向同步)+ 設定 › 正則 UI(三態模式、搜尋、分組、T17、長度三色、複製、書籤) | 沒有逐字 golden(需 PobTools 端加匯出旗標);目前以 selftest 報告數字 + 同 LCG 種子性質測試為基準。見 [regex-port.md](regex-port.md) |
| WP6 圖示 | `renderer/public/brand/{icon,tray}.svg` → `npm run build-icons`(sharp,冪等;ICO 每層嵌 PNG)→ `icon.png/ico`、`tray-*.png`;`electron-builder.yml` `win.icon`;移除 APT 圖示 | 托盤 16px 可辨識度以使用者實機觀感為準 |
| WP7 收尾 | lockfile 對齊、CLAUDE.md / README / docs 更新、全量驗證、打包、正式包無輸入啟動檢查 | 首次 commit / push / 建 repo / 發版逐項等使用者指示 |

## 仍待辦
- poe.ninja 參考價(兩個遊戲都還是「沒有價格」實作)。
- Regex 逐字 golden(PobTools 端 `--regex-selftest` 加匯出旗標,另開任務)。
- GitHub repo `Hsiung-Shao/exile-appraiser`、首次 commit/push、首次 Release → 之後驗真的自動更新流程。
- 台服 + 英文客戶端組合驗證後解禁(`isSupportedCombination`)。

## 相關文件
- [release-flow.md](release-flow.md)、[regex-port.md](regex-port.md)、[game-auto-switch.md](game-auto-switch.md)、[poe2-port-notes.md](poe2-port-notes.md)
- 專案守則:[../CLAUDE.md](../CLAUDE.md)
