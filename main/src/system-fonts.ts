/**
 * 系統已安裝字體清單(第 11 步「OCR 徽章外觀」的字體下拉;IPC `list-fonts`,預覽端可用、唯讀)。
 *
 * - 一次性 PowerShell 5.1:`System.Drawing.Text.InstalledFontCollection` 的 family 名稱(目前 UI 語系的名稱,
 *   繁中 Windows 上是「微軟正黑體」;Chromium 的 DirectWrite 比對認得各語系名稱)。
 * - 編碼:PowerShell 5.1 的 stdout 走系統 ANSI 碼頁,中文字體名會變問號 → 腳本把名稱以 `\n` 串起來、UTF-8 位元組轉 base64 再印,
 *   這裡解碼(只有 ASCII 經過管線)。
 * - 結果記憶體快取(成功才快取;同時多個呼叫共用一個行程);失敗 / 逾時 / 非 Windows → 空陣列(不擋 UI,設定頁只剩內建選項)。
 * - 沒有改用常駐 WinOcr 行程加指令:那個行程只在 PoE2 OCR 開著時存在,且忙碌時要排隊;一次性行程約 1.4 秒,只在開設定頁時跑一次。
 */
import { spawn } from 'node:child_process'

/** 列字體的 PowerShell 腳本(輸出單行 base64) */
export const LIST_FONTS_SCRIPT = [
  'Add-Type -AssemblyName System.Drawing',
  '$n = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }',
  '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($n -join [char]10)))'
].join('; ')

/** 字體名上限(防呆;正常字體名遠短於此) */
const MAX_NAME_LEN = 128
/** 清單上限(防呆;一般系統數百項) */
const MAX_FONTS = 5000

/**
 * 解析腳本輸出:base64 → UTF-8 → 逐行;去空白、去重(不分大小寫)、排序(`localeCompare`)。
 * 去掉含控制字元或引號 / 反斜線的名稱(CSS 字串不好跳脫,也不會是正常字體名)。壞輸出 → 空陣列。
 */
export function parseFontList (stdout: string): string[] {
  const b64 = stdout.replace(/\s+/g, '')
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return []
  const text = Buffer.from(b64, 'base64').toString('utf8')
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const name = raw.trim()
    // eslint-disable-next-line no-control-regex
    if (!name || name.length > MAX_NAME_LEN || /[\u0000-\u001f\u007f"\\�]/.test(name)) continue
    const k = name.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(name)
    if (out.length >= MAX_FONTS) break
  }
  return out.sort((a, b) => a.localeCompare(b, 'en'))
}

export type RunScript = (script: string, timeoutMs: number) => Promise<string>

/** 實際跑 PowerShell(`-EncodedCommand` = UTF-16LE base64,避免引號跳脫) */
export const runPowerShell: RunScript = async (script, timeoutMs) => await new Promise<string>((resolve, reject) => {
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true })
  let out = ''
  let err = ''
  const timer = setTimeout(() => { proc.kill(); reject(new Error(`timeout ${timeoutMs} ms`)) }, timeoutMs)
  proc.stdout.setEncoding('ascii')
  proc.stdout.on('data', (d: string) => { out += d })
  proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
  proc.on('error', (e) => { clearTimeout(timer); reject(e) })
  proc.on('close', (code) => {
    clearTimeout(timer)
    if (code === 0) resolve(out)
    else reject(new Error(`exit ${String(code)}${err ? `: ${err.trim().slice(0, 200)}` : ''}`))
  })
})

export interface FontLister {
  /** 字體清單(第一次呼叫才跑行程;成功後快取) */
  list: () => Promise<string[]>
}

export function createFontLister (opts: {
  run?: RunScript
  platform?: NodeJS.Platform
  timeoutMs?: number
  log?: (msg: string) => void
} = {}): FontLister {
  const run = opts.run ?? runPowerShell
  const platform = opts.platform ?? process.platform
  const timeoutMs = opts.timeoutMs ?? 15_000
  const log = opts.log ?? ((m: string) => { console.log(m) })
  let cached: string[] | null = null
  let pending: Promise<string[]> | null = null
  return {
    async list () {
      if (cached) return cached
      if (platform !== 'win32') return []
      if (pending) return await pending
      pending = (async () => {
        const t0 = Date.now()
        try {
          const fonts = parseFontList(await run(LIST_FONTS_SCRIPT, timeoutMs))
          if (fonts.length) cached = fonts
          log(`[fonts] 系統字體 ${fonts.length} 項(${Date.now() - t0} ms)`)
          return fonts
        } catch (e) {
          log(`[fonts] 列字體失敗:${(e as Error).message}`)
          return []
        } finally {
          pending = null
        }
      })()
      return await pending
    }
  }
}
