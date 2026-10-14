// 設定 › 更新與關於:支援遊戲版本(renderer/src/web/settings/game-versions.ts)與資料來源。
// 2026-10-07 起顯示版本;2026-10-14 使用者要求版本醒目(品牌卡片右側兩個大字塊)、資料來源只留 poe.ninja(T3)。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { SUPPORTED_GAME_VERSIONS } from '../src/web/settings/game-versions'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const ppz = (lang: string) => JSON.parse(read(`renderer/src/i18n/${lang}.json`)).ppz
const vue = () => read('renderer/src/web/settings/tabs/About.vue')

describe('關於頁:支援遊戲版本', () => {
  it('兩代版號都有', () => {
    expect(SUPPORTED_GAME_VERSIONS).toEqual({ poe1: '3.29.3', poe2: '0.5.5d' })
  })
  it('字串兩語:「支援 {game}」與區塊標籤,不含 vue-i18n 特殊字元', () => {
    for (const lang of ['cmn-Hant', 'en']) {
      const a = ppz(lang).about
      expect([...String(a.supports).matchAll(/\{(\w+)\}/g)].map(m => m[1]), lang).toEqual(['game'])
      expect(typeof a.game_versions_label, lang).toBe('string')
      for (const s of [a.supports, a.game_versions_label]) expect(s, lang).not.toMatch(/[|@$]/)
      // 舊的一行小字已移除
      expect(a.game_versions, lang).toBeUndefined()
    }
  })
  it('品牌卡片右側兩個大字塊(每代一塊,版號用等寬數字),尺寸不用 rem', () => {
    const v = vue()
    expect(v).toMatch(/gameVersions: SUPPORTED_GAME_VERSIONS/)
    // 版號又變回一行小字 → 使用者看不到
    expect(v).toMatch(/<div class="gv-row" data-about="game-versions"[^>]*>[\s\S]*v-for="g in gameBlocks"[\s\S]*class="gv-num num"/)
    expect(v).toMatch(/\.about-brand \.gv-block \{[^}]*border: 1px solid var\(--gold\)/)
    expect(v).toMatch(/\.about-brand \.gv-num \{[^}]*font-size: calc\(var\(--fs-base\) \* [\d.]+\)/)
    expect(v.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/\d(?:\.\d+)?rem\b/)
  })
})

describe('關於頁:資料來源只留 poe.ninja', () => {
  it('沒有 MANIFEST 列、不讀 MANIFEST.json;poe.ninja 列兩代都顯示', () => {
    const v = vue()
    // 舊的 MANIFEST 列殘留 → 卡片又出現一堆 commit 短碼
    for (const gone of ['PREFIXES', 'MANIFEST.json', 'manifestError', 'data-source="row', 'v-for="row in rows"']) expect(v, gone).not.toContain(gone)
    expect(v).toContain('data-source="poe.ninja"')
    expect(v).not.toContain("AppConfig().game !== 'poe1'")
  })
  it('不再使用的字串清掉(兩語)', () => {
    for (const lang of ['cmn-Hant', 'en']) {
      const z = ppz(lang)
      for (const k of ['data_poe1', 'data_poe2', 'data_regex', 'data_source', 'data_fetched', 'data_poe1_stash', 'data_poe2_trade']) {
        expect(z[k], `${lang} ${k}`).toBeUndefined()
      }
      expect(typeof z.section_data).toBe('string')
    }
  })
})
