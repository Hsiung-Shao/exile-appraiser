// 倉庫價值除錯:設定 › 記錄「存下倉庫擷取畫面」按鈕(IPC `stash-dump`):結果文案對應、字串兩語、接線守門。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { STASH_DUMP_REASON_KEYS, stashDumpMessage } from '../src/web/settings/stash-dump-view'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const zh = JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz.log
const en = JSON.parse(read('renderer/src/i18n/en.json')).ppz.log
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

describe('結果文案', () => {
  it('存檔成功:顯示檔名、不是錯誤', () => {
    expect(stashDumpMessage({ ok: true, file: 'C:\\u\\logs\\stash-capture-20261015-123456-scarabs.png' }))
      .toEqual({ key: 'ppz.log.stash_dump_saved', params: { file: 'stash-capture-20261015-123456-scarabs.png' }, bad: false })
  })

  it('疊層沒顯示 / 逾時 / 停用各有自己的字串,標成錯誤', () => {
    expect(stashDumpMessage({ ok: false, reason: 'not-showing' })).toMatchObject({ key: 'ppz.log.stash_dump_not_showing', bad: true })
    expect(stashDumpMessage({ ok: false, reason: 'timeout' })).toMatchObject({ key: 'ppz.log.stash_dump_timeout', bad: true })
    expect(stashDumpMessage({ ok: false, reason: 'disabled' })).toMatchObject({ key: 'ppz.log.stash_dump_disabled', bad: true })
    expect(stashDumpMessage({ ok: false, reason: 'not-poe1' })).toMatchObject({ key: 'ppz.log.stash_dump_not_poe1' })
    expect(stashDumpMessage({ ok: false, reason: 'not-intl' })).toMatchObject({ key: 'ppz.log.stash_dump_not_intl' })
  })

  it('不認得的原因 / 寫檔失敗:通用失敗字串帶訊息', () => {
    expect(stashDumpMessage({ ok: false, reason: 'write-failed', message: 'EACCES' }))
      .toEqual({ key: 'ppz.log.stash_dump_failed', params: { msg: 'EACCES' }, bad: true })
    expect(stashDumpMessage({ ok: false, reason: 'whatever' })).toEqual({ key: 'ppz.log.stash_dump_failed', params: { msg: 'whatever' }, bad: true })
  })
})

describe('字串兩語', () => {
  const keys = ['stash_dump', 'stash_dump_hint', 'stash_dump_waiting', 'stash_dump_saved', 'stash_dump_failed',
    ...Object.values(STASH_DUMP_REASON_KEYS).map(k => k.replace('ppz.log.', ''))]

  it('中英文 ppz.log.stash_dump* 都有且參數相同', () => {
    expect(keys.length).toBeGreaterThan(8)
    for (const k of keys) {
      expect(typeof zh[k], `cmn-Hant ppz.log.${k}`).toBe('string')
      expect(typeof en[k], `en ppz.log.${k}`).toBe('string')
      expect(params(en[k]), k).toEqual(params(zh[k]))
    }
  })

  it('說明一句提到記錄資料夾與只存本機', () => {
    expect(zh.stash_dump_hint).toMatch(/記錄資料夾/)
    expect(zh.stash_dump_hint).toMatch(/本機/)
    expect(en.stash_dump_hint).toMatch(/log folder/i)
  })
})

describe('接線', () => {
  it('記錄分頁有按鈕,只在 Host.canStashDump(Electron 視窗)時顯示,呼叫 Host.stashDump', () => {
    const vue = read('renderer/src/web/settings/tabs/Log.vue')
    expect(vue).toContain('data-action="stash-dump"')
    expect(vue).toContain('const canStashDump = Host.canStashDump')
    expect(vue).toMatch(/v-if="canStashDump"/)
    expect(vue).toContain('await Host.stashDump()')
    expect(vue).toContain('stashDumpMessage(')
    const ipc = read('renderer/src/web/background/IPC.ts')
    expect(ipc).toMatch(/get canStashDump \(\): boolean \{ return !this\.isPreview && typeof window\.host\?\.stashDump === 'function' \}/)
  })
})
