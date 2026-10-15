// PoE1 倉庫價格「熱鍵顯示」模式(H1 / K7):設定往返、舊檔相容、送 main、立即送與 main scanConfigKey 同步、設定頁與狀態文字
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HOST_CONFIG_IMMEDIATE_KEYS, _roundTripForTest, hostConfigOf } from '../src/web/Config'
import { stashScanStatus } from '../src/web/settings/scan-card-specs'
import type { StashStats } from '@ipc/types'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('K7 stashTriggerMode 設定往返與同步守門', () => {
  it('預設 auto;舊檔 / 壞值 = auto;hotkey 存讀往返並送 main', () => {
    expect(_roundTripForTest(null).config.stashTriggerMode).toBe('auto')
    expect(_roundTripForTest('{"game":"poe1"}').config.stashTriggerMode).toBe('auto')
    expect(_roundTripForTest('{"stashTriggerMode":"bogus"}').config.stashTriggerMode).toBe('auto')
    const hk = _roundTripForTest('{"stashTriggerMode":"hotkey"}')
    expect(hk.config.stashTriggerMode).toBe('hotkey')
    expect(JSON.parse(hk.serialized).stashTriggerMode).toBe('hotkey')
    expect(hostConfigOf(hk.config).stashTriggerMode).toBe('hotkey')
    expect(hostConfigOf(_roundTripForTest(null).config).stashTriggerMode).toBe('auto')
  })
  it('立即送:HOST_CONFIG_IMMEDIATE_KEYS 與 main scanConfigKey 都有;main 讀 hostCfg.stashTriggerMode', () => {
    expect(HOST_CONFIG_IMMEDIATE_KEYS).toContain('stashTriggerMode')
    const key = read('../../main/src/scan-config.ts')
    expect(key).toMatch(/Pick<HostConfigForMain,[^>]*'stashTriggerMode'/)
    expect(key.slice(key.indexOf('function scanConfigKey'))).toContain('cfg.stashTriggerMode')
    expect(read('../../main/src/main.ts')).toContain("hostCfg?.stashTriggerMode === 'hotkey' ? 'hotkey' : 'auto'")
  })
  it('設定 › 自動辨識 › 倉庫價格卡 #extra 有「顯示方式」兩選一 + 說明;兩語字串', () => {
    const rec = read('../src/web/settings/tabs/Recognition.vue')
    expect(rec).toMatch(/kind="stash">[\s\S]*<template #extra>[\s\S]*data-setting="stash-trigger-mode"[\s\S]*<\/ocr-scan-section>/)
    expect(rec).toContain("config.stashTriggerMode = 'auto'")
    expect(rec).toContain("config.stashTriggerMode = 'hotkey'")
    for (const lang of ['cmn-Hant', 'en']) {
      const j = JSON.parse(read(`../src/i18n/${lang}.json`))
      for (const k of ['trigger_mode', 'trigger_auto', 'trigger_hotkey', 'trigger_hint', 'status_not_armed', 'status_capture_black']) {
        expect(j.ppz.stash[k], `${lang} ${k}`).toBeTruthy()
      }
    }
  })
  it('狀態列:not-armed =「等待熱鍵」、capture-black = 擷取全黑', () => {
    const zh = JSON.parse(read('../src/i18n/cmn-Hant.json')).ppz.stash
    const t = (k: string) => k
    const base: StashStats = { block: null, showing: false, subtab: null, lastOcrMs: null, ocrCount: 0 }
    expect(stashScanStatus({ ...base, block: 'not-armed' }, t, 'F6')).toMatchObject({ code: 'not-armed', text: 'ppz.stash.status_not_armed' })
    expect(stashScanStatus({ ...base, block: 'capture-black' }, t, 'F6')).toMatchObject({ code: 'capture-black', tone: 'warn', text: 'ppz.stash.status_capture_black' })
    expect(zh.status_not_armed).toContain('等待熱鍵')
    expect(zh.status_capture_black).toContain('全黑')
  })
})
