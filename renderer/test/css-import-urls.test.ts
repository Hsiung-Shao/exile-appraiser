// 守門:App.vue 的 <style> 用 `@import` 匯入、而檔案內含相對 `url()`(字型 / 圖)的 CSS,build 後會找不到檔案。
// 2026-10-24 Tailwind 4 升級踩到:`@tailwindcss/postcss` 內嵌 `@import` 時不重寫 url() 的相對路徑,
// Font Awesome(`../webfonts/*.woff2`)與遊戲字型(`./font/*.ttf`)被當成相對於 renderer/src/web/ 而不存在,
// dist 裡 18 個 url() 指向不存在的檔案,圖示與字型在正式版壞掉,而 build、typecheck、規則比對全綠。
// 這類 CSS 要由 JS 進入點匯入(`import 'x.css'`),Vite 才會依該檔自己的位置解析並輸出到 assets/。
// 另有 build 後的 `scripts/check-dist-css-urls.mjs`(接在 renderer 的 build 之後)查實際輸出。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const appVue = resolve(here, '../src/web/App.vue')
const repoRoot = resolve(here, '../..')

/** 取出 App.vue 所有 <style> 區塊內的 `@import 'x'` / `@import url('x')` 目標 */
function styleImports (vue: string): string[] {
  const out: string[] = []
  for (const block of vue.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const m of block[1].matchAll(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/g)) out.push(m[2])
  }
  return out
}

/** 解析成實體檔案路徑(相對 App.vue,或 node_modules 套件) */
function resolveImport (spec: string): string | null {
  const candidates = spec.startsWith('.')
    ? [resolve(dirname(appVue), spec)]
    : [resolve(repoRoot, 'node_modules', spec), resolve(repoRoot, 'renderer/node_modules', spec)]
  return candidates.find(existsSync) ?? null
}

/** CSS 內需要「依檔案位置解析」的 url()(排除 data: / http(s): / # / blob:;`/xxx` 是 renderer/public 的絕對路徑,原樣輸出、不受影響) */
function fileUrls (css: string): string[] {
  const urls: string[] = []
  for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)) {
    if (!/^(data:|https?:|#|blob:|\/)/.test(m[2])) urls.push(m[2])
  }
  return urls
}

describe('App.vue 的 CSS @import 不含需要解析的 url()', () => {
  const imports = styleImports(readFileSync(appVue, 'utf8'))

  it('找得到 App.vue 的 @import(守門本身沒失效)', () => {
    expect(imports.length).toBeGreaterThan(0)
    expect(imports.every(spec => resolveImport(spec) !== null), `解析不到:${imports.filter(s => !resolveImport(s)).join(', ')}`).toBe(true)
  })

  it('被 @import 的 CSS 都沒有字型 / 圖片之類的相對 url()', () => {
    const offenders = imports.flatMap(spec => {
      const file = resolveImport(spec)
      if (!file) return []
      const urls = fileUrls(readFileSync(file, 'utf8'))
      return urls.length ? [`${spec} → ${urls.slice(0, 2).join(', ')}${urls.length > 2 ? ` …共 ${urls.length} 個` : ''}`] : []
    })
    expect(offenders, '這些 CSS 要改由 renderer/src/main.ts `import` 才會被 Vite 正確解析 url()').toEqual([])
  })

  it('字型 / 圖示 CSS 改由 main.ts 匯入', () => {
    const main = readFileSync(resolve(here, '../src/main.ts'), 'utf8')
    expect(main).toMatch(/import\s+'@fortawesome\/fontawesome-free\/css\/all\.min\.css'/)
    expect(main).toMatch(/import\s+'animate\.css\/animate\.css'/)
    expect(main).toMatch(/import\s+'\.\/assets\/font\.css'/)
  })
})
