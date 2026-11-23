// 2026-11-23:「啟動遊戲時自動開啟」設定 `autoLaunchWithGame`(Config.ts 往返 / 正規化、進 host-config、設定頁接線、字串兩語)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest, hostConfigOf } from '../src/web/Config'
import zh from '../src/i18n/cmn-Hant.json'
import en from '../src/i18n/en.json'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('autoLaunchWithGame 設定', () => {
  it('全新 / 舊設定檔沒有這欄 → 預設關,且會寫進檔', () => {
    for (const raw of [null, '{"game":"poe1"}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.autoLaunchWithGame).toBe(false)
      expect(JSON.parse(serialized).autoLaunchWithGame).toBe(false)
    }
  })
  it('只有明確 true 才開;非布林值當成關', () => {
    const on = _roundTripForTest('{"autoLaunchWithGame":true}')
    expect(on.config.autoLaunchWithGame).toBe(true)
    expect(JSON.parse(on.serialized).autoLaunchWithGame).toBe(true)
    for (const v of ['1', '"true"', 'null']) {
      expect(_roundTripForTest(`{"autoLaunchWithGame":${v}}`).config.autoLaunchWithGame).toBe(false)
    }
  })
  it('進 host-config(main 依此安裝 / 移除背景監看)', () => {
    const { config } = _roundTripForTest('{"autoLaunchWithGame":true}')
    expect(hostConfigOf(config).autoLaunchWithGame).toBe(true)
  })
  it('設定頁「啟動與更新」有開關', () => {
    expect(read('../src/web/settings/tabs/Startup.vue')).toContain('<input v-model="config.autoLaunchWithGame" type="checkbox" role="switch"')
  })
  it('字串兩語都有', () => {
    for (const m of [zh, en] as Array<{ ppz: { game_autolaunch: Record<string, string> } }>) {
      for (const k of ['label', 'sub', 'hint']) expect(m.ppz.game_autolaunch[k], k).toMatch(/\S/)
    }
  })
})
