/**
 * exile-appraiser(2026-10-01):查價面板與設定視窗的自訂背景圖(不 import electron;main vitest 直接測)。
 *
 * - 使用者在設定 › 一般 › 背景按「選擇圖片」→ IPC `bg-pick` → main `dialog.showOpenDialog`(只列 png / jpg / webp)
 *   → 複製到 `userData/backgrounds/`(檔名 = 原檔名清理後 + 內容雜湊 8 碼)→ 設定只存**檔名**(`bg.file`)。
 * - 載入:Electron 視窗 `app://bg/<檔名>`(`main.ts` 的 `installAppProtocol`);瀏覽器預覽 `/t/<token>/bg/<檔名>`(`preview-server.ts`,token 保護)。
 *   兩邊都經 `resolveBgPath`:檔名先過 `normBgFile`(只准 png / jpg / jpeg / webp、不含路徑字元、不以 `.` 開頭),
 *   再確認解析後的路徑正好在 backgrounds 資料夾裡(不跳出資料夾)。
 * 規則照 PobTools `ui/src/lib/prefs.svelte.ts` 的 `normBgFile`(去掉影片)。
 */
import { createHash } from 'node:crypto'
import path from 'node:path'

/** 背景資料夾名稱(在 userData 底下) */
export const BG_DIR_NAME = 'backgrounds'

/** 允許的副檔名(小寫,不含點) */
export const BG_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const

const BG_FILE_RE = /^[^\\/:*?"<>|.\x00-\x1f][^\\/:*?"<>|\x00-\x1f]{0,199}\.(png|jpe?g|webp)$/i

/** 合法的背景檔名(只有檔名,沒有路徑);不合法 → '' */
export function normBgFile (v: unknown): string {
  return typeof v === 'string' && BG_FILE_RE.test(v) && !v.includes('..') ? v : ''
}

/** 背景檔名 → backgrounds 資料夾內的絕對路徑;檔名不合法或解析後跳出資料夾 → null */
export function resolveBgPath (dir: string, file: unknown): string | null {
  const name = normBgFile(file)
  if (!name) return null
  const base = path.resolve(dir)
  const full = path.resolve(base, name)
  if (path.dirname(full) !== base) return null
  const rel = path.relative(base, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel !== name) return null
  return full
}

/** `app://bg/<檔名>` 的路徑部分 → 檔名(URL 解碼);格式不對 → null(不做正規化,交給 resolveBgPath) */
export function bgFileFromPath (pathname: string): string | null {
  let raw = pathname.startsWith('/') ? pathname.slice(1) : pathname
  if (!raw || raw.includes('/')) return null
  try { raw = decodeURIComponent(raw) } catch { return null }
  return raw
}

export function bgContentType (file: string): string {
  const ext = path.extname(file).toLowerCase()
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
}

/**
 * 使用者選的圖 → 存進 backgrounds 資料夾的檔名:原檔名(去掉路徑與不允許的字元、開頭的點,最多 60 字)
 * + `-` + 內容 sha256 前 8 碼 + 小寫副檔名。副檔名不在白名單 → null。
 */
export function storedBgName (sourcePath: string, content: Uint8Array): string | null {
  const ext = path.extname(sourcePath).slice(1).toLowerCase()
  if (!(BG_EXTENSIONS as readonly string[]).includes(ext)) return null
  const stem = path.basename(sourcePath, path.extname(sourcePath))
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 60) || 'background'
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 8)
  const name = `${stem}-${hash}.${ext}`
  return normBgFile(name) || `background-${hash}.${ext}`
}
