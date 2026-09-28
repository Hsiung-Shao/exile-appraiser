import path from 'node:path'
import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const ROOT = path.resolve(__dirname, '..')
const POE1_SRC = path.resolve(ROOT, 'poe1/src')
const POE2_SRC = path.resolve(ROOT, 'poe2/src')
const RENDERER_SRC = path.resolve(__dirname, 'src')

/**
 * `@/…` 的解析依「誰在 import」而定(Vite 的 resolve.alias 是全域的,做不到,所以用 pre 外掛):
 * - importer 在 poe2/src 底下:先找 poe2/src/<rest>,找不到才退回 renderer/src/<rest>
 *   (殼:Config / IPC / Leagues / i18n / overlay)。poe2 的移植檔逐字用 `@/parser`、`@/web/price-check/…`,
 *   它們必須指回 poe2 自己,而不是 poe1。
 * - 其他(renderer、poe1):維持原規則 —— parser / assets/data / web/price-check → poe1,其餘 → renderer/src。
 * poe2/tsconfig.vue.json 的 paths(`@/*` → [poe2/src, renderer/src])是同一套規則的型別版。
 */
function gameAwareAtAlias (): Plugin {
  const norm = (p: string) => p.split(path.sep).join('/').toLowerCase()
  const poe2Root = norm(POE2_SRC) + '/'
  return {
    name: 'exile-appraiser:game-aware-at-alias',
    enforce: 'pre',
    async resolveId (source, importer, options) {
      if (!source.startsWith('@/')) return null
      const rest = source.slice(2)
      const from = importer ? norm(importer.split('?')[0]) : ''
      const candidates: string[] = []
      if (from.startsWith(poe2Root)) {
        candidates.push(path.join(POE2_SRC, rest), path.join(RENDERER_SRC, rest))
      } else if (/^(parser|assets\/data|web\/price-check)(\/|$)/.test(rest)) {
        candidates.push(path.join(POE1_SRC, rest))
      } else {
        candidates.push(path.join(RENDERER_SRC, rest))
      }
      for (const candidate of candidates) {
        const resolved = await this.resolve(candidate, importer, { ...options, skipSelf: true })
        if (resolved) return resolved
      }
      return null
    }
  }
}
const DATA_DIR = path.resolve(ROOT, 'data')

/**
 * 資料檔住在 repo 根的 `data/`(給 CLI / 測試 / renderer 共用),不在 renderer/public。
 * 開發時由這個 plugin 把 `/data/*` 對到它;build 時整包複製到 `dist/data/`。
 */
function serveDataDir (): Plugin {
  return {
    name: 'exile-appraiser:data-dir',
    configureServer (server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/data/')) return next()
        const rel = decodeURIComponent(req.url.slice('/data/'.length).split('?')[0])
        const file = path.join(DATA_DIR, rel)
        if (!file.startsWith(DATA_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.statusCode = 404
          return res.end()
        }
        if (file.endsWith('.js')) res.setHeader('Content-Type', 'text/javascript')
        else if (file.endsWith('.json')) res.setHeader('Content-Type', 'application/json')
        else if (file.endsWith('.bin')) res.setHeader('Content-Type', 'application/octet-stream')
        fs.createReadStream(file).pipe(res)
      })
    },
    closeBundle () {
      const out = path.resolve(__dirname, 'dist/data')
      fs.rmSync(out, { recursive: true, force: true })
      fs.cpSync(DATA_DIR, out, { recursive: true })
    }
  }
}

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    assetsInlineLimit: 0
  },
  optimizeDeps: {
    esbuildOptions: { target: 'esnext' }
  },
  plugins: [gameAwareAtAlias(), vue(), serveDataDir()],
  resolve: {
    alias: [
      // 上游 `@/…` 路徑由 gameAwareAtAlias() 依 importer 解析(見上)。
      // renderer 引用兩個遊戲的 .vue 用明確前綴:
      { find: /^@poe1\/(.*)$/, replacement: POE1_SRC + '/web/price-check/$1' },
      { find: /^@poe2\/(.*)$/, replacement: POE2_SRC + '/web/price-check/$1' },
      // PoE2 的 renderer 入口(型別宣告在 src/web/games/poe2-entry.d.ts)
      { find: /^@poe2-entry$/, replacement: POE2_SRC + '/renderer-entry.ts' },
      { find: '@ipc', replacement: path.resolve(ROOT, 'ipc') }
    ]
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [ROOT] }
  }
})
