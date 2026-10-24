// 守門:Font Awesome 7 的圖示預設等寬(`width: var(--fa-width, 1.25em)`,v6 是自然寬度、只有 `fa-fw` 才是 1.25em)。
// 專案沒有任何 `fa-fw`,升 FA 7 後 42 處 `fas` 圖示會變寬並置中、文字與圖示的間距跟著變(bug 審查 2026-10-24)。
// 相容層在 tailwind-preflight.css 的 base layer 把根的 `--fa-width` 設成 auto;真的要等寬的元素自己加 `fa-fw`(元素上的自訂屬性蓋過繼承值)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const preflight = read('../src/theme/tailwind-preflight.css')

/** 取出 `@layer base { … }` 區塊內容(相容層都在這裡,放在未分層會蓋過 pobtools / utilities) */
function baseLayerBody (css: string): string {
  const start = css.indexOf('@layer base {')
  if (start < 0) return ''
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  return ''
}

describe('Font Awesome 7 圖示寬度相容層', () => {
  it('相容層在 base layer 的 :root 把 --fa-width 設為 auto,圖示維持 v6 的自然寬度', () => {
    const body = baseLayerBody(preflight)
    const root = /:root\s*\{([^}]*)\}/.exec(body)
    expect(root, 'base layer 內要有 :root 規則').not.toBeNull()
    expect(root![1]).toMatch(/--fa-width:\s*auto\s*;/)
  })

  it('FA 的預設寬度仍是 var(--fa-width, 1.25em)、fa-fw 仍設 1.25em(升級 FA 後這個前提變了要重看相容層)', () => {
    const faCss = fileURLToPath(new URL('../../node_modules/@fortawesome/fontawesome-free/css/all.css', import.meta.url))
    const css = readFileSync(faCss, 'utf8')
    expect(css).toMatch(/width:\s*var\(--fa-width,\s*1\.25em\)/)
    expect(css).toMatch(/\.fa-fw,\s*\.fa-width-fixed\s*\{\s*--fa-width:\s*1\.25em;/)
  })
})
