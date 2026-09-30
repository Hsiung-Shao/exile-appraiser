/**
 * 自動更新(electron-updater + GitHub Releases)。移植自 apt-patched `main/src/AppUpdater.ts`,
 * 差別:APT 走 WebSocket broadcast,這裡用 `send('updater-state')`(`Broadcaster`,也送預覽 client)+ `handlers()` 登錄表。
 * 狀態機與旗標規則在 `updater-core.ts`(純邏輯,有測試);這裡只注入真的 `autoUpdater` / `app`。
 *
 * - 啟動後第一次收到 host-config 時檢查一次(`checkAtStartup`,同時帶入設定 `autoUpdate`),之後每 16 小時。
 * - `--no-updates`:連檢查都不做(`disabled-by-flag`)。
 * - 開發模式(`VITE_DEV_SERVER_URL`)不檢查,只記 log;`--force-update-check` 可繞過(會讀 main/dev-app-update.yml,
 *   離線驗證用,見 `main/dev-app-update.yml.example` 與 `scripts/make-fake-update-feed.mjs`)。
 * - GitHub repo / Release 還不存在時檢查會 404:歸類成 `error`(errorKind `not-found`)**只寫 log,不彈對話框**。
 *
 * **自動下載、結束程式時自動套用(2026-09-30 使用者裁定,推翻原本 APT 的「永不自動下載」)。**
 *
 * 設定 `autoUpdate`(預設開)+ 安裝版(nsis):檢查到新版就在背景下載(`autoDownload`),下載完成後
 * 使用者結束程式時靜默執行安裝程式(`autoInstallOnAppQuit`),下次啟動就是新版;關於頁另有「立即重啟並更新」。
 * `autoUpdate` 關 = 原本的手動流程(檢查到 → 按下載 → 按安裝)。portable / 非 Windows 維持 `not-supported`(只導去 Releases)。
 *
 * 前提與取捨:
 * - 本專案**沒有 code signing**。原本拒絕自動下載的理由是「程式不該自作主張抓東西執行」;使用者裁定接受這個風險,
 *   換取不必每次手動更新。被掉包的 Release 在手動 / 自動兩種流程都會中,差別只在少了一次使用者同意。
 * - 就地更新不經瀏覽器下載,安裝檔沒有 Mark-of-the-Web,**不會跳 SmartScreen**(只有第一次從網頁下載的安裝檔會)。
 * - electron-updater 對 nsis 仍比對 `latest.yml` 的 **sha512**(下載檔在傳輸中被改會被擋);`app-update.yml` 沒有
 *   `publisherName`,所以不做 Authenticode 發行者比對。擋不住的仍是「發布來源本身被攻陷」。
 * - 安裝程式只在**正常結束**(托盤「結束」、設定「結束程式」、`--quit`,exit code 0)時執行;
 *   `app.exit()`(換遊戲的自我重新啟動)不觸發 quit 事件,所以不會半途套用。
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { HandlerTable } from './host-handlers'
import { UpdaterCore, type SendUpdaterState, type UpdaterLike } from './updater-core'

export type { SendUpdaterState } from './updater-core'

const CHECK_INTERVAL_MS = 16 * 60 * 60 * 1000

export class AppUpdater extends UpdaterCore {
  constructor (send: SendUpdaterState) {
    // 只出貨完整的 nsis 安裝檔,沒有 web installer(不設會每次下載都印警告)
    autoUpdater.disableWebInstaller = true
    autoUpdater.logger = {
      info: (m?: unknown) => { console.log('[updater]', m) },
      warn: (m?: unknown) => { console.warn('[updater]', m) },
      // 錯誤另由 'error' 事件歸類記一行;這裡只留第一行(全文夾整份回應標頭)
      error: (m?: unknown) => { console.log('[updater] (detail)', String(m).split(/\r?\n/)[0]) },
      debug: () => {}
    }
    const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
    if (isDev && process.argv.includes('--force-update-check')) autoUpdater.forceDevUpdateConfig = true
    super({
      // `on` 在 electron-updater 是逐事件多載的型別;UpdaterLike 只取用到的部分
      updater: autoUpdater as unknown as UpdaterLike,
      env: {
        argv: process.argv,
        portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
        platform: process.platform,
        version: app.getVersion(),
        isDev
      },
      send
    })
    setInterval(() => { void this.check() }, CHECK_INTERVAL_MS).unref()
  }

  /** 四個 IPC handler(由 main.ts 併入 `host-handlers.ts` 的登錄表;ipcMain 與瀏覽器預覽共用)。 */
  handlers (): HandlerTable {
    return {
      'updater-info': { kind: 'invoke', fn: () => this.info },
      'updater-check': { kind: 'invoke', fn: () => this.check() },
      'updater-download': { kind: 'invoke', fn: () => this.download() },
      'updater-install': { kind: 'invoke', fn: () => { this.install() } }
    }
  }
}
