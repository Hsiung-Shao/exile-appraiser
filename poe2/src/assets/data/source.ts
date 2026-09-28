import type { DataSource } from '@exile-appraiser/core/games/adapter'

// exile-appraiser: 上游 `assets/data/index.ts` 與 `assets/client-string-loader.ts` 直接
// `fetch(import.meta.env.BASE_URL + 'data/…')` / 動態 import;本專案改由呼叫端注入 DataSource
// (瀏覽器版 browser-source.ts、Node 版 node-source.ts)。兩個模組共用這一個持有者。
let dataSource: DataSource | undefined

export function configureDataSource (source: DataSource): void {
  dataSource = source
}

export function source (): DataSource {
  if (!dataSource) throw new Error('資料來源未設定:先呼叫 configureDataSource()')
  return dataSource
}
