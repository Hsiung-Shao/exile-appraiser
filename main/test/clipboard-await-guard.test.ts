// 靜態守門:Electron 44 起 clipboard.readText / writeText 回 Promise,TypeScript 不會報漏寫 await(被忽略的 Promise<void> 不算型別錯)。
// 掃描 main/src 內每個成員呼叫 `.readText(` / `.writeText(`:必須 await、return、`=>` 運算式本體、void 或 .catch / .then 處理。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CALL = /\.(readText|writeText)\(/g

/** 回傳「裸呼叫」(結果被丟掉的剪貼簿成員呼叫)的行號與內容 */
function findBareClipboardCalls (src: string): Array<{ line: number, text: string }> {
  const bad: Array<{ line: number, text: string }> = []
  const lines = src.split(/\r?\n/)
  let inBlockComment = false
  lines.forEach((raw, i) => {
    let line = raw
    // 區塊註解(含行內的 /* ... */ 與跨行)
    if (inBlockComment) {
      const end = line.indexOf('*/')
      if (end < 0) return
      inBlockComment = false
      line = line.slice(end + 2)
    }
    line = line.replace(/\/\*.*?\*\//g, '')
    const open = line.indexOf('/*')
    if (open >= 0) { inBlockComment = true; line = line.slice(0, open) }
    // 行註解
    const slash = line.indexOf('//')
    if (slash >= 0) line = line.slice(0, slash)
    if (/^\s*\*/.test(line)) return
    for (const m of line.matchAll(CALL)) {
      const idx = m.index ?? 0
      const before = line.slice(0, idx)
      const after = line.slice(idx)
      const handledBefore = /\b(await|return|void)\b/.test(before) || before.includes('=>')
      const handledAfter = /\.(catch|then)\(/.test(after)
      if (!handledBefore && !handledAfter) bad.push({ line: i + 1, text: raw.trim() })
    }
  })
  return bad
}

function listTsFiles (dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...listTsFiles(full))
    else if (e.name.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('G1 剪貼簿呼叫必須 await 的靜態守門', () => {
  it('掃描器會抓到裸呼叫、放過已處理與註解 / 宣告(防止守門恆過)', () => {
    const badSample = [
      'function f () {',
      "  clipboard.writeText('x')",
      '  const t = io.readText()',
      '}'
    ].join('\n')
    const found = findBareClipboardCalls(badSample)
    expect(found.map(f => f.line)).toEqual([2, 3])

    const goodSample = [
      "  await a.writeText('x')",
      '  const t = await a.readText()',
      '  return a.readText()',
      '  const f = (t: string) => a.writeText(t)',
      "  void a.writeText('x')",
      "  a.writeText('x').catch(() => {})",
      "  // a.writeText('x')",
      "  /* a.writeText('x') */",
      " * a.writeText('x')",
      '  writeText(text: string): void | Promise<void>',
      '  readText(): string | Promise<string>'
    ].join('\n')
    expect(findBareClipboardCalls(goodSample)).toEqual([])
  })

  it('main/src 內沒有任何未處理的 .readText( / .writeText( 呼叫', () => {
    const srcDir = fileURLToPath(new URL('../src/', import.meta.url))
    const files = listTsFiles(srcDir)
    // 掃描範圍至少含剪貼簿封裝本身,避免路徑錯誤造成空掃
    expect(files.some(f => f.endsWith('HostClipboard.ts'))).toBe(true)
    const offenders: string[] = []
    for (const f of files) {
      const rel = f.slice(srcDir.length).replace(/\\/g, '/')
      for (const b of findBareClipboardCalls(readFileSync(f, 'utf8'))) offenders.push(`${rel}:${b.line}  ${b.text}`)
    }
    expect(offenders).toEqual([])
  })
})
