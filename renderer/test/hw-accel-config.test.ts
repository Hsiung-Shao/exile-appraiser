// 第五輪 30.5:硬體加速設定 `hardwareAcceleration`(Config.ts 往返 / 正規化、不進 host-config、設定頁接線、字串兩語)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest, configContentsForRelaunch, hostConfigOf } from '../src/web/Config'
import zh from '../src/i18n/cmn-Hant.json'
import en from '../src/i18n/en.json'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('hardwareAcceleration 設定檔往返', () => {
  it('全新 / 舊設定檔沒有這欄 → 預設關(= 改版前),且會寫進檔', () => {
    for (const raw of [null, '{"game":"poe1"}', '{"game":"poe2","startupToast":false}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.hardwareAcceleration).toBe(false)
      expect(JSON.parse(serialized).hardwareAcceleration).toBe(false)
    }
  })
  it('只有明確 true 才開;非布林值當成關', () => {
    const on = _roundTripForTest('{"hardwareAcceleration":true}')
    expect(on.config.hardwareAcceleration).toBe(true)
    expect(JSON.parse(on.serialized).hardwareAcceleration).toBe(true)
    for (const v of ['1', '"true"', 'null', '{}']) {
      expect(_roundTripForTest(`{"hardwareAcceleration":${v}}`).config.hardwareAcceleration).toBe(false)
    }
  })
  it('不進 host-config(main 只在啟動時讀設定檔)', () => {
    const { config } = _roundTripForTest('{"hardwareAcceleration":true}')
    expect('hardwareAcceleration' in hostConfigOf(config)).toBe(false)
  })
  it('configContentsForRelaunch = 目前整份設定(含剛改的值)', () => {
    const { config } = _roundTripForTest(null)
    config.hardwareAcceleration = true
    expect(JSON.parse(configContentsForRelaunch()).hardwareAcceleration).toBe(true)
  })
})

describe('設定頁接線與字串', () => {
  it('一般分頁:開關 + 說明 + 與啟動值不同時「重新啟動後生效」+ 可重新啟動時才有按鈕', () => {
    const g = read('../src/web/settings/tabs/General.vue')
    expect(g).toContain('v-model="config.hardwareAcceleration"')
    expect(g).toContain("hwAccelPending: computed(() => config.hardwareAcceleration !== hwAccelAtStart.value)")
    expect(g).toMatch(/v-if="canRelaunch"[^>]*@click="relaunch"/)
    expect(g).toContain('await Host.appRelaunch(configContentsForRelaunch())')
  })
  it('兩語系字串都有', () => {
    for (const m of [zh, en] as any[]) {
      for (const k of ['label', 'note', 'restart_needed', 'restart_now']) {
        expect(typeof m.ppz.hw_accel[k]).toBe('string')
        expect(m.ppz.hw_accel[k].length).toBeGreaterThan(0)
      }
    }
  })
})
