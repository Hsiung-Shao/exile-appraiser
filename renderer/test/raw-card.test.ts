/**
 * 2026-10-16 查價面板「原始詞綴」卡片與「機制」開關的純邏輯(R1、R2、R8、R9)。
 * revealed(本來被丟掉 / 藏起、現在列出的原始詞綴)非 pseudo 的列分到 raw 卡;機制開關設定預設關、壞值回 false。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { splitModCards } from '../src/web/price-panel/mod-cards'

const ROOT = path.resolve(__dirname, '../..')
const load = (lang: string) => JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))

// 新模組用動態 import:還沒實作時呈現為斷言失敗
const VIS_PATH = '../src/web/price-panel/mechanism-visibility'
async function visibility (): Promise<any> {
  let m: any = null
  try {
    m = await import(/* @vite-ignore */ VIS_PATH)
  } catch {
    m = null
  }
  expect(m?.normShowMechanism, 'mechanism-visibility 模組尚未提供 normShowMechanism').toBeTypeOf('function')
  return m
}

const row = (tag: string, disabled = true, revealed?: boolean) => ({ tag, disabled, revealed })

describe('R1 原始詞綴卡分組', () => {
  it('revealed 的非 pseudo 列分到原始詞綴卡,其他照舊、順序不變', () => {
    const a = row('explicit', false)
    const b = row('explicit', true, true)
    const c = row('pseudo', false)
    const d = row('implicit', true, true)
    const e = row('explicit', true)
    const r = splitModCards([a, b, c, d, e]) as any
    expect(r.raw?.id).toBe('raw')
    expect(r.raw?.rows).toEqual([b, d])
    expect(r.mods.rows).toEqual([a, e])
    expect(r.pseudo.rows).toEqual([c])
  })

  it('pseudo 列即使 revealed 仍在偽屬性卡', () => {
    const p = row('pseudo', true, true)
    const r = splitModCards([p, row('explicit', true, true)]) as any
    expect(r.pseudo.rows).toEqual([p])
    expect(r.raw?.rows ?? []).toHaveLength(1)
  })

  it('三張卡的已選數各自只算沒停用的列', () => {
    const r = splitModCards([
      row('explicit', false), row('explicit', true),
      row('explicit', false, true), row('fractured', true, true), row('crafted', true, true),
      row('pseudo', false)
    ]) as any
    expect([r.mods.selected, r.mods.rows.length]).toEqual([1, 2])
    expect([r.raw?.selected, r.raw?.rows.length]).toEqual([1, 3])
    expect([r.pseudo.selected, r.pseudo.rows.length]).toEqual([1, 1])
  })

  it('沒有 revealed 列時原始詞綴卡是空的', () => {
    const r = splitModCards([row('explicit', false), row('pseudo')]) as any
    expect(r.raw?.rows).toEqual([])
    expect(r.raw?.selected).toBe(0)
  })
})

describe('R2 PoE1 群組列依 meta 分卡', () => {
  it('meta.revealed 的群組列分到原始詞綴卡,meta 是 pseudo 時仍在偽屬性卡', () => {
    const g = { group: 'x', meta: { tag: 'explicit', disabled: true, revealed: true } }
    const gp = { group: 'y', meta: { tag: 'pseudo', disabled: true, revealed: true } }
    const gm = { group: 'z', meta: { tag: 'explicit', disabled: false } }
    const r = splitModCards([g, gp, gm] as any[]) as any
    expect(r.raw?.rows).toEqual([g])
    expect(r.pseudo.rows).toEqual([gp])
    expect(r.mods.rows).toEqual([gm])
    expect(r.mods.selected).toBe(1)
  })
})

describe('R8 機制開關設定正規化', () => {
  it('預設值為關', async () => {
    const m = await visibility()
    expect(m.DEFAULT_SHOW_MECHANISM).toBe(false)
  })

  it('只有 true 是開,其他值一律關', async () => {
    const m = await visibility()
    expect(m.normShowMechanism(true)).toBe(true)
    expect(m.normShowMechanism(false)).toBe(false)
    for (const v of ['x', 'true', undefined, null, 1, {}]) expect(m.normShowMechanism(v)).toBe(false)
  })
})

describe('R9 原始詞綴卡與機制開關字串', () => {
  for (const lang of ['cmn-Hant', 'en']) {
    it(`${lang} 有非空的 ppz.mod_cards.raw 與 ppz.mechanism.toggle`, () => {
      const ppz = load(lang).ppz ?? {}
      for (const v of [ppz.mod_cards?.raw, ppz.mechanism?.toggle]) {
        expect(typeof v).toBe('string')
        expect(String(v).trim().length).toBeGreaterThan(0)
      }
    })
  }

  it('繁中字串為「原始詞綴」與「機制」', () => {
    const ppz = load('cmn-Hant').ppz ?? {}
    expect(ppz.mod_cards?.raw).toBe('原始詞綴')
    expect(ppz.mechanism?.toggle).toBe('機制')
  })
})
