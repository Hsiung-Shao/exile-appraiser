// main 的純 Node 單元測試(不啟動 Electron):preview-server、OCR 策略、熱鍵動作表。
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // exile-appraiser(WP-S2):shortcut-actions.ts 用 `@ipc/KeyToCode`(執行期匯入),與 tsconfig paths 一致
  resolve: {
    alias: { '@ipc': fileURLToPath(new URL('../ipc', import.meta.url)) }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
