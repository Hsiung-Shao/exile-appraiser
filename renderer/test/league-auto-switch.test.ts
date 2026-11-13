// 2026-11-14:新賽季聯盟自動切換(core `pickLeagueOnLoad`)在 renderer 的設定欄位與接線
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'

const src = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../src/web', rel), 'utf8')

describe('leagueSeenBy 設定檔往返', () => {
  it('舊設定檔沒有這欄 → 兩代都是空物件,聯盟選擇不受影響', () => {
    const { config, serialized } = _roundTripForTest('{"game":"poe1","leagueBy":{"poe1":{"intl":"Standard"}}}')
    expect(config.leagueSeenBy).toEqual({ poe1: {}, poe2: {} })
    expect(config.leagueBy.poe1.intl).toBe('Standard')
    expect(JSON.parse(serialized).leagueSeenBy).toEqual({ poe1: {}, poe2: {} })
  })

  it('存過的賽季聯盟依遊戲 / 伺服器區讀回', () => {
    const raw = '{"leagueSeenBy":{"poe1":{"intl":"Covens"},"poe2":{"tw":"禁忌儀式"}}}'
    const { config, serialized } = _roundTripForTest(raw)
    expect(config.leagueSeenBy).toEqual({ poe1: { intl: 'Covens' }, poe2: { tw: '禁忌儀式' } })
    expect(JSON.parse(serialized).leagueSeenBy).toEqual(config.leagueSeenBy)
  })
})

describe('接線守門', () => {
  it('載入清單時走 pickLeagueOnLoad 並存下看到的賽季聯盟', () => {
    const leagues = src('background/Leagues.ts')
    expect(leagues).toMatch(/pickLeagueOnLoad\(list, cfg\.leagueId, cfg\.leagueSeenBy\[game\]\?\.\[realm\], game\)/)
    expect(leagues).toMatch(/cfg\.leagueSeenBy = \{/)
    expect(leagues).not.toMatch(/\bpickLeague\(/)
  })

  it('查價時清單過期就重抓(不另開計時器)', () => {
    expect(src('background/Prices.ts')).toMatch(/function queuePricesFetch \(\) \{[^}]*leagues\.loadIfStale\(\)/)
    expect(src('background/Leagues.ts')).not.toMatch(/setInterval|setTimeout/)
  })
})
