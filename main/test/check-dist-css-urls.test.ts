// scripts/check-dist-css-urls.mjs:build 後檢查 dist CSS 的 url() 檔案都存在(2026-10-24 Tailwind 4 升級時字型檔遺失,build 全綠卻壞掉)。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error 腳本是 .mjs(無型別宣告)
import { findMissingCssUrls } from '../../scripts/check-dist-css-urls.mjs'

const dirs: string[] = []
function makeDist (files: Record<string, string>): string {
  const dist = mkdtempSync(join(tmpdir(), 'dist-css-'))
  dirs.push(dist)
  for (const [rel, text] of Object.entries(files)) {
    const full = join(dist, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, text)
  }
  return dist
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('findMissingCssUrls', () => {
  it('url() 指到不存在的檔案(如 ../webfonts/*.woff2)會被列出', () => {
    const dist = makeDist({ 'assets/index.css': '@font-face{src:url(../webfonts/fa-solid-900.woff2)}' })
    const r = findMissingCssUrls(dist)
    expect(r.total).toBe(1)
    expect(r.missing).toEqual([{ css: 'index.css', url: '../webfonts/fa-solid-900.woff2' }])
  })

  it('檔案存在(同層、上層、加引號、帶 ?# 後綴)都不算缺檔', () => {
    const dist = makeDist({
      'assets/index.css': '@font-face{src:url("./a.woff2?v=1#x")}.b{background:url(\'../img/b.png\')}',
      'assets/a.woff2': 'x',
      'img/b.png': 'x'
    })
    expect(findMissingCssUrls(dist)).toEqual({ missing: [], total: 2 })
  })

  it('data: / http(s): / # / blob: 不查,以 / 開頭的 public 路徑依 dist 根目錄查', () => {
    const dist = makeDist({
      'assets/index.css': '.a{background:url(data:image/png;base64,AAAA)}.b{background:url(https://x.test/a.png)}.c{filter:url(#f)}.d{src:url(/fonts/noto.ttf)}.e{src:url(/fonts/gone.ttf)}',
      'fonts/noto.ttf': 'x'
    })
    const r = findMissingCssUrls(dist)
    expect(r.total).toBe(2)
    expect(r.missing).toEqual([{ css: 'index.css', url: '/fonts/gone.ttf' }])
  })

  it('沒有 assets/ 目錄代表 build 沒成功,要丟錯而不是回報 0 缺檔', () => {
    const dist = makeDist({ 'index.html': '<html></html>' })
    expect(() => findMissingCssUrls(dist)).toThrow(/build 沒成功/)
  })
})
