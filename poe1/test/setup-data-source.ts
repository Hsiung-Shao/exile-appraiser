import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureDataSource } from '@/assets/data'
import { nodeDataSource } from '@/assets/data/node-source'

/**
 * 讓 `src/data/index.ts` 在 Node 底下載入 `data/poe1/` 的資料集。
 *
 * 上游是靠 fetch mock 把 `/data/…` 請求轉成讀檔;本專案的資料層改成注入式,
 * 所以這裡只要設定來源。⚠ 不 mock 全域 fetch:測試不該偷偷讓真正的網路請求變成假的。
 */
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/poe1')

configureDataSource(nodeDataSource(DATA_DIR))
