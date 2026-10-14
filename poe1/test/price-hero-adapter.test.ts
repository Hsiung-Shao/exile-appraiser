// P2(查價面板 B 改版):PoE1 掛單原幣 → chaos 換算(價格區建議售價用;真實物品資料,不連網)
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { nodeDataSource } from '@/assets/data/node-source'
import { poe1Adapter } from '../src/index'
import { poe1ToChaos, refNameOfTradeTag } from '@/web/price-check/price-hero-adapter'

const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeAll(async () => {
  await poe1Adapter.loadData(nodeDataSource(path.resolve(HERE, '../../data/poe1')), 'cmn-Hant')
})

describe('refNameOfTradeTag(交易站幣別 id → 英文 refName)', () => {
  it('exalted → Exalted Orb、alch → Orb of Alchemy', () => {
    expect(refNameOfTradeTag('exalted')).toBe('Exalted Orb')
    expect(refNameOfTradeTag('alch')).toBe('Orb of Alchemy')
  })
  it('不存在的 id → undefined', () => {
    expect(refNameOfTradeTag('no-such-currency')).toBeUndefined()
  })
})

describe('poe1ToChaos', () => {
  const chaosOf = (ref: string) => ({ 'Exalted Orb': 12, 'Orb of Alchemy': 0.2 } as Record<string, number>)[ref]

  it('沒有 divine 匯率(台服 / 沒有價格表)→ 不給換算器', () => {
    expect(poe1ToChaos(undefined, chaosOf)).toBeUndefined()
  })
  it('chaos 原值、divine 乘匯率、其他通貨查 poe.ninja 單價', () => {
    const f = poe1ToChaos(200, chaosOf)!
    expect(f(5, 'chaos')).toBe(5)
    expect(f(1.5, 'divine')).toBe(300)
    expect(f(2, 'exalted')).toBe(24)
    expect(f(10, 'alch')).toBe(2)
  })
  it('查不到價格的幣別 → undefined(摘要記為 skipped)', () => {
    expect(poe1ToChaos(200, chaosOf)!(1, 'mirror')).toBeUndefined()
  })
})
