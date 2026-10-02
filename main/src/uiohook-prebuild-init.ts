/**
 * 副作用模組:必須是 `main.ts` 的**第一個** import,在任何模組 `require('uiohook-napi')` 之前執行。
 * 原生模組路徑過長時改從短路徑載入(根因與做法見 `uiohook-prebuild.ts`)。
 * 結果先存起來,由 `main.ts` 在 log 檔掛好之後再印(這裡執行時 `--ppz-log-file` 還沒接上)。
 */
import { app } from 'electron'
import { applyUiohookPrebuildRedirect, type PrebuildResult } from './uiohook-prebuild'

export const uiohookPrebuildResult: PrebuildResult = applyUiohookPrebuildRedirect({ userData: app.getPath('userData'), fromFile: __filename })
