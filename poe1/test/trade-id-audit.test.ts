import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { audit, read } from '../../scripts/poe1-season/audit-trade-ids.mjs'

/**
 * 交易站 id 逐條比對(`scripts/poe1-season/audit-trade-ids.mjs`):快照裡每個 id 對資料有沒有引用、文字對不對、有沒有繁中。
 * 缺口鎖在 `docs/trade-id-audit-gaps.json`,只能變少:修好後 `UPDATE_FIXTURES=1` 重寫並看差異;清單外的新缺口 = 紅。
 * 整類不支援的類型(delve / ultimatum / crucible)本專案完全沒有,不逐條鎖,只鎖「沒有任何一條 ok」。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SNAPSHOT = path.join(HERE, 'docs/trade-stats-3.30.json')
const GAPS_FILE = path.join(HERE, 'docs/trade-id-audit-gaps.json')
const UNSUPPORTED = ['delve', 'ultimatum', 'crucible']

const trade = (JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) as { result: Array<{ id: string, entries: Array<{ id: string, text: string }> }> })
  .result.filter(g => g.id !== 'pseudo').flatMap(g => g.entries)
const rows = audit(trade, read('en'), read('cmn-Hant')) as Array<{ type: string, id: string, verdict: string }>

const gaps: Record<string, string> = {}
for (const r of rows) if (r.verdict !== 'ok' && !UNSUPPORTED.includes(r.type)) gaps[r.id] = r.verdict
// 只在更新模式寫一次
if (process.env.UPDATE_FIXTURES) fs.writeFileSync(GAPS_FILE, JSON.stringify(gaps, null, 1) + '\n')
const known = JSON.parse(fs.readFileSync(GAPS_FILE, 'utf8')) as Record<string, string>

describe('交易站 id 逐條比對', () => {
  it('交易站 id 的缺口不超出已知清單', () => {
    expect(Object.entries(gaps).filter(([k, v]) => known[k] !== v)).toEqual([])
  })

  it('已修好的缺口要從清單拿掉', () => {
    expect(Object.keys(known).filter(k => !(k in gaps))).toEqual([])
  })

  it('快照不是空的', () => {
    expect(trade.length).toBeGreaterThan(15000)
    expect(trade.some(e => e.id.startsWith('explicit.effect_'))).toBe(true)
  })

  it('整類不支援的類型維持 0', () => {
    for (const type of UNSUPPORTED) {
      const list = rows.filter(r => r.type === type)
      expect(list.length, `${type} 在快照裡沒有列`).toBeGreaterThan(0)
      expect(list.filter(r => r.verdict === 'ok').length, `${type} 出現 ok`).toBe(0)
    }
  })
})
