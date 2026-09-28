// 只跑 renderer 的純邏輯單元測試(node 環境,不載 Vue 外掛 / 別名);UI 以無頭瀏覽器另外驗。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
