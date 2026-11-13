// 萃取物(Tincture)資料測試:PoE1 詞綴頁 tincture_mods、詞綴名對照、基底組與 ambient。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defaultRegexDataDir, loadRegexCatalogueFile } from '../src/node'
import { itemGroupOf } from '../src/sections'

const pages = loadRegexCatalogueFile('poe1').pages
const page = pages.find(p => p.id === 'tincture_mods')
const bases = pages.find(p => p.id === 'vendor_bases')
const affixNames = pages.find(p => p.id === 'magic_affixes')
const raw = JSON.parse(readFileSync(path.join(defaultRegexDataDir(), 'regex_poe1.json'), 'utf8'))

// 萃取物基底列(vendor_bases 的「萃取物」組)
const tinctureBases = () => {
  const g = bases?.groups.indexOf('萃取物') ?? -1
  return g < 0 ? [] : (bases?.entries ?? []).filter(e => e.g === g)
}

describe('萃取物(Tincture)資料', () => {
  it('T1 有萃取物詞綴頁且分前後綴', () => {
    expect(page, '缺 tincture_mods 頁').toBeDefined()
    expect(raw.pages.find((p: { id: string }) => p.id === 'tincture_mods')?.kind).toBe('mods')
    expect(page?.groups ?? []).toEqual(expect.arrayContaining(['前綴', '後綴']))
    expect(page?.groupsEn ?? []).toEqual(expect.arrayContaining(['Prefix', 'Suffix']))
    expect(page?.entries.length ?? 0).toBeGreaterThan(0)
    const bad = (page?.entries ?? []).filter(e => !e.zh[0] || !e.en[0])
    expect(bad.map(e => e.id)).toEqual([])
  })

  it('T2 36 個萃取物詞綴名都對得到詞綴行', () => {
    const names = (affixNames?.entries ?? []).filter(e => e.id.startsWith('Tincture'))
    expect(names.length).toBe(36)
    const ents = page?.entries ?? []
    const missing = names.filter(n =>
      !ents.some(e => e.hiddenZh.some(l => l.includes(`"${n.zh[0]}"`))) ||
      !ents.some(e => e.hiddenEn.some(l => l.includes(`"${n.en[0]}"`)))
    ).map(n => `${n.zh[0]}/${n.en[0]}`)
    expect(page, '缺 tincture_mods 頁').toBeDefined()
    expect(missing).toEqual([])
  })

  it('T4a 萃取物固定文字在詞綴頁 ambient', () => {
    expect(page, '缺 tincture_mods 頁').toBeDefined()
    expect(page?.ambientZh ?? []).toEqual(expect.arrayContaining(['每 # 秒造成魔力灼燒', '解除時有 # 秒冷卻時間']))
    expect(page?.ambientEn ?? []).toEqual(expect.arrayContaining(['Inflicts Mana Burn every # Seconds', '# Second Cooldown when Deactivated']))
  })

  it('T4b 萃取物基底名與固有詞綴行在詞綴頁 ambient', () => {
    const rows = tinctureBases()
    expect(rows.length).toBe(10)
    const zh = new Set(page?.ambientZh ?? [])
    const en = new Set(page?.ambientEn ?? [])
    const missing = [
      ...rows.flatMap(e => [e.zh[0], ...e.hiddenZh]).filter(l => !zh.has(l)),
      ...rows.flatMap(e => [e.en[0], ...e.hiddenEn]).filter(l => !en.has(l))
    ]
    expect(page, '缺 tincture_mods 頁').toBeDefined()
    expect(missing).toEqual([])
  })

  it('T5 物品基底頁多「萃取物」組共 10 列', () => {
    const g = bases?.groups.indexOf('萃取物') ?? -1
    expect(g, 'vendor_bases 缺「萃取物」組').toBeGreaterThanOrEqual(0)
    expect(bases?.groupsEn[g]).toBe('Tinctures')
    const rows = tinctureBases()
    expect(rows.length).toBe(10)
    expect(rows.some(e => e.zh[0] === '灰樹皮萃取物' && e.en[0] === 'Ashbark Tincture')).toBe(true)
  })

  it('T7 萃取物詞綴頁屬裝備組', () => {
    expect(itemGroupOf('tincture_mods')).toBe('equipment')
  })
})
