// 2026-10-07:設定 › 更新與關於顯示「支援遊戲版本」(renderer/src/web/settings/game-versions.ts)。
// 守:字串兩語都有且參數一致、關於頁接線、版號非空。版號本身由使用者提供,遊戲改版 / 發版時人工更新(CLAUDE.md 發版 checklist)。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { SUPPORTED_GAME_VERSIONS } from '../src/web/settings/game-versions'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

describe('關於頁:支援遊戲版本', () => {
  it('兩代版號都有', () => {
    expect(SUPPORTED_GAME_VERSIONS).toEqual({ poe1: '3.29.3', poe2: '0.5.5d' })
  })
  it('字串兩語都有,參數 {poe1} {poe2},不含 vue-i18n 特殊字元', () => {
    for (const lang of ['cmn-Hant', 'en']) {
      const s: string = JSON.parse(read(`renderer/src/i18n/${lang}.json`)).ppz.about.game_versions
      expect(typeof s, lang).toBe('string')
      expect([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), lang).toEqual(['poe1', 'poe2'])
      expect(s, lang).not.toMatch(/[|@$]/)
    }
  })
  it('關於頁品牌卡片顯示這一行', () => {
    const vue = read('renderer/src/web/settings/tabs/About.vue')
    expect(vue).toMatch(/data-about="game-versions">\{\{ t\('ppz\.about\.game_versions', gameVersions\) \}\}/)
    expect(vue).toMatch(/gameVersions: SUPPORTED_GAME_VERSIONS/)
  })
})
