// 碑牌固有詞綴(2026-10-09,與 PobTools regex_selftest_r10.cpp TabletTests 的 A1 / A2 同一份規格):
// 每塊碑牌都印「剩餘#次使用次數」等固有行,資料檔把它們放進碑牌頁 ambient,
// 單選片段因此不會以「每塊碑牌都有的字」當 token(例:祭祀重骰詞綴不能用中「剩餘8次使用次數」的片段)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildCorpus, type RegexPage } from '../src/data'
import { loadAllPagesFor } from '../src/node'

const tablet = loadAllPagesFor('poe2').find(p => p.id === 'tablet_mods') as RegexPage
const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'regex_samples')

/** 樣本第 2 件(碑牌);去掉 `{ … }` 標頭、進階格式「27(25-35)%」→「27%」(搜尋看到的是一般格式) */
function sampleTablet (): string[] {
  const text = fs.readFileSync(path.join(SAMPLES, 'poe2_items_zh.txt'), 'utf8').replace(/^﻿/, '')
  const items: string[][] = [[]]
  for (const raw of text.split('\n')) {
    const l = raw.replace(/\r$/, '')
    if (!l) { if (items[items.length - 1].length) items.push([]); continue }
    items[items.length - 1].push(l)
  }
  return items[1].filter(l => !l.startsWith('{')).map(l => l.replace(/(\d)\([0-9.-]+\)/g, '$1'))
}

describe('碑牌固有詞綴(A1 / A2)', () => {
  it('A1 碑牌 ambient 含固有詞綴:剩餘#次使用次數 / 剩餘#次使用 / 強化帶有頭目的地圖剩餘#次使用 / 在地圖內加入一個卡爾葛墓地;# uses remaining / # use remaining', () => {
    for (const l of ['剩餘#次使用次數', '剩餘#次使用', '強化帶有頭目的地圖剩餘#次使用', '在地圖內加入一個卡爾葛墓地']) expect(tablet.ambientZh, l).toContain(l)
    for (const l of ['# uses remaining', '# use remaining']) expect(tablet.ambientEn, l).toContain(l)
  })
  it('A2 祭祀重骰詞綴單選的片段不中樣本碑牌任何一行(特別是「剩餘8次使用次數」);英文不中 uses remaining / 卡爾葛墓地', () => {
    let i = tablet.entries.findIndex(e => e.id === 'TowerRitualAdditionalReroll')
    if (i < 0) i = tablet.entries.findIndex(e => e.id.includes('Ritual') && e.id.includes('Reroll'))
    expect(i, '碑牌頁有祭祀重骰詞綴').toBeGreaterThanOrEqual(0)
    const item = sampleTablet()
    expect(item.some(l => l.includes('剩餘8次使用次數'))).toBe(true)
    const enItem = ['8 uses remaining', '1 use remaining', 'Adds a Kalguuran Cemetery to the Map']
    for (const lang of ['zh', 'en'] as const) {
      const r = buildCorpus(tablet, lang).build([i], 'any')
      expect(r.usedTokens.length, `${lang} 有片段`).toBeGreaterThan(0)
      for (const tok of r.usedTokens) {
        const re = new RegExp(tok, 'i')
        for (const l of item) expect(re.test(l), `${lang} ${r.query} 中「${l}」`).toBe(false)
        if (lang === 'en') for (const l of enItem) expect(re.test(l), `en ${r.query} 中「${l}」`).toBe(false)
      }
    }
  })
})
