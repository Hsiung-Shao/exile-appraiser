/**
 * uiohook-napi 原生模組路徑過長的修正(2026-10-03 實機回歸)。
 *
 * **根因**:libuiohook 以 `SetWindowsHookEx(WH_KEYBOARD_LL / WH_MOUSE_LL, proc, hInst, 0)` 裝全域掛鉤
 * (`uiohook-napi/libuiohook/src/windows/input_hook.c` `hook_run`),`hInst` 是 DllMain 存下的 **uiohook-napi.node 本身**
 * (`system_properties.c` `DllMain` DLL_PROCESS_ATTACH)。系統會依 hMod 取模組檔名,檔名過長時註冊失敗、
 * GetLastError = 0x7E(ERROR_MOD_NOT_FOUND),原生層回 `UIOHOOK_ERROR_SET_WINDOWS_HOOK_EX`。
 * 實測(Electron 40.10.6、同一個 .node 只換目錄深度):路徑 ≤ 251 字元 start 成功、≥ 252 字元每次都失敗,
 * 與「啟動時 start 還是之後才 start」、stop 後再 start 都無關。
 * 測試版放在很深的 scratchpad(…\resources\app.asar.unpacked\node_modules\uiohook-napi\prebuilds\win32-x64\uiohook-napi.node = 284 字元)
 * 因此從來沒成功過;正式安裝路徑(%LOCALAPPDATA%\Programs\…)很短所以 v0.1.1 正常。安裝程式允許自選目錄,使用者也可能踩到。
 *
 * **修法**:載入 uiohook-napi **之前**(`main.ts` 第一個 import 是 `uiohook-prebuild-init.ts`)檢查要載入的 .node 路徑長度,
 * 超過 `MAX_HOOK_MODULE_PATH` 就把同一個檔案複製到 `<userData>\native\uiohook-napi-<sha256 前 12 碼>\<原相對路徑>`,
 * 並設 `UIOHOOK_NAPI_PREBUILD` 讓 node-gyp-build 從那裡載入(node-gyp-build 4.x `load.resolve` 讀 `<套件名>_PREBUILD`)。
 * 目錄名含內容雜湊 → 升級後自然換目錄、舊檔被別的行程載入中也不必覆蓋。路徑夠短時什麼都不做。
 *
 * 純函式 `planUiohookPrebuild` / `toUnpackedPath` 有測試(`main/test/uiohook-prebuild.test.ts`);
 * 實機檢查:`node scripts/uiohook-hookcheck.mjs`(只註冊 / 解除掛鉤、不送輸入)。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

/** 實測 252 字元起失敗;留餘裕 */
export const MAX_HOOK_MODULE_PATH = 240
/** node-gyp-build:`'uiohook-napi'.toUpperCase().replace(/-/g, '_') + '_PREBUILD'` */
export const PREBUILD_ENV = 'UIOHOOK_NAPI_PREBUILD'

/** app.asar 內的路徑 → 實際在磁碟上的 app.asar.unpacked 路徑(原生模組一律 unpack;Electron 載入時同樣轉址) */
export function toUnpackedPath (p: string): string {
  // 兩種分隔符(path.win32.sep / posix)都處理;不用 regex 以免跳脫字元出錯
  const seps = [path.win32.sep, path.posix.sep]
  let out = p
  for (const a of seps) for (const b of seps) out = out.split(`${a}app.asar${b}`).join(`${a}app.asar.unpacked${b}`)
  return out
}

export interface PrebuildPlanInput {
  platform: string
  /** node-gyp-build 會載入的 .node(可能是 app.asar 內的寫法) */
  nodePath: string
  /** uiohook-napi 套件目錄(同一種寫法) */
  pkgDir: string
  /** 放短路徑副本的根目錄(`<userData>\native`) */
  shortRoot: string
  /** .node 內容的 sha256(hex) */
  hash: string
  maxLen?: number
}

export type PrebuildPlan =
  | { action: 'none', reason: string, source: string }
  | { action: 'redirect', reason: string, source: string, prebuildDir: string, target: string }

export function planUiohookPrebuild (i: PrebuildPlanInput): PrebuildPlan {
  const source = toUnpackedPath(i.nodePath)
  const maxLen = i.maxLen ?? MAX_HOOK_MODULE_PATH
  if (i.platform !== 'win32') return { action: 'none', reason: 'not-win32', source }
  if (source.length <= maxLen) return { action: 'none', reason: `path-ok(${source.length})`, source }
  const rel = path.win32.relative(toUnpackedPath(i.pkgDir), source)
  if (rel === '' || rel.startsWith('..') || path.win32.isAbsolute(rel)) return { action: 'none', reason: `unexpected-layout(${rel})`, source }
  const prebuildDir = path.win32.join(i.shortRoot, `uiohook-napi-${i.hash.slice(0, 12)}`)
  const target = path.win32.join(prebuildDir, rel)
  if (target.length > maxLen) return { action: 'none', reason: `short-copy-still-too-long(${target.length})`, source }
  return { action: 'redirect', reason: `path-too-long(${source.length})`, source, prebuildDir, target }
}

export interface PrebuildResult {
  /** 給 main.ts 寫進 log 的一行 */
  message: string
  redirected: boolean
}

/** 實際執行(main.ts 載入 uiohook-napi 之前呼叫一次;任何例外都吞掉並回報,不影響啟動) */
export function applyUiohookPrebuildRedirect (opts: { userData: string, fromFile: string }): PrebuildResult {
  try {
    const preset = process.env[PREBUILD_ENV]
    if (preset) return { message: `[uiohook] 沿用既有 ${PREBUILD_ENV}=${preset}`, redirected: true }
    if (process.platform !== 'win32') return { message: '[uiohook] 原生模組路徑檢查:not-win32', redirected: false }
    const req = createRequire(opts.fromFile)
    const pkgDir = path.dirname(path.dirname(req.resolve('uiohook-napi'))) // <pkg>/dist/index.js → <pkg>
    const ngb = createRequire(path.join(pkgDir, 'package.json'))('node-gyp-build') as { resolve: (dir: string) => string }
    const nodePath = ngb.resolve(pkgDir)
    const source = toUnpackedPath(nodePath)
    const plan = planUiohookPrebuild({
      platform: process.platform,
      nodePath,
      pkgDir,
      shortRoot: path.join(opts.userData, 'native'),
      // 只有要轉址時才讀檔算雜湊(一般安裝路徑不花這個成本)
      hash: source.length > MAX_HOOK_MODULE_PATH ? crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex') : ''
    })
    if (plan.action === 'none') return { message: `[uiohook] 原生模組路徑檢查:${plan.reason}`, redirected: false }
    const size = fs.statSync(plan.source).size
    if (!(fs.existsSync(plan.target) && fs.statSync(plan.target).size === size)) {
      fs.mkdirSync(path.dirname(plan.target), { recursive: true })
      const tmp = `${plan.target}.tmp-${process.pid}`
      fs.copyFileSync(plan.source, tmp)
      try { fs.renameSync(tmp, plan.target) } catch (e) {
        // 另一個行程剛好搶先寫好(可能已載入而鎖住);同雜湊目錄 = 同內容,用它的
        try { fs.rmSync(tmp, { force: true }) } catch {}
        if (!fs.existsSync(plan.target)) throw e
      }
    }
    process.env[PREBUILD_ENV] = plan.prebuildDir
    return { message: `[uiohook] 原生模組路徑過長(${plan.source.length} 字元,上限 ${MAX_HOOK_MODULE_PATH}),改從短路徑載入:${plan.target}`, redirected: true }
  } catch (e) {
    return { message: `[uiohook] 原生模組路徑檢查失敗(照原路徑載入):${e instanceof Error ? e.message : String(e)}`, redirected: false }
  }
}
