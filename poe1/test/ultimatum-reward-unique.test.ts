import { beforeAll, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import { nodeDataSource } from '@/assets/data/node-source'
import { poe1Adapter, createPresets, createTradeRequest } from '../src/index'

// 2026-11-19 使用者回報(英文實機):雕刻獎勵是指定傳奇(獻祭葛魯斯寇真皮換獵首)時,查詢只送「獎勵類型 = 傳奇物品」、
// 沒送是哪一件 → 換成其他傳奇的雕刻也算進來。交易站另有 `ultimatum_output`(Reward Unique)。
// 繁中沒有實機樣本:「獎勵: {0}」取自 GGPK clientstrings `UltimatumItemisedTrialReward`,名稱取自 items.ndjson
const EN = `Item Class: Misc Map Items
Rarity: Currency
Inscribed Ultimatum
--------
Challenge: Defeat waves of enemies
Area Level: 83
Requires Sacrifice: Gruthkul's Pelt
Reward: Headhunter
--------
Stormcaller Runes II
(Large runes will appear that will call deadly Lightning storms if you remain in them)
50% increased Monster Damage
200% more Monster Life
--------
Note: ~b/o 185 divine
`
const ZH = `物品種類: 其它
稀有度: 通貨
最後通牒雕刻
--------
挑戰: 擊敗數波怪物
區域等級: 83
需求獻祭: 葛魯斯寇真皮
獎勵: 獵首
--------
怪物傷害增加 50%
`
const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'cmn-Hant' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}

async function query (text: string, realm: 'intl' | 'tw' = 'intl') {
  await poe1Adapter.prepareItemText(text, realm)
  const r = poe1Adapter.parseClipboard(text)
  if (!r.ok) throw new Error(`解析失敗:${r.error}`)
  const { presets, active } = createPresets(r.item, { ...OPTS, realm, clientLanguage: poe1Adapter.dataLanguage()! })
  return createTradeRequest(presets.find(p => p.id === active)!).query as any
}

describe('雕刻獎勵是指定傳奇', () => {
  beforeAll(async () => {
    await poe1Adapter.loadData(nodeDataSource(path.resolve(__dirname, '../../data/poe1')), 'cmn-Hant')
  }, 180_000)

  // 失敗代表:沒送獎勵的傳奇名(只搜到「獎勵是傳奇」的全部雕刻)
  it('英文:送 ultimatum_output = Headhunter,其餘三欄照舊', async () => {
    const f = (await query(EN)).filters.ultimatum_filters.filters
    expect(f.ultimatum_output).toEqual({ option: 'Headhunter' })
    expect(f.ultimatum_reward).toEqual({ option: 'ExchangeUnique' })
    expect(f.ultimatum_challenge).toEqual({ option: 'Exterminate' })
    expect(f.ultimatum_input).toEqual({ option: "Gruthkul's Pelt" })
  })

  // 失敗代表:繁中寫法對不到傳奇,或國際服沒換成英文名
  it('繁中:國際服與英文查詢的雕刻條件逐字相同', async () => {
    expect((await query(ZH)).filters.ultimatum_filters).toEqual((await query(EN)).filters.ultimatum_filters)
  })

  // 失敗代表:台服送了英文名(台服交易站收繁中名)
  it('繁中台服:送繁中名 獵首', async () => {
    const f = (await query(ZH, 'tw')).filters.ultimatum_filters.filters
    expect(f.ultimatum_output).toEqual({ option: '獵首' })
  })
})
