# 發版流程(GitHub Releases + 自動更新)

自動更新由 `main/src/AppUpdater.ts`(electron-updater,GitHub provider;狀態機在 `updater-core.ts`)負責:
啟動後檢查一次、之後每 16 小時,讀 `https://github.com/Hsiung-Shao/exile-appraiser/releases/latest` 的 `latest.yml`。
- **設定 `autoUpdate`(預設開,設定 › 關於)+ 安裝版**:檢查到新版就在背景下載 → 關於頁顯示「已下載 vX,結束程式時自動套用」
  → 使用者**正常結束**程式(托盤「結束」、設定「結束程式」、`--quit`)時靜默執行安裝程式,下次啟動即新版;
  「立即重啟並更新」= `quitAndInstall(true, true)`(靜默安裝後自動啟動)。前提與取捨見 AppUpdater.ts 檔頭(2026-09-30 使用者裁定)。
- **`autoUpdate` 關**:原本的手動流程(有新版 → 按下載 → 按「重新啟動並安裝」,顯示安裝程式畫面)。
- portable 只顯示 Releases 連結(`not-supported`)。`--no-updates` 關閉檢查。

> ⚠ 發版與 `git push` 都是對外動作:**使用者明確說「發」才做**。版號、changelog、打包可以先備好。

## 一次性前置
1. 使用者在 GitHub 建立公開 repo `Hsiung-Shao/exile-appraiser`(`main/electron-builder.yml` 的 `publish` 已指向它)。
   沒有 repo / 沒有 Release 前,檢查會 404 → 狀態 `error`(`errorKind: not-found`),只寫 log、不彈窗。
2. 首次 commit + push 由使用者決定時機。

## 每次發版
1. 改 root、`main/package.json` 與各 workspace 的 `version`(`0.x.y` 語意版號:新功能升 minor、只有修正升 patch;見 CLAUDE.md 規則 4)
   → `npm run check-user-agent`(以實際 UA 打 GGG,必須全 200)。更新說明寫 `docs/release-notes/v<version>.md`(`--notes-file` 用它)。
2. `npm test`、`npm run typecheck` 全綠。
3. `npm run package` → 產物在 `main/dist/`(electron-builder 預設輸出目錄,`-p never` 不會上傳):
   - `ExileAppraiser-Setup-<version>.exe`(nsis,可就地更新)
   - `ExileAppraiser-Setup-<version>.exe.blockmap`(差分下載用)
   - `latest.yml`(electron-updater 讀的版本資訊;`path` 指向 Setup.exe,檔名必須與上傳的資產名一致)
   - `ExileAppraiser-<version>-portable.exe`
4. 乾淨機器裝一次(熱鍵 → 列表;intl / tw 各查一件)。
5. **等使用者說「發」**,才:
   ```bash
   gh release create v<version> --repo Hsiung-Shao/exile-appraiser --title "v<version>" --notes-file <notes.md> \
     main/dist/ExileAppraiser-Setup-<version>.exe \
     main/dist/ExileAppraiser-Setup-<version>.exe.blockmap \
     main/dist/ExileAppraiser-<version>-portable.exe \
     main/dist/latest.yml
   ```
   - 不要用 `--prerelease` / `--draft`:electron-updater 的 GitHub provider 預設只看正式 Release。
   - 四個檔缺一不可:少了 `latest.yml` 客戶端永遠看不到新版;少了 `.blockmap` 只是退回完整下載。
6. 發完用舊版安裝檔驗一次:關於頁顯示「已下載 vX,結束程式時自動套用」→ 托盤「結束」→ 再啟動應為新版
   (右下角啟動提示第一行為「已更新至 vX,在背景執行中」)。
   ⚠ Release 建立後約 1 分鐘內,GitHub 的 `releases/latest` 可能仍回舊版(客戶端看到「沒有新版」),稍等再檢查。

## 發版紀錄
- **v0.1.0**:首個公開版本(2026-09-30 重新發佈;舊的 v0.1.0 Release / tag 已刪除重建)。
- ~~v0.1.1(2026-09-30)~~:線上自動更新測試版(驗證 GitHub Releases 上的自動下載與結束時套用),**已撤下**(Release 與 tag 刪除,版號還原為 0.1.0)。
- **v0.1.1**(2026-10-01 備妥,重新使用此版號):符文塑形無 ninja 價自動查市集、褻瀆詞綴自動持續辨識、聊天指令與倉庫搜尋熱鍵(移植自 APT)、
  自訂背景圖與透明面板文字對比、熱鍵擷取 Alt 組合修正、移除按住 Alt 隱藏 overlay、褻瀆 / 符文設定對等(掃描間隔下限 100 ms)、README 中英雙語。
  更新說明 `docs/release-notes/v0.1.1.md`。⚠ 裝過已撤下測試版 0.1.1 的機器不會收到這一版(版號相同),需手動重裝。

## 啟動提示(已在背景執行)
程式啟動後沒有可見視窗,所以第一次收到 Electron 視窗的 host-config 時,在主螢幕工作區右下角(托盤上方,邊距 16px)
顯示約 3 秒的提示後淡出銷毀(`main/src/startup-toast.ts` 純邏輯 + `main.ts` `showStartupToast`):
- 視窗:無框、透明、置頂、不進工作列、`focusable: false` + `showInactive()`(不搶遊戲焦點)、`setIgnoreMouseEvents(true)`(點擊穿透);
  內容是 data URL(內嵌 CSS、無腳本、CSP `default-src 'none'`),深色島配色不隨淺色主題變。
- 文字:「流亡鑑價 v<版本> 已在背景執行」+「在遊戲中按 <查價熱鍵> 查價 · 系統匣圖示開啟設定」(依介面語言);
  `userData/last_run.json` 的 `lastRunVersion` 比目前版本舊 = 更新後第一次啟動 → 第一行改「已更新至 v<版本>,在背景執行中」。
- 不顯示:設定 › 一般「啟動時顯示背景執行提示」關(`startupToast`,預設開)、`--quit` / `--install-update`、`--preview` 啟動、
  預覽分頁送來的設定、第二實例、各種 `--*-selftest`。
- **遊戲啟動時再顯示一次**(第 16 步,`shouldShowGameAttachToast`):overlay 模式下遊戲視窗從「不在」變成「附著到」(`GameWindow.onAttach`,
  `onDetach` 把狀態清掉)時用同樣文字再顯示(「已更新至 vX」那行只在程式啟動那次,這裡一律用一般文字)。
  程式啟動時遊戲已在 = 本行程第一次 attach 且距開始追蹤(第一次 host-config 的 attachByTitle)不到 `STARTUP_ATTACH_GRACE_MS`(5 秒)→ 不重複;
  啟動後才開遊戲、遊戲關掉再開 → 顯示;沒經過 detach 的重複 attach 不顯示。同樣遵守 `startupToast`,window 模式 / `--preview` / selftest / 重新啟動中不顯示。
- **辨識開關通知**(第 16 步,`scanToastMessage`):按褻瀆辨識 / 符文辨識的暫停 / 繼續熱鍵後顯示切換後的實際狀態
  (「褻瀆辨識:已啟動 / 已暫停」「符文辨識:已啟動 / 已暫停」,英文 `Desecration detection: on / paused`、`Rune detection: on / paused`,跟 `uiLanguage`);
  兩個暫停鍵相同(合併動作 `scan-toggle-both`)時一個提示兩行。不受 `startupToast` 影響(是按鍵回饋)。
- **只有一個提示視窗**(`main.ts` `presentToast`):啟動提示、遊戲啟動提示、辨識通知共用;畫面上已有提示 → 重新 `loadURL` 換內容並重新計時
  (計時從 `did-finish-load` 起算 `TOAST_VISIBLE_MS + TOAST_FADE_MS`),連按不會疊多個視窗。
- 自我測試(不送任何輸入):`npx electron main/dist/main.js --toast-selftest <out.png> [--toast-lang=en] [--toast-updated] [--toast-hotkey=Ctrl + D] [--toast-scan=reveal:on,rune:paused]`
  → 開出提示視窗(不動畫、不自動關)、`webContents.capturePage()` 存 PNG、印 bounds / focusable 後結束。`--toast-scan` = 辨識開關通知(一項一行)。

## 離線驗證(不需 GitHub)
```bash
node scripts/make-fake-update-feed.mjs --serve 45678 --write-dev-config   # 假 latest.yml 3.29.1 + 假 exe,寫 main/dev-app-update.yml
npm run dev:main -- --window --force-update-check                           # log 應出現 updater-state available 3.29.1
```
驗完刪 `main/dev-app-update.yml`(已 gitignore)。portable 模擬:啟動前設環境變數 `PORTABLE_EXECUTABLE_DIR` → `reason=not-supported`。
(這條路是假 exe,只驗到 `available`;真的下載 / 安裝要走下面的「本機實測」。)

## 本機實測(兩個真的安裝檔,不對外發布)
用 `scripts/make-local-update-test.mjs` 打包 A(舊)、B(新)兩個 nsis 安裝檔,更新來源指向本機 generic feed
`http://127.0.0.1:45679/`,產物在 gitignored `.local-update-test/<版號>/`。

```powershell
node scripts/make-local-update-test.mjs                # npm run build + 打包 A=0.0.90、B=0.0.91(--a/--b/--port/--skip-build/--only a|b)
# 1. 關掉執行中的 ExileAppraiser;備份 %APPDATA%\exile-appraiser\config.json(記 SHA256)
# 2. 靜默安裝 A
Start-Process .local-update-test\0.0.90\ExileAppraiser-Setup-0.0.90.exe -ArgumentList '/S' -Wait
#    驗:%LOCALAPPDATA%\Programs\ExileAppraiser\resources\app-update.yml = provider generic + 本機 url;app.asar 內 package.json version = 0.0.90
# 3. 起 feed(背景),啟動 A 並寫 log
node scripts/make-local-update-test.mjs --serve
Start-Process "$env:LOCALAPPDATA\Programs\ExileAppraiser\ExileAppraiser.exe" -ArgumentList "--ppz-log-file=$env:TEMP\a.log"
#    log 應依序:updater-state checking → downloading 0.0.91 → downloaded 0.0.91 → autoInstallOnAppQuit=true
#    下載檔在 %LOCALAPPDATA%\exile-appraiser-updater\pending\(SHA256 應等於 B 的 Setup.exe)
# 4. 無輸入正常結束(第二個行程帶 --quit → 主行程走托盤「結束」同一條 quit 路徑)
Start-Process "$env:LOCALAPPDATA\Programs\ExileAppraiser\ExileAppraiser.exe" -ArgumentList '--quit' -Wait
#    A 的 log:second-instance --quit → Auto install update on quit → Executing …Setup-0.0.91.exe --updated /S
#    約 15 秒後安裝完成:app.asar version / exe FileVersion = 0.0.91
# 5. 啟動 B:log 應為 current=0.0.91、updater-state not-available
# 6. 「立即重啟並更新」路徑:重裝 A、等 downloaded 後 `ExileAppraiser.exe --install-update`(= 關於頁按鈕,quitAndInstall(true, true))
# 7. 收尾:停 feed;`npm run package`(正常 GitHub 設定)→ 靜默安裝 main\dist\ExileAppraiser-Setup-<正式版號>.exe;
#    確認 app-update.yml 指回 GitHub、版本正確;刪 %LOCALAPPDATA%\exile-appraiser-updater\pending 與 current.blockmap(測試留下的);
#    config.json SHA256 應與步驟 1 相同
```
- 版號不用 prerelease(`-localtest.1`):electron-builder 會改用 `<tag>.yml` 通道檔、electron-updater 也會切通道。
  預設用 `0.0.9x`(低於任何正式版),測完殘留的安裝仍會被正式版的自動更新蓋掉。
  (2026-09-30 的實測當時用 3.29.90 / 3.29.91 兩個版號,流程與下方結果相同。)
- 不能用 `-c.publish.provider=generic`:yml 的 publish 是陣列,CLI 物件會併進第一筆、殘留 owner/repo → schema 驗證失敗;腳本改產生
  `.local-update-test/electron-builder.local.yml`(publish 換成 generic,其餘逐字相同)再 `--config` 指過去。
- A 沒有舊版 blockmap(feed 只供應 B),log 會出現「Cannot download differentially, fallback to full download」,屬預期。
- **2026-09-30 實測結果**:步驟 2–5 全過(結束時自動套用、B 啟動後無新版、config.json 雜湊不變)。步驟 6 安裝成功(版本變 B),
  但安裝程式 `--force-run` 之後**沒有把 app 叫起來**;直接執行 `Setup.exe --updated /S --force-run` 也一樣 —— 在自動化 shell 裡
  NSIS `StdUtils.ExecShellAsUser` 沒啟動任何行程,**待使用者在一般桌面親測**「立即重啟並更新」是否會自動重新開啟。

### 單一實例控制參數(第二個行程轉交主行程,自己立刻結束;沒有主行程時什麼都不做)
- `--quit`:主行程走與托盤「結束」相同的正常結束(exit code 0,會觸發結束時自動套用更新)。
- `--install-update`:等同關於頁「立即重啟並更新」(只在 `downloaded` 時有作用)。

## 相關文件
- [phase2-summary.md](phase2-summary.md)(WP3 自動更新摘要)
- [game-auto-switch.md](game-auto-switch.md)(`--ppz-log-file` 驗證 log)
- 專案守則:[../CLAUDE.md](../CLAUDE.md)
