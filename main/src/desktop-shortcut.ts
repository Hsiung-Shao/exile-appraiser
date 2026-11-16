// 設定 › 一般「建立桌面捷徑」的純邏輯(不 import electron;main.ts 注入 shell.writeShortcutLink 等)。
// 釘選到工作列 Windows 不讓程式自己做,只能由使用者在捷徑上按右鍵。
import path from 'node:path'

/** 與安裝檔建立的捷徑同名(electron-builder 用 productName),按了不會多出第二個(安裝時選「所有使用者」除外:那個在公用桌面) */
export const DESKTOP_SHORTCUT_NAME = 'ExileAppraiser.lnk'
/** = electron-builder.yml 的 appId;捷徑與執行中的視窗用同一個,釘選後才會歸成同一個工作列圖示 */
export const APP_USER_MODEL_ID = 'com.hsiungshao.exile-appraiser'

/** 捷徑要指向的 exe:可攜版每次啟動都解壓到暫存目錄,execPath 下次就不在了 → 指向可攜 exe 本體 */
export function shortcutTarget (env: Record<string, string | undefined>, execPath: string): string {
  return env.PORTABLE_EXECUTABLE_FILE || execPath
}

export interface ShortcutDeps {
  isPackaged: boolean
  env: Record<string, string | undefined>
  execPath: string
  desktopDir: string
  exists: (path: string) => boolean
  /** = Electron shell.writeShortcutLink;回 false 或丟例外都算失敗 */
  write: (path: string, operation: 'create' | 'replace', options: { target: string, cwd: string, description: string, appUserModelId: string }) => boolean
}
export type ShortcutResult = { ok: true, path: string } | { ok: false, reason: 'dev' | 'failed' }

export function createDesktopShortcut (deps: ShortcutDeps): ShortcutResult {
  // 開發模式的 execPath 是 electron.exe,捷徑開起來不是這支程式
  if (!deps.isPackaged) return { ok: false, reason: 'dev' }
  const target = shortcutTarget(deps.env, deps.execPath)
  const file = path.win32.join(deps.desktopDir, DESKTOP_SHORTCUT_NAME)
  try {
    const ok = deps.write(file, deps.exists(file) ? 'replace' : 'create', {
      target, cwd: path.win32.dirname(target), description: 'ExileAppraiser', appUserModelId: APP_USER_MODEL_ID
    })
    return ok ? { ok: true, path: file } : { ok: false, reason: 'failed' }
  } catch (e) {
    console.warn('[shortcut] 建立桌面捷徑失敗', e)
    return { ok: false, reason: 'failed' }
  }
}
