/**
 * exile-appraiser(WP-S 兩段式):main 端讀 `data/poe2/desecration/tiers.json` → 面板定位用的模板索引(`ocr-locate.ts`)。
 *
 * 資料位置(依序找第一個存在的):
 * - 打包後:app 根目錄(= `__dirname`,asar 內)`data/poe2/desecration/tiers.json` —— renderer build 把 repo `data/` 整包複製進 `renderer/dist/data/`,
 *   electron-builder 再把 `renderer/dist` 放到 app 根目錄。
 * - 開發 / `--ocr-selftest`(`main/dist/main.js`):`../../data/…`(repo 根的 data/),其次 `../../renderer/dist/data/…`。
 * 第一次按熱鍵才讀(1.4 MB,JSON.parse + 建索引約數十 ms),之後常駐;讀不到記一次 log、回 null(呼叫端只走整張 ×3)。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { buildLocateIndex, type LocateIndex, type LocateTiersLike } from '../../../poe2/src/desecration/ocr-locate'

const REL = 'data/poe2/desecration/tiers.json'

export function tiersCandidates (baseDir: string): string[] {
  return [
    path.join(baseDir, REL),
    path.resolve(baseDir, '../..', REL),
    path.resolve(baseDir, '../../renderer/dist', REL)
  ]
}

let pending: Promise<LocateIndex | null> | null = null

export function loadLocateIndex (baseDir: string = __dirname, log: (m: string) => void = console.log): Promise<LocateIndex | null> {
  if (!pending) {
    pending = (async () => {
      for (const file of tiersCandidates(baseDir)) {
        let text: string
        try {
          text = await fs.readFile(file, 'utf8')
        } catch {
          continue
        }
        try {
          const t0 = Date.now()
          const idx = buildLocateIndex(JSON.parse(text) as LocateTiersLike)
          log(`[ocr-reveal] 面板定位模板 ${idx.list.length} 個(${file},${Date.now() - t0} ms)`)
          return idx
        } catch (e) {
          log(`[ocr-reveal] tiers.json 解析失敗(${file}):${e instanceof Error ? e.message : String(e)}`)
          return null
        }
      }
      log(`[ocr-reveal] 找不到 ${REL}(${baseDir});只用整張 ×3`)
      return null
    })()
  }
  return pending
}
