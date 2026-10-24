// 查價面板元件的掛載測試(2026-10-03,修「查價面板一片空白」時加):沿用 vite.config.mts 的 vue 外掛與
// 依 importer 解析的 `@/…` 別名(poe2 的 .vue 才找得到自己的 `@/parser` 等),只跑 test-vue/。
// 純邏輯測試仍在 vitest.config.mts(node 環境、不載 Vue 外掛)。
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, mergeConfig, type Plugin } from 'vitest/config'
import viteConfig from './vite.config.mts'

const PUBLIC = path.resolve(import.meta.dirname, 'public')

/**
 * 只給測試用:`<img src="/images/x.png">` 會被 plugin-vue 編成 `import '/images/x.png'`,vitest 4 起 Windows 上把它當
 * `file:///images/x.png` 去 `createRequire` 而失敗(vite-node 時代是碰巧回傳字串)。把 public/ 底下存在的絕對路徑解成虛擬模組、
 * 匯出原路徑字串。**不要**改 vite.config.mts 的 includeAbsolute:會讓正式版與預覽模式的圖片網址失去相對路徑。
 */
function publicAssets (): Plugin {
  return {
    name: 'exile-appraiser:test-public-assets',
    enforce: 'pre',
    resolveId (id) {
      return /^\/(?!@)/.test(id) && fs.existsSync(path.join(PUBLIC, id.slice(1))) ? '\0public:' + id : null
    },
    load (id) {
      if (id.startsWith('\0public:')) return `export default ${JSON.stringify(id.slice('\0public:'.length))}`
      return null
    }
  }
}

export default mergeConfig(viteConfig, defineConfig({
  plugins: [publicAssets()],
  test: {
    // .vue 要編成用戶端版:自訂環境宣告 viteEnvironment: 'client'(見 test-vue/env.ts;舊的 testTransformMode 在 vitest 4 起已移除)
    environment: './test-vue/env.ts',
    include: ['test-vue/**/*.test.ts'],
    setupFiles: ['test-vue/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000
  }
}))
