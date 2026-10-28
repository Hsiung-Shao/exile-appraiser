// 查價面板掛載測試的 vitest 環境(取代舊的 `testTransformMode.web`):
// vitest 4 起 `node` 環境固定對應 Vite 的 ssr 環境,plugin-vue 會把 .vue 編成 SSR 版(元件變 ssrRender、拿不到 $style / 用戶端掛載流程)。
// 自訂環境宣告 `viteEnvironment: 'client'` 讓 .vue 走用戶端轉換;DOM 仍由 `mini-dom.ts` 提供(不裝 jsdom / happy-dom),window / document 替身在 `setup.ts`。
import type { Environment } from 'vitest/runtime'

export default <Environment>{
  name: 'mini-dom',
  viteEnvironment: 'client',
  setup () {
    return { teardown () {} }
  }
}
