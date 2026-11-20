import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 中英兩份詞綴資料要對得上(使用者 2026-11-20:中英都要能正常跑)。
 * 這次的實例:規則 21 替英文補了 60 條帶數值的寫法,繁中因為既有寫法把數字寫死(「區域含有 1 個保險箱」)只補了 11 條
 * → 英文解析得到、繁中解析不到。資料更新後這裡紅 = 有詞綴只在一個語言解析得到。
 */
const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/poe1')
interface Stat { ref: string, matchers: Array<{ string: string }>, trade?: { ids?: Record<string, string[]> } }
function read (lang: string): Map<string, Stat> {
  const out = new Map<string, Stat>()
  for (const line of fs.readFileSync(path.join(DATA, lang, 'stats.ndjson'), 'utf8').split(/\r?\n/).filter(Boolean)) {
    const row = JSON.parse(line)
    for (const s of (row.stats ?? [row]) as Stat[]) out.set(s.ref, s)
  }
  return out
}
const en = read('en')
const zh = read('cmn-Hant')
const hasValueForm = (s: Stat): boolean => s.matchers.some(m => m.string.includes('#'))

// 已知例外:GGPK 的繁中沒有帶 # 的那一句(只能變少)
const ONLY_EN = ['Monsters with Silver Coins drop an additional Rare Item']

describe('中英詞綴資料對得上', () => {
  it('每條詞綴兩個語言都有、交易站 id 相同', () => {
    expect([...en.keys()].filter(ref => !zh.has(ref))).toEqual([])
    expect([...zh.keys()].filter(ref => !en.has(ref))).toEqual([])
    expect([...en].filter(([ref, s]) => JSON.stringify(s.trade?.ids ?? {}) !== JSON.stringify(zh.get(ref)!.trade?.ids ?? {})).map(([ref]) => ref)).toEqual([])
  })

  it('一個語言有帶數值的寫法,另一個語言也要有', () => {
    expect([...en].filter(([ref, s]) => hasValueForm(s) && !hasValueForm(zh.get(ref)!)).map(([ref]) => ref)).toEqual(ONLY_EN)
    expect([...en].filter(([ref, s]) => !hasValueForm(s) && hasValueForm(zh.get(ref)!)).map(([ref]) => ref)).toEqual([])
  })
})
