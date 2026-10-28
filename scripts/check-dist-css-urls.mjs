// build 後檢查:dist 內每個 CSS 的 url() 指到的檔案都要真的存在。
// 為什麼:2026-10-24 Tailwind 4 升級時,`@tailwindcss/postcss` 內嵌 `@import` 不重寫相對 url(),
// Font Awesome 與遊戲字型的 18 個 url() 指向不存在的檔案,但 build、typecheck、CSS 規則比對全綠,圖示與字型在正式版才壞。
// 用法:node scripts/check-dist-css-urls.mjs [dist 目錄,預設 renderer/dist](由 renderer 的 build 腳本在 vite build 之後呼叫)。
// 檢查範圍:`data:` / `http(s):` / `#` / `blob:` 不查;`/xxx`(renderer/public 的絕對路徑)對 dist 根目錄查;其他依該 CSS 檔的位置解析。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 回傳缺檔清單 { css, url };dist 沒有 assets/ 時丟錯(代表 build 沒成功) */
export function findMissingCssUrls (dist) {
  const assets = join(dist, 'assets')
  if (!existsSync(assets)) throw new Error(`找不到 ${assets}(build 沒成功?)`)
  const missing = []
  let total = 0
  for (const name of readdirSync(assets).filter(n => n.endsWith('.css'))) {
    const file = join(assets, name)
    const css = readFileSync(file, 'utf8')
    for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)) {
      const url = m[2]
      if (/^(data:|https?:|#|blob:)/.test(url)) continue
      total++
      const path = url.split(/[?#]/)[0]
      const target = path.startsWith('/') ? join(dist, path) : resolve(dirname(file), path)
      if (!existsSync(target)) missing.push({ css: name, url })
    }
  }
  return { missing, total }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(process.argv[2] ?? 'renderer/dist')
  const { missing, total } = findMissingCssUrls(dist)
  for (const { css, url } of missing) console.error(`缺檔:${css} → ${url}`)
  console.log(`CSS url() 檢查:${dist} 共 ${total} 個,缺檔 ${missing.length}`)
  process.exit(missing.length ? 1 : 0)
}
