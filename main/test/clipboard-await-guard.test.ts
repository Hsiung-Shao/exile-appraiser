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
      // 只看「緊鄰呼叫」的前綴(去掉呼叫對象如 this.io / clipboard):箭頭函式本體內的裸呼叫、同一行前面剛好有別的 await 都不算已處理
      const prefix = before.replace(/[\w$.?!]*$/, '')
      const handledBefore = /(\b(?:await|return|void)|=>)\s*$/.test(prefix)
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
      '  setTimeout(() => { io.writeText(saved) }, 120)',
      '  const t2 = await a(); io.writeText(b)',
      '}'
    ].join('\n')
    const found = findBareClipboardCalls(badSample)
    // 第 4、5 行是舊判斷(整行任意位置有 => / await 就放行)會漏掉的裸呼叫
    expect(found.map(f => f.line)).toEqual([2, 3, 4, 5])

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

describe('S2 Shortcuts 查價熱鍵的錯誤路徑守門(bug 審查 2026-10-24)', () => {
  const shortcuts = readFileSync(fileURLToPath(new URL('../src/Shortcuts.ts', import.meta.url)), 'utf8')

  it('fire-and-forget 的 copyAndReadItem 必須自己 catch(main 沒有 unhandledRejection 處理;舊版由尾端 .catch 吞掉)', () => {
    const m = shortcuts.match(/void this\.copyAndReadItem\([^\n]*/)
    expect(m).not.toBeNull()
    // onItem / assertOverlayActive 丟例外會變成未處理 rejection
    expect(m![0]).toMatch(/\.catch\(/)
  })

  it('arm(準備剪貼簿)失敗要放棄這次查價:arm 與送複製鍵之間必須 return', () => {
    const arm = shortcuts.indexOf('this.clipboard.armItemRead()')
    const press = shortcuts.indexOf('pressKeysToCopyItemText(', arm)
    expect(arm).toBeGreaterThan(-1)
    expect(press).toBeGreaterThan(arm)
    // 準備失敗仍送鍵:剪貼簿可能還是舊物品(被當成新複製)或 before 未知(結束時被寫成空字串)
    expect(shortcuts.slice(arm, press)).toMatch(/\breturn\b/)
  })
})
