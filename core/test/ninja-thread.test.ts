/**
 * 3.30 綢帶(Thread)價格:poe.ninja exchange `type=Thread`(錄製檔 recordings/ninja/exchange_Thread.json,真實回應)。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NINJA_CATEGORIES, parseExchangeOverview } from '../src/ninja'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'recordings/ninja')

describe('T10 poe.ninja 綢帶類別', () => {
  it('PoE1 exchange 類別清單含 Thread', () => {
    // 沒加進清單 → 快取裡沒有綢帶價格,徽章全是「無價」
    expect(NINJA_CATEGORIES.poe1.exchange).toContain('Thread')
  })
  it('解析錄製檔:Ultimatum Thread 價格 > 0、鍵 currency|名稱、10 種綢帶都有價', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(DIR, 'exchange_Thread.json'), 'utf8')) as { lines: unknown[] }
    const parsed = parseExchangeOverview(doc, 'Thread')
    expect(parsed.lines).toHaveLength(doc.lines.length)
    const ult = parsed.lines.find(l => l.key === 'currency|Ultimatum Thread')
    expect(ult).toBeTruthy()
    expect(ult!.chaos).toBeGreaterThan(0)
    expect(ult!.type).toBe('Thread')
    expect(parsed.lines.filter(l => l.key.endsWith(' Thread') && l.chaos > 0)).toHaveLength(10)
  })
})
