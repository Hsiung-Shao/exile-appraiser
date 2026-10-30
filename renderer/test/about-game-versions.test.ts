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
    expect(SUPPORTED_GAME_VERSIONS).toEqual({ poe1: '3.29.3', poe2: '0.5.5e' })
  })
  it('字串兩語:區塊標題與說明,不含 vue-i18n 特殊字元', () => {
    for (const lang of ['cmn-Hant', 'en']) {
      const a = ppz(lang).about
      expect(typeof a.game_versions_title, lang).toBe('string')
      expect(typeof a.game_versions_label, lang).toBe('string')
      for (const s of [a.game_versions_title, a.game_versions_label]) expect(s, lang).not.toMatch(/[|@$]/)
      // 舊的一行小字與大字塊標籤已移除
      expect(a.game_versions, lang).toBeUndefined()
      expect(a.supports, lang).toBeUndefined()
    }
  })
  it('品牌卡片下方整列:標題 + 每代一個「遊戲 | 版號」膠囊(不用金框大字塊、不用 rem)', () => {
    const v = vue()
    expect(v).toMatch(/gameVersions: SUPPORTED_GAME_VERSIONS/)
    expect(v).toMatch(/<div class="gv-row" data-about="game-versions"[^>]*>[\s\S]*class="gv-title"[\s\S]*v-for="g in gameBlocks"[\s\S]*class="gv-game"[\s\S]*class="gv-num num"/)
    // 獨佔一列、上方分隔線
    expect(v).toMatch(/\.about-brand \.gv-row \{[^}]*flex: 1 1 100%[^}]*border-top: 1px solid var\(--edge-1\)/)
    // 使用者 2026-10-14 嫌醜:金框大字塊不再出現
    expect(v).not.toMatch(/\.about-brand \.gv-block \{[^}]*border: 1px solid var\(--gold\)/)
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
