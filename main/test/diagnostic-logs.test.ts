// 2026-11-26 診斷記錄(使用者回報「程式啟動正常但查價沒反應」):匯出記錄檔、剪貼簿逾時摘要、交易站請求記錄、倉庫辨識記錄點。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { userAgentFallback: 'UA-test' },
  clipboard: { readText: () => '', writeText: () => {} },
  session: { defaultSession: { fetch: () => Promise.reject(new Error('no')), webRequest: { onHeadersReceived: () => {} } } }
}))

import { buildLogExport, logFileName, pickExportLogFiles } from '../src/app-log'
import { describeClipboard } from '../src/HostClipboard'
import { httpLogLine } from '../src/http'
import { logExportSummary, matchesFilter } from '../../renderer/src/web/settings/log-view'

const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).getTime()
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8')

describe('匯出記錄檔:挑檔', () => {
  it('只帶今天與昨天,舊到新、同一天 .1 在前', () => {
    const now = at(2026, 11, 26)
    const names = [
      logFileName(at(2026, 11, 26)), `${logFileName(at(2026, 11, 26))}.1`, logFileName(at(2026, 11, 25)),
      logFileName(at(2026, 11, 24)), 'perf-2026-11-26.log', 'stash-capture-1.png'
    ]
    expect(pickExportLogFiles(names, now)).toEqual([
      'exile-appraiser-2026-11-25.log', 'exile-appraiser-2026-11-26.log.1', 'exile-appraiser-2026-11-26.log'
    ])
  })
  it('沒有記錄檔回空陣列', () => {
    expect(pickExportLogFiles(['foo.txt'], at(2026, 11, 26))).toEqual([])
  })
})

describe('匯出記錄檔:內容', () => {
  it('摘要在前、記錄在後', () => {
    const t = buildLogExport(['版本 0.3.19'], 'line1\nline2')
    expect(t.indexOf('版本 0.3.19')).toBeLessThan(t.indexOf('line1'))
    expect(t).toContain('line2')
  })
  it('超過上限只留最後面、從完整一行開始', () => {
    const log = Array.from({ length: 100 }, (_, i) => `row-${i}`).join('\n')
    const t = buildLogExport([], log, 60)
    expect(t).toContain('row-99')
    expect(t).not.toContain('row-0\n')
    const body = t.split('===== 記錄 =====\n')[1].split('\n').slice(1)
    expect(body.every(l => /^row-\d+$/.test(l))).toBe(true)
  })
})

describe('剪貼簿逾時摘要', () => {
  it('空的 = 遊戲沒有複製', () => {
    expect(describeClipboard('', 'x')).toContain('空的')
  })
  it('與按鍵前相同', () => {
    expect(describeClipboard('hello', 'hello')).toContain('與按鍵前相同')
  })
  it('像物品標頭才記第一行(其他語言客戶端)', () => {
    expect(describeClipboard('Classe d\'objet: Bottes\nRareté: Rare\nFoo', '')).toContain('第一行「Classe')
  })
  it('單行「帳號: 密碼」不記內容', () => {
    expect(describeClipboard('password: hunter2', '')).not.toContain('hunter2')
  })
  it('一般文字(可能是密碼)不記內容', () => {
    const d = describeClipboard('my secret password 123', '')
    expect(d).not.toContain('secret')
    expect(d).toContain('22 字元')
  })
})

describe('交易站請求記錄', () => {
  const ok = { status: 200, headers: [['x-rate-limit-ip-state', '1:10:0']] as Array<[string, string]>, body: '{}' }
  it('交易站成功也記,帶限流狀態', () => {
    expect(httpLogLine('POST', new URL('https://www.pathofexile.com/api/trade/search/Standard'), ok, 320))
      .toBe('[http] POST www.pathofexile.com/api/trade/search/Standard → 200(320 ms,限流 1:10:0)')
  })
  it('poe.ninja 成功不記、失敗記', () => {
    const u = new URL('https://poe.ninja/api/data/x')
    expect(httpLogLine('GET', u, ok, 10)).toBeNull()
    expect(httpLogLine('GET', u, { ...ok, status: 500 }, 10)).toContain('→ 500')
  })
  it('403 HTML 標成 Cloudflare', () => {
    const l = httpLogLine('POST', new URL('https://www.pathofexile.com/api/trade/search/x'), { status: 403, headers: [], body: '<html>Just a moment... cloudflare' }, 5)
    expect(l).toContain('可能是 Cloudflare 驗證')
  })
  it('400 JSON 帶交易站錯誤訊息', () => {
    const l = httpLogLine('POST', new URL('https://www.pathofexile.com/api/trade/search/x'), { status: 400, headers: [], body: '{"error":{"code":2,"message":"Query is too complex."}}' }, 5)
    expect(l).toContain('Query is too complex')
  })
  it('fetch 長路徑截斷', () => {
    const l = httpLogLine('GET', new URL(`https://www.pathofexile.com/api/trade/fetch/${'a'.repeat(300)}`), ok, 5)!
    expect(l.length).toBeLessThan(200)
  })
})

describe('設定摘要與篩選', () => {
  const cfg = {
    game: 'poe1', realm: 'intl', language: 'cmn-Hant', uiLanguage: 'cmn-Hant', overlayMode: true, windowTitleBy: { poe1: 'Path of Exile' },
    hotkeyHold: 'Ctrl', hotkey: 'D', hotkeyLocked: 'Alt + D', overlayKey: 'Shift + Space', restoreClipboard: false,
    leagueBy: { poe1: { intl: 'Mercenaries' } }, stashPricesEnabled: true, stashTriggerMode: 'auto', stashReadQuantity: true,
    stashPricesIntervalMs: 1000, stashRegion: null, hardwareAcceleration: false, accountName: 'someone'
  }
  it('摘要含查價熱鍵與聯盟,不含帳號', () => {
    const s = logExportSummary(cfg, 'en').join('\n')
    expect(s).toContain('Ctrl + D')
    expect(s).toContain('Mercenaries')
    expect(s).toContain('目前資料 en')
    expect(s).not.toContain('someone')
  })
  it('新記錄行歸到查價 / 熱鍵篩選', () => {
    expect(matchesFilter({ level: 'info', text: '[renderer] [app] 收到物品文字 300 字元' }, 'trade')).toBe(true)
    expect(matchesFilter({ level: 'warn', text: '[ClipboardPoller] No item text found.' }, 'hotkey')).toBe(true)
  })
})

describe('接線守門', () => {
  const main = read('../src/main.ts')
  it('log-export:invoke + preview: false、preload 與 renderer 接上', () => {
    const i = main.indexOf("'log-export':")
    expect(i).toBeGreaterThan(0)
    const block = main.slice(i, main.indexOf("'config-open-folder':", i))
    expect(block).toContain("kind: 'invoke'")
    expect(block).toContain('preview: false')
    expect(read('../src/preload.ts')).toContain("ipcRenderer.invoke('log-export', summary)")
    expect(read('../../renderer/src/web/settings/tabs/Log.vue')).toContain('data-action="log-export"')
  })
  it('倉庫辨識:收起一定帶原因、設定 / 擷取幾何有變才記', () => {
    const scan = read('../src/ocr/stash-scan.ts')
    const hides = scan.match(/this\.hide\([^\n]*/g) ?? []
    expect(hides.length).toBeGreaterThan(0)
    for (const h of hides) expect(h, h).toContain('why:')
    expect(scan).toContain('cfgKey !== this.lastCfgKey')
    expect(scan).toContain('key !== this.lastCapKey')
  })
})
