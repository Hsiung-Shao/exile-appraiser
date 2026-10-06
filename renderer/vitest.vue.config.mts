// 查價面板元件的掛載測試(2026-10-03,修「查價面板一片空白」時加):沿用 vite.config.mts 的 vue 外掛與
// 依 importer 解析的 `@/…` 別名(poe2 的 .vue 才找得到自己的 `@/parser` 等),只跑 test-vue/。
// 純邏輯測試仍在 vitest.config.mts(node 環境、不載 Vue 外掛)。
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.mts'

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'node',
    include: ['test-vue/**/*.test.ts'],
    setupFiles: ['test-vue/setup.ts'],
    // .vue 要編成用戶端版(node 環境預設走 SSR 轉換,元件會變成 ssrRender、拿不到 $style / 用戶端掛載流程)
    // `**/*` 由 micromatch 比對(dot: false):路徑含點開頭的目錄(git worktree 在 `.claude/worktrees/…`)會比對不到 → 退回 SSR,
    // 掛載時 `useSSRContext()` 是 undefined;第二條讓這種路徑也走 web
    testTransformMode: { web: ['**/*', '**/.*/**/*'] },
    testTimeout: 120_000,
    hookTimeout: 300_000
  }
}))
