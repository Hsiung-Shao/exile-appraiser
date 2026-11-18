/**
 * 2026-11-18 使用者:「啟動與更新」頁要照設計稿(兩欄列 + 開關),並顯示目前版本。
 * 設計稿 https://claude.ai/artifact/KApC4XJhMQFnm1dHotpecK P04-Startup
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8')
const vue = read('../src/web/settings/tabs/Startup.vue')
const zh = JSON.parse(read('../src/i18n/cmn-Hant.json'))
const en = JSON.parse(read('../src/i18n/en.json'))

describe('設定 › 啟動與更新', () => {
  // 失敗代表:頁面上看不到目前版本
  it('更新卡片標題列顯示目前版本(Host.version)', () => {
    expect(vue).toMatch(/data-about="current-version"[^>]*>\{\{ versionText \}\}</)
    expect(vue).toContain('versionText: /^\\d/.test(Host.version) ? `v${Host.version}` : Host.version')
  })

  // 失敗代表:又回到單行勾選框,不是設計稿的「名稱 + 說明 | 開關」兩欄列
  it('自動更新、新版提醒、啟動提示、硬體加速都是兩欄列裡的開關', () => {
    for (const key of ['autoUpdate', 'updateReminder', 'startupToast', 'hardwareAcceleration']) {
      expect(vue, key).toMatch(new RegExp(`<div[^>]*class="srow"[^>]*>\\s*<span class="k">[\\s\\S]{0,900}?<label class="scan-switch"[^>]*>\\s*<input v-model="config\\.${key}" type="checkbox" role="switch"`))
    }
    expect(vue).not.toContain('class="chk"')
  })

  // 失敗代表:手動檢查列(按鈕 + 上次檢查時間)不見了
  it('手動檢查列:檢查更新按鈕旁顯示上次檢查時間', () => {
    expect(vue).toMatch(/<span class="k">\{\{ t\('ppz\.update\.manual'\) \}\}<\/span>[\s\S]{0,600}data-action="update-check"[\s\S]{0,1500}\{\{ lastChecked \}\}/)
  })

  // 失敗代表:兩語其中一個少了新字串
  it('新字串兩語都有', () => {
    for (const m of [zh, en]) {
      for (const k of ['auto_sub', 'reminder_sub', 'manual']) expect(m.ppz.update[k], k).toMatch(/\S/)
      expect(m.ppz.hw_accel.sub).toMatch(/\S/)
    }
  })
})
