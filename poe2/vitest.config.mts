import { defineConfig } from 'vitest/config'
import * as path from 'node:path'

/**
 * PoE2 adapter 的回歸網(移植自 ee2-patched `renderer/vitest.config.ts` + `renderer/specs/`)。
 *
 * 相對上游少了 vue plugin 與 `vite-tsconfig-paths`:本 package 的測試 import 鏈碰不到 `.vue`;
 * 資料改由 `configureDataSource(nodeDataSource(...))` 注入(見 test/vitest.setup.ts,取代上游三個 mock)。
 *
 * alias 必須與 tsconfig.json 的 `paths` 一致 —— 兩份漂開的話,測試通過就不再代表型別檢查會過。
 */
export default defineConfig({
  resolve: {
    alias: [
      // 測試專用:上游測試只取 Config 型別(src 不再 import @/web/Config;test/src-coupling.test.ts 守著)
      { find: /^@\/web\/Config$/, replacement: path.resolve(__dirname, 'test/shims/web-Config.ts') },
      { find: '@specs', replacement: path.resolve(__dirname, 'test') },
      { find: '@', replacement: path.resolve(__dirname, 'src') }
    ]
  },
  test: {
    include: ['test/**/*.test.ts'],
    // 上游 globals: true(部分 spec 沒 import describe/it 也能跑)
    globals: true,
    setupFiles: ['test/setup-default.ts'],
    // 語系資料集是 module 層級全域(CLIENT_STRINGS 等),測試檔內逐一切換語系,不靠平行化。
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000
  }
})
