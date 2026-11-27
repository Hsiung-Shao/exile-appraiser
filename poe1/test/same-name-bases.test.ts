import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'

/**
 * 同一個繁中名對到兩個英文底材、且資料沒有 `disc` 判別欄位時(術士長靴 = Sorcerer / Warlock Boots 等),
 * 解析不得丟 TypeError(issue #1:`Cannot read properties of undefined (reading 'propAR')`),
 * 並依物品身上的護甲 / 閃避 / 能量護盾數值挑落在範圍內的底材。
 */
function boots (es: number, quality?: number): string {
  return [
    '物品種類: 鞋子',
    '稀有度: 稀有',
    '術士長靴',
    '--------',
    ...(quality ? [`品質: +${quality}% (augmented)`] : []),
    `能量護盾: ${es}`,
    '--------',
    '需求:',
    '智慧: 177 (unmet)',
    '--------',
    '插槽: B W W ',
    '--------',
    '物品等級: 86',
    '--------',
    '未鑑定',
    '--------',
    '尊師之物'
  ].join('\r\n') + '\r\n'
}

function gloves (es: number, quality?: number): string {
  return [
    '物品種類: 手套',
    '稀有度: 稀有',
    '絲絨手套',
    '--------',
    ...(quality ? [`品質: +${quality}% (augmented)`] : []),
    `能量護盾: ${es}`,
    '--------',
    '需求:',
    '等級: 20',
    '--------',
    '物品等級: 80',
    '--------',
    '未鑑定'
  ].join('\r\n') + '\r\n'
}

function parse (text: string) {
  const result = parseClipboard(text)
  if (result.isErr()) throw new Error(`解析失敗:${JSON.stringify(result.error)}`)
  return result.value
}

beforeAll(async () => {
  await init('cmn-Hant')
}, 120_000)

describe('同名多底材且無 disc', () => {
  it('issue #1 術士長靴 ES 83 不丟錯,且選到數值範圍相符的 Warlock Boots', () => {
    expect(parse(boots(83)).info.refName).toBe('Warlock Boots')
  })

  it('術士長靴 ES 55 選到 Sorcerer Boots', () => {
    expect(parse(boots(55)).info.refName).toBe('Sorcerer Boots')
  })

  it('數值不在任何範圍內時退回第一個而不是丟錯', () => {
    expect(() => parse(boots(1))).not.toThrow()
  })

  // 顯示值含品質,必須先反推底材原值再比範圍(審查 #1)
  it('術士長靴品質 20%:底值 72 顯示 86,仍選 Warlock Boots', () => {
    expect(parse(boots(86, 20)).info.refName).toBe('Warlock Boots')
  })

  it('術士長靴品質 20%:底值 59 顯示 71,仍選 Sorcerer Boots(不誤判成 Warlock)', () => {
    expect(parse(boots(71, 20)).info.refName).toBe('Sorcerer Boots')
  })

  it('絲絨手套純 ES + 品質:選 Velvet Gloves,不被當成閃避底材 Velour', () => {
    expect(parse(gloves(15, 20)).info.refName).toBe('Velvet Gloves')
  })

  it('絲絨手套純 ES 無品質:選 Velvet Gloves', () => {
    expect(parse(gloves(12)).info.refName).toBe('Velvet Gloves')
  })

  it('數值遠低於任何範圍時選距離最近的底材(Sorcerer Boots)', () => {
    expect(parse(boots(1)).info.refName).toBe('Sorcerer Boots')
  })
})

// 2026-11-27 同類掃描:龍骨細劍 = Wyrmbone Rapier(基礎 13-51)/ Dragonbone Rapier(19-75)(GGPK weapontypes 3.30),
// 武器沒有防禦值可比,原本一律取資料第一列(Dragonbone)
function rapier (phys: string, quality?: number, localIncr?: number): string {
  return [
    '物品種類: 單手劍',
    '稀有度: 稀有',
    '末日之刺',
    '龍骨細劍',
    '--------',
    ...(quality ? [`品質: +${quality}% (augmented)`] : []),
    `物理傷害: ${phys}${quality || localIncr ? ' (augmented)' : ''}`,
    '暴擊率: 5.50%',
    '每秒攻擊次數: 1.50',
    '--------',
    '物品等級: 84',
    ...(localIncr ? ['--------', '{ 前綴 "測試的"(階層：1) }', `增加 ${localIncr}% 物理傷害`] : [])
  ].join('\r\n') + '\r\n'
}

describe('同名武器底材依基礎物理傷害挑', () => {
  it('物理傷害 13-51 → Wyrmbone Rapier', () => {
    expect(parse(rapier('13-51')).info.refName).toBe('Wyrmbone Rapier')
  })
  it('物理傷害 19-75 → Dragonbone Rapier', () => {
    expect(parse(rapier('19-75')).info.refName).toBe('Dragonbone Rapier')
  })
  it('20% 品質加本地增加 100% 物理傷害的 Wyrmbone 仍挑回 Wyrmbone', () => {
    // 13-51 × (1 + 1.00 + 0.20) = 28-112
    expect(parse(rapier('28-112', 20, 100)).info.refName).toBe('Wyrmbone Rapier')
  })
})

describe('同名底材組守門', () => {
  // 失敗代表:新賽季多了同名底材組(或少了),要確認解析器挑得開(防禦值 / Parser.ts SAME_NAME_WEAPON_PHYS / 傳奇底材)再更新這份清單
  it('同名不同 refName 的物品組與已處理清單相同', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const rows = fs.readFileSync(path.resolve(__dirname, '../../data/poe1/cmn-Hant/items.ndjson'), 'utf8')
      .split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l) as { name: string, refName: string, namespace: string })
    const groups = new Map<string, Set<string>>()
    for (const r of rows) { const k = `${r.namespace}::${r.name}`; (groups.get(k) ?? groups.set(k, new Set()).get(k)!).add(r.refName) }
    expect([...groups].filter(([, s]) => s.size > 1).map(([k]) => k).sort()).toEqual([
      'ITEM::狼王魔符', // Wolf Alpha 只當傳奇底材,走傳奇路徑
      'ITEM::絲絨手套', // 防禦值
      'ITEM::術士長靴', // 防禦值
      'ITEM::龍骨細劍', // 基礎物理傷害(SAME_NAME_WEAPON_PHYS)
      'UNIQUE::永恆鬥爭' // 靠底材
    ].sort())
  })
})
