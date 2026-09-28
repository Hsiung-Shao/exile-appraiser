import { defineConfig } from 'vitest/config'
import * as path from 'node:path'

/**
 * PoE1 adapter 的回歸網(移植自 apt-patched `renderer/vitest.config.mts`)。
 *
 * 相對上游少了三樣:vue plugin、`/data/` alias、apexcharts 替身。
 * 上游需要它們是因為 import 鏈碰得到 `.vue` 與 `import.meta.env.BASE_URL`;
 * 本 package 沒有 UI,資料改由 `configureDataSource(nodeDataSource(...))` 注入
 * (見 test/setup-data-source.ts),所以整條鏈在 Node 下是乾淨的。
 *
 * alias 必須與 tsconfig.json 的 `paths` 一致 —— 兩份漂開的話,測試通過就不再代表型別檢查會過。
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') }
    ]
  },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup-data-source.ts'],
    // 兩個語系的資料集不能同時載入(parser 用 module 層級的 CLIENT_STRINGS
    // 等全域變數),所以測試檔內逐一切換語系,不靠平行化。
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
