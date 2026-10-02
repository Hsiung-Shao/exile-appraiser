// 效能修正(hiddenIndex 只收可見鍵 / build memo / combine 重用)的行為等價守門。
// golden(`golden/perf-equivalence.json`)由修改「之前」的實作產生:每個情境的 build / combine 輸出的 sha256。
// 產生來源:commit 36d0ac2 的父 commit bb686d0(修改前實作)+ 本檔(36d0ac2 版)以 PERF_EQ_WRITE=1 重產,與 repo 內 golden 逐位元組相同(2026-10-02 code review 第 D 批複驗)。
// 重生(僅在演算法有意改動時):`PERF_EQ_WRITE=1 npx vitest run test/perf-equivalence.test.ts`
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { combine } from '../src/combine'
import { buildCorpus, isCorpusPage, type RegexPage } from '../src/data'
import type { Mode } from '../src/gen'
import { loadAllPagesFor } from '../src/node'
import { samplePicks } from '../src/rng'

const GOLDEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'golden', 'perf-equivalence.json')
const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16)
const MODES: Mode[] = ['any', 'all', 'none']
const LANGS = ['zh', 'en'] as const

function pickSets (p: RegexPage): Array<[string, number[]]> {
  const n = p.entries.length
  const all = Array.from({ length: n }, (_, i) => i)
  const sets: Array<[string, number[]]> = [['all', all], ['first5', all.slice(0, 5)]]
  for (const [seed, cnt] of [[1, 3], [2, 10], [3, 40], [4, 120]] as const) sets.push([`r${seed}x${cnt}`, samplePicks(seed, n, cnt)])
  // 全選在 all 模式下很慢的超大頁:仍照跑(等價性最重要),上限由 vitest timeout 兜底
  return sets.filter(([, pk]) => pk.length > 0)
}

function compute (): Record<string, string> {
  const out: Record<string, string> = {}
  for (const game of ['poe1', 'poe2'] as const) {
    const pages = loadAllPagesFor(game)
    const corpusPages = pages.filter(isCorpusPage)
    for (const p of pages) {
      for (const lang of LANGS) {
        for (const mode of MODES) {
          for (const [name, pk] of pickSets(p)) {
            const key = `${game}|${p.id}|${lang}|${mode}|${name}`
            const parts: unknown[] = []
            if (isCorpusPage(p)) {
              const c = buildCorpus(p, lang)
              parts.push(c.build(pk, mode), c.build(pk, mode)) // 連兩次:memo 命中也必須同值
              parts.push(c.verify(pk, c.build(pk, mode).query))
            }
            const cmb = combine({ lang, mode, pages: [{ page: p, picks: pk }], excludes: name === 'r2x10' ? ['魔法', 'Life'] : undefined })
            parts.push(cmb)
            out[key] = sha(parts)
          }
        }
      }
    }
    // 多頁合併(聯集 corpus + 演算法片段 + 自訂 + 排除詞)
    for (let i = 0; i + 1 < corpusPages.length; i += 2) {
      const a = corpusPages[i]; const b = corpusPages[i + 1]
      const algo = pages.find(x => !isCorpusPage(x))
      for (const lang of LANGS) {
        for (const mode of MODES) {
          const sels = [
            { page: a, picks: samplePicks(11, a.entries.length, 15) },
            { page: b, picks: samplePicks(12, b.entries.length, 15) },
            ...(algo ? [{ page: algo, picks: [0, 1] }] : [])
          ]
          out[`${game}|multi|${a.id}+${b.id}|${lang}|${mode}`] = sha(combine({ lang, mode, pages: sels, custom: ['abc.d'], excludes: ['火', 'cold'] }))
        }
      }
    }
  }
  return out
}

describe('perf 修正的行為等價(對修改前的 golden)', () => {
  it('所有頁 × 語言 × 模式 × 多組勾選的 build / verify / combine 輸出逐字相同', () => {
    const got = compute()
    if (process.env.PERF_EQ_WRITE) {
      fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n')
      return
    }
    const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as Record<string, string>
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort())
    const bad = Object.keys(want).filter(k => got[k] !== want[k])
    expect(bad).toEqual([])
  }, 900_000)
})
