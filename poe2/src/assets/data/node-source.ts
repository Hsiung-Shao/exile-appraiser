import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DataSource } from '@exile-appraiser/core/games/adapter'

/**
 * Node 端的資料來源(CLI、vitest、Electron main 若需要):直接讀 `data/poe2/` 底下的檔案。
 * `client_strings.js` 是 ESM(`export default {...}`,含 RegExp),用 `import()` 載入。
 *
 * ⚠ 找不到檔案要明確丟錯。回空資料會讓解析器拿到空資料集,症狀變成
 *   「所有物品都查不到」而不是「資料檔缺了」(上游 setup-data-source.ts 的教訓)。
 */
export function nodeDataSource (dataDir: string): DataSource {
  const resolve = (rel: string) => path.join(dataDir, rel)
  const mustExist = async (p: string) => {
    try { await fs.access(p) } catch { throw new Error(`資料檔不存在:${p}`) }
    return p
  }
  return {
    async text (rel) {
      return fs.readFile(await mustExist(resolve(rel)), 'utf8')
    },
    async binary (rel) {
      const buf = await fs.readFile(await mustExist(resolve(rel)))
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    },
    async module (rel) {
      const p = await mustExist(resolve(rel))
      return (await import(/* @vite-ignore */ pathToFileURL(p).href)).default
    }
  }
}
