// main 的純 Node 單元測試(不啟動 Electron):目前只有 preview-server。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
