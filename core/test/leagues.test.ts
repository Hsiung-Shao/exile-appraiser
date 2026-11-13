import { describe, expect, it } from 'vitest'
import { filterTradeLeagues, isChallengeSoftcoreLeague, mapTrade2Leagues, pickLeague, pickLeagueOnLoad, type ApiLeague } from '../src/realm/leagues'

const ids = (list: string[]) => list.map(id => ({ id, isPopular: true }))

// 2026-09-30 實測 https://www.pathofexile.com/api/trade2/data/leagues(順序原樣)
const POE2_INTL = ['Forbidden Rites', 'HC Forbidden Rites', 'Runes of Aldur', 'HC Runes of Aldur', 'Standard', 'Hardcore']

describe('pickLeague:PoE2', () => {
  it('真實清單 → Forbidden Rites(不再依位置挑到 index 2 的 Runes of Aldur)', () => {
    const list = mapTrade2Leagues({ result: POE2_INTL.map(id => ({ id, realm: 'poe2', text: id })) })
    expect(pickLeague(list, undefined, 'poe2')).toBe('Forbidden Rites')
  })

  it('聯盟順序變動:取清單中第一個賽季軟核聯盟', () => {
    expect(pickLeague(ids(['Standard', 'Hardcore', 'HC Forbidden Rites', 'Forbidden Rites', 'Runes of Aldur']), undefined, 'poe2')).toBe('Forbidden Rites')
    expect(pickLeague(ids(['HC Runes of Aldur', 'Runes of Aldur', 'Forbidden Rites', 'Standard']), undefined, 'poe2')).toBe('Runes of Aldur')
    expect(pickLeague(ids(['Hardcore', 'Standard', 'Hardcore Forbidden Rites', 'SSF Forbidden Rites', 'Ruthless Forbidden Rites', 'Forbidden Rites']), undefined, 'poe2')).toBe('Forbidden Rites')
  })

  it('沒有賽季聯盟:退 Standard,再退 list[0];空清單 undefined', () => {
    expect(pickLeague(ids(['Hardcore', 'Standard']), undefined, 'poe2')).toBe('Standard')
    expect(pickLeague(ids(['Hardcore', 'HC Forbidden Rites']), undefined, 'poe2')).toBe('Hardcore')
    expect(pickLeague([], undefined, 'poe2')).toBeUndefined()
  })

  it('既有選擇仍在清單裡、或是私人聯盟 → 沿用;已不在清單 → 重選', () => {
    const list = ids(POE2_INTL)
    expect(pickLeague(list, 'Runes of Aldur', 'poe2')).toBe('Runes of Aldur')
    expect(pickLeague(list, 'Standard', 'poe2')).toBe('Standard')
    expect(pickLeague(list, 'My League (PL12345)', 'poe2')).toBe('My League (PL12345)')
    expect(pickLeague(list, 'Dawn of the Hunt', 'poe2')).toBe('Forbidden Rites')
  })

  it('台服繁中 id:永久聯盟與專家模式變體不算賽季聯盟', () => {
    expect(pickLeague(ids(['專家模式', '標準模式', '禁忌儀式', '阿德爾的符文']), undefined, 'poe2')).toBe('禁忌儀式')
    expect(pickLeague(ids(['專家模式', '標準模式']), undefined, 'poe2')).toBe('標準模式')
  })
})

describe('pickLeague:PoE1', () => {
  const league = (id: string, rules: string[] = [], event = false): ApiLeague => ({ id, event, rules: rules.map(r => ({ id: r })) })
  // 2026-09-30 實測 /api/leagues?type=main&realm=pc(順序原樣)
  const POE1_INTL: ApiLeague[] = [
    league('Standard'), league('Hardcore', ['Hardcore']), league('Solo Self-Found', ['NoParties']),
    league('Hardcore SSF', ['Hardcore', 'NoParties']), league('Ruthless', ['HardMode']),
    league('Hardcore Ruthless', ['Hardcore', 'HardMode']), league('SSF Ruthless', ['NoParties', 'HardMode']),
    league('Hardcore SSF Ruthless', ['Hardcore', 'NoParties', 'HardMode']), league('Allflame'),
    league('Hardcore Allflame', ['Hardcore']), league('HC SSF Allflame', ['Hardcore', 'NoParties']),
    league('Ruthless Allflame', ['HardMode']), league('HC Ruthless Allflame', ['Hardcore', 'HardMode']),
    league('SSF R Allflame', ['NoParties', 'HardMode']), league('SSF Allflame', ['NoParties']),
    league('HC SSF R Allflame', ['Hardcore', 'NoParties', 'HardMode'])
  ]

  it('真實清單:過濾後 Standard, Allflame, Hardcore Allflame → Allflame', () => {
    const list = filterTradeLeagues(POE1_INTL)
    expect(list.map(l => l.id)).toEqual(['Standard', 'Allflame', 'Hardcore Allflame'])
    expect(pickLeague(list, undefined)).toBe('Allflame')
  })

  it('聯盟順序變動(賽季聯盟排在 Standard 前面)仍取 Allflame', () => {
    expect(pickLeague(filterTradeLeagues([...POE1_INTL].reverse()), undefined)).toBe('Allflame')
  })

  it('只剩永久聯盟 → Standard', () => {
    expect(pickLeague(filterTradeLeagues(POE1_INTL.slice(0, 8)), undefined)).toBe('Standard')
  })
})

describe('pickLeagueOnLoad:新賽季第一次出現就切過去', () => {
  // 2026-11-14 實測 /api/leagues 過濾後(3.30 Covens 開季);使用者設定檔當時存的是 Standard
  const COVENS = ids(['Standard', 'Covens', 'Hardcore Covens'])

  it('賽季間退回 Standard 後新賽季開了 → 切到新賽季', () => {
    expect(pickLeagueOnLoad(COVENS, 'Standard', 'Allflame')).toEqual({ id: 'Covens', seen: 'Covens' })
  })

  it('升級後第一次載入(還沒記過)也切到目前賽季', () => {
    expect(pickLeagueOnLoad(COVENS, 'Standard', undefined)).toEqual({ id: 'Covens', seen: 'Covens' })
  })

  it('同一個賽季裡使用者改選 Standard → 之後維持 Standard', () => {
    expect(pickLeagueOnLoad(COVENS, 'Standard', 'Covens')).toEqual({ id: 'Standard', seen: 'Covens' })
  })

  it('私人聯盟不被新賽季切走', () => {
    expect(pickLeagueOnLoad(COVENS, 'My League (PL12345)', 'Allflame')).toEqual({ id: 'My League (PL12345)', seen: 'Covens' })
  })

  it('賽季之間(清單沒有賽季聯盟)退 Standard,記住的賽季不清掉', () => {
    expect(pickLeagueOnLoad(ids(['Standard', 'Hardcore']), 'Allflame', 'Allflame')).toEqual({ id: 'Standard', seen: 'Allflame' })
  })

  it('PoE2 清單新舊賽季並列:新賽季排第一個時切過去', () => {
    const list = ids(['New League', 'HC New League', 'Forbidden Rites', 'Standard'])
    expect(pickLeagueOnLoad(list, 'Forbidden Rites', 'Forbidden Rites', 'poe2')).toEqual({ id: 'New League', seen: 'New League' })
  })
})

describe('isChallengeSoftcoreLeague', () => {
  it('排除永久 / HC / SSF / Ruthless', () => {
    for (const id of ['Standard', 'Hardcore', '標準模式', '專家模式', 'HC Forbidden Rites', 'Hardcore Allflame',
      'Solo Self-Found', 'SSF Allflame', 'SSF R Allflame', 'Ruthless Allflame']) {
      expect(isChallengeSoftcoreLeague(id), id).toBe(false)
    }
    for (const id of ['Forbidden Rites', 'Runes of Aldur', 'Allflame', '禁忌儀式']) {
      expect(isChallengeSoftcoreLeague(id), id).toBe(true)
    }
  })
})
