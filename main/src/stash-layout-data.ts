/**
 * PoE1 倉庫價格疊層:main 端讀 `data/poe1/stash/layouts.json`(游標換格判定用;renderer 另外 fetch 同一份)。
 * 位置同 `ocr/locate-data.ts`:打包後在 app 根目錄;開發 / selftest 在 repo 根的 data/,其次 renderer/dist/data/。
 * 啟動時讀一次(約 10 KB);讀不到記一次 log、回 null(游標事件不送,疊層仍顯示)。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseStashLayouts, type StashLayoutFile } from '../../core/src/stash/layout'

const REL = 'data/poe1/stash/layouts.json'

export function stashLayoutCandidates (baseDir: string): string[] {
  return [
    path.join(baseDir, REL),
    path.resolve(baseDir, '../..', REL),
    path.resolve(baseDir, '../../renderer/dist', REL)
  ]
}

let cached: StashLayoutFile | null | undefined

export function loadStashLayouts (baseDir: string = __dirname, log: (m: string) => void = console.log): StashLayoutFile | null {
  if (cached !== undefined) return cached
  for (const file of stashLayoutCandidates(baseDir)) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    try {
      cached = parseStashLayouts(JSON.parse(text))
      return cached
    } catch (e) {
      log(`[stash] ${file} 解析失敗:${e instanceof Error ? e.message : String(e)}`)
      cached = null
      return null
    }
  }
  log(`[stash] 找不到 ${REL}(${baseDir})`)
  cached = null
  return null
}
