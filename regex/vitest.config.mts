import { defineConfig } from 'vitest/config'

/**
 * Poe Regex 回歸網:合成測試(C++ selftest T1–T16)、真實資料性質測試(兩遊戲 × 兩語言 × 六頁)、
 * golden(C++ `dist/regex_selftest.txt` 印出的逐字字串)、資料 schema。
 * 性質測試要對 12 份語料各建一次索引,給寬一點的逾時。
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000
  }
})
