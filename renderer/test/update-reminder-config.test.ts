// 第 34 步:更新提醒的設定(`updateReminder` 開關、`updateSkippedVersion` 略過的版號)、關於頁開關、字串兩語、略過事件接線。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest, hostConfigOf, normSkippedVersion } from '../src/web/Config'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('updateReminder / updateSkippedVersion 設定檔往返', () => {
  it('全新 / 舊設定檔沒有 → 提醒開、沒有略過,且會寫進檔', () => {
    for (const raw of [null, '{"game":"poe1"}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.updateReminder).toBe(true)
      expect(config.updateSkippedVersion).toBeNull()
      const j = JSON.parse(serialized)
      expect(j.updateReminder).toBe(true)
      expect(j.updateSkippedVersion).toBeNull()
    }
  })
  it('明確 false 才關;非布林值當成開', () => {
    expect(_roundTripForTest('{"updateReminder":false}').config.updateReminder).toBe(false)
    expect(JSON.parse(_roundTripForTest('{"updateReminder":false}').serialized).updateReminder).toBe(false)
    expect(_roundTripForTest('{"updateReminder":0}').config.updateReminder).toBe(true)
  })
  it('略過的版號:合法才保留,壞值 → null', () => {
    expect(_roundTripForTest('{"updateSkippedVersion":"0.2.0"}').config.updateSkippedVersion).toBe('0.2.0')
    expect(JSON.parse(_roundTripForTest('{"updateSkippedVersion":"0.2.0"}').serialized).updateSkippedVersion).toBe('0.2.0')
    for (const bad of ['"abc"', '1', '""', '"0.2"', 'true']) {
      expect(_roundTripForTest(`{"updateSkippedVersion":${bad}}`).config.updateSkippedVersion, bad).toBeNull()
    }
  })
  it('normSkippedVersion 與 main 同規則(函式本體逐字相同)', () => {
    const body = (src: string) => {
      const i = src.indexOf('export function normSkippedVersion')
      return src.slice(i, src.indexOf('\n}', i))
    }
    const mainBody = body(read('../../main/src/update-reminder.ts'))
    expect(mainBody.length).toBeGreaterThan(40)
    expect(body(read('../src/web/Config.ts'))).toBe(mainBody)
    expect(['0.2.0', '1.2.3-beta.1', '', 'abc', '0.2', null, 3, 'x'.repeat(41), '0.2.0 x'].map(normSkippedVersion))
      .toEqual(['0.2.0', '1.2.3-beta.1', null, null, null, null, null, null, null])
  })
  it('host-config 帶兩個欄位給 main', () => {
    const { config } = _roundTripForTest('{"updateReminder":false,"updateSkippedVersion":"0.3.1"}')
    const h = hostConfigOf(config, [])
    expect(h.updateReminder).toBe(false)
    expect(h.updateSkippedVersion).toBe('0.3.1')
  })
})

describe('關於頁與字串', () => {
  const about = read('../src/web/settings/tabs/About.vue')
  const zh = JSON.parse(read('../src/i18n/cmn-Hant.json'))
  const en = JSON.parse(read('../src/i18n/en.json'))
  it('設定 › 關於有「有新版本時定期提醒」開關', () => {
    expect(about).toContain('v-model="config.updateReminder"')
    expect(about).toContain("t('ppz.update.reminder')")
    expect(about).toContain("t('ppz.update.reminder_hint')")
  })
  it('兩語都有字串', () => {
    expect(zh.ppz.update.reminder).toBe('有新版本時定期提醒')
    expect(en.ppz.update.reminder).toBe('Remind me when an update is available')
    expect(zh.ppz.update.reminder_hint).toContain('10 分鐘')
    expect(en.ppz.update.reminder_hint).toContain('10 minutes')
  })
})

describe('略過事件接線', () => {
  const cfg = read('../src/web/Config.ts')
  const ipc = read('../src/web/background/IPC.ts')
  it('Config 收 update-reminder-skip 寫進 updateSkippedVersion(經正規化)', () => {
    const i = cfg.indexOf('Host.onUpdateReminderSkip(')
    expect(i).toBeGreaterThan(0)
    const block = cfg.slice(i, cfg.indexOf('})', i))
    expect(block).toContain('normSkippedVersion(version)')
    expect(block).toContain('config.updateSkippedVersion = v')
  })
  it('IPC 轉接(預覽 shim 沒有這個方法 → no-op)', () => {
    expect(ipc).toContain('window.host?.onUpdateReminderSkip?.(cb) ?? (() => {})')
  })
})
