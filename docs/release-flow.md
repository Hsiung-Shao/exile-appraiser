# 發版流程(GitHub Releases + 自動更新)

自動更新由 `main/src/AppUpdater.ts`(electron-updater,GitHub provider)負責:
啟動後檢查一次、之後每 16 小時,讀 `https://github.com/Hsiung-Shao/exile-appraiser/releases/latest` 的 `latest.yml`。
**不自動下載**(沒有 code signing,理由見 AppUpdater.ts 註解):安裝版顯示「有新版」→ 使用者按下才下載 → 再按才安裝;
portable 只顯示 Releases 連結(`not-supported`)。`--no-updates` 關閉檢查。

> ⚠ 發版與 `git push` 都是對外動作:**使用者明確說「發」才做**。版號、changelog、打包可以先備好。

## 一次性前置
1. 使用者在 GitHub 建立公開 repo `Hsiung-Shao/exile-appraiser`(`main/electron-builder.yml` 的 `publish` 已指向它)。
   沒有 repo / 沒有 Release 前,檢查會 404 → 狀態 `error`(`errorKind: not-found`),只寫 log、不彈窗。
2. 首次 commit + push 由使用者決定時機。

## 每次發版
1. 改 root 與 `main/package.json` 的 `version`(`3.29.x`;major.minor 必須等於遊戲版本,見 CLAUDE.md 規則 4)→ `npm run check-user-agent`。
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
6. 發完用舊版安裝檔驗一次:關於頁「有新版」→ 下載 → 安裝。

## 離線驗證(不需 GitHub)
```bash
node scripts/make-fake-update-feed.mjs --serve 45678 --write-dev-config   # 假 latest.yml 3.29.1 + 假 exe,寫 main/dev-app-update.yml
npm run dev:main -- --window --force-update-check                           # log 應出現 updater-state available 3.29.1
```
驗完刪 `main/dev-app-update.yml`(已 gitignore)。portable 模擬:啟動前設環境變數 `PORTABLE_EXECUTABLE_DIR` → `reason=not-supported`。

## 相關文件
- [phase2-summary.md](phase2-summary.md)(WP3 自動更新摘要)
- [game-auto-switch.md](game-auto-switch.md)(`--ppz-log-file` 驗證 log)
- 專案守則:[../CLAUDE.md](../CLAUDE.md)
