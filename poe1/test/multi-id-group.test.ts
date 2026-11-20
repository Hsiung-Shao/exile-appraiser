import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { createPresets } from '@/web/price-check/filters/create-presets'
import { createTradeRequest, requestTradeResultList } from '@/web/price-check/trade/pathofexile-trade'
import type { FilterPreset } from '@/web/price-check/filters/interfaces'
import { runFixture } from './helpers/fixture-harness'

// GitHub issue #48:多 id 詞綴各自成組會被交易站以 Query is too complex 拒絕 → 併成同一個 count 群組
const SAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs/3.30-issue-48.cmn-Hant.txt')
const OPTS = { league: 'Standard', currency: null, collapseListings: 'api' as const, activateStockFilter: false, searchStatRange: 10, useEn: false, merchantOnly: false }
const SUPPORT_IDS = [
  'explicit.indexable_support_64', 'explicit.effect_174595432',
  'explicit.indexable_support_63', 'explicit.effect_3858590323',
  'explicit.indexable_support_71', 'explicit.effect_1199731147'
]

let preset: FilterPreset
let multi: any[]

beforeAll(async () => {
  await init('cmn-Hant')
  await loadForLang('cmn-Hant')
  const outcome = runFixture({ name: 'issue-48', language: 'cmn-Hant', text: fs.readFileSync(SAMPLE, 'utf8'), expectedPath: '' })
  if (outcome.kind !== 'parsed') throw new Error(outcome.error)
  preset = createPresets(outcome.item, OPTS).presets[0]
  multi = preset.stats.filter((s: any) => !s.group && s.tradeId?.length === 2 && s.tradeId.some((id: string) => id.includes('indexable_support_')))
  if (multi.length !== 3) throw new Error(`找到的多 id 輔助詞綴不是 3 條:${multi.length}`)
})

/** 設定三條的 disabled 後組查詢,回傳含 indexable_support_ 的 count 群組們 */
const groups = (disabled: boolean[]) => {
  multi.forEach((s, i) => { s.disabled = disabled[i] })
  const q = createTradeRequest(preset.filters, preset.stats).query as any
  return (q.stats as any[]).filter(g => g.type === 'count' && g.filters.some((f: any) => String(f.id).startsWith('explicit.indexable_support_')))
}

describe('多 id 詞綴併成同一個 count 群組', () => {
  it('C1 三條多 id 詞綴都勾時併成一個群組', () => {
    const g = groups([false, false, false])
    expect(g).toHaveLength(1)
    expect(g[0].value).toEqual({ min: 3 })
    expect(g[0].filters).toHaveLength(6)
    expect(g[0].filters.map((f: any) => f.id).sort()).toEqual([...SUPPORT_IDS].sort())
    expect(g[0].disabled).not.toBe(true)
  })

  it('C2 勾兩條時至少成立兩個', () => {
    const g = groups([false, false, true])
    expect(g[0].value.min).toBe(2)
    const off = new Set(multi[2].tradeId)
    for (const f of g[0].filters) expect(f.disabled === true).toBe(off.has(f.id))
  })

  it('C3 只勾一條時與單獨一組相同', () => {
    const g = groups([false, true, true])
    expect(g[0].value.min).toBe(1)
    expect(g[0].disabled).not.toBe(true)
  })

  it('C4 都沒勾時整組停用', () => {
    const g = groups([true, true, true])
    expect(g[0].disabled).toBe(true)
    expect(g[0].value.min).toBe(1)
  })

  it('C5 啟用的多 id 群組只有一個', () => {
    expect(groups([false, false, false]).filter(g => g.disabled !== true)).toHaveLength(1)
  })
  // 審查 2026-11-20:台服清單沒有的 id 要逐條拿掉;併組後 min > 1,原本的過濾會把整組丟掉、條件全部消失
  it('T1 台服:併組裡台服沒有的 id 逐條拿掉,一個 id 都不剩的那條不算進 min', async () => {
    multi.forEach(s => { s.disabled = false })
    const request = createTradeRequest(preset.filters, preset.stats)
    const ids = (request.query.stats as any[]).flatMap(g => g.filters.map((x: any) => String(x.id)))
    const tw = ids.filter(id => !id.includes('.effect_') && id !== 'explicit.indexable_support_71')
    let sent: any
    const http = async (url: string, init?: any): Promise<any> => {
      const body = url.endsWith('/api/trade/data/stats') ? { result: [{ id: 'x', entries: tw.map(id => ({ id, text: '' })) }] } : (sent = JSON.parse(init.body), { id: 'x', result: [], total: 0 })
      return { ok: true, status: 200, headers: new Headers({ 'x-rate-limit-rules': 'Ip', 'x-rate-limit-ip': '8:10:60', 'x-rate-limit-ip-state': '1:10:0' }), json: async () => body, text: async () => JSON.stringify(body) }
    }
    await requestTradeResultList({ http, realm: 'tw', latencySeconds: 0, accountName: '' } as any, request, 'Standard')
    const g = (sent.query.stats as any[]).filter(x => x.type === 'count' && x.filters.some((y: any) => String(y.id).startsWith('explicit.indexable_support_')))
    expect(g).toHaveLength(1)
    expect(g[0].filters.map((y: any) => y.id)).toEqual(['explicit.indexable_support_64', 'explicit.indexable_support_63'])
    expect(g[0].value).toEqual({ min: 2 })
  })
})
