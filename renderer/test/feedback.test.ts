import { describe, expect, it } from 'vitest'
import {
  buildReport, openIssue, copyReport, sanitize, summarizeUserAgent,
  MAX_ISSUE_URL_LENGTH, CLIPBOARD_HINT, ISSUE_NEW_URL, type ReportInput
} from '../src/web/feedback'

const CLIP = [
  '物品種類: 雙手劍',
  '稀有度: 稀有',
  '災厄 斬擊',
  '奇異之刃',
  '--------',
  '+25 力量'
].join('\n')

const ITEM = {
  rarity: 'Rare',
  category: 'Two-Handed Sword',
  info: { name: '奇異之刃', refName: 'Exquisite Blade', namespace: 'ITEM' },
  unknownModifiers: [{ text: '這行認不出來', type: 'explicit' }],
  // 不該出現的東西
  accountName: 'SECRET_ACCOUNT_42',
  owner: { accountName: 'SECRET_ACCOUNT_42' }
}

const REQUEST = {
  query: { status: { option: 'online' }, type: 'Exquisite Blade', filters: { trade_filters: { filters: { account: { input: 'SECRET_ACCOUNT_42' } } } } },
  sort: { price: 'asc' },
  accountName: 'SECRET_ACCOUNT_42',
  token: 'tok_abc'
}

function input (over: Partial<ReportInput> = {}): ReportInput {
  return {
    game: 'poe1',
    realm: 'tw',
    language: 'cmn-Hant',
    uiLanguage: 'en',
    version: '3.29.0',
    clipboard: CLIP,
    item: ITEM,
    request: REQUEST,
    requestNote: 'Recomputed with default filters',
    platform: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) exile-appraiser/3.29.0 Chrome/130.0.6723.191 Electron/33.4.11 Safari/537.36',
    ...over
  }
}

function recorder () {
  const opened: string[] = []
  const clip: string[] = []
  return {
    opened,
    clip,
    deps: {
      openExternal: (u: string) => { opened.push(u) },
      writeClipboard: (t: string) => { clip.push(t) }
    }
  }
}

describe('buildReport', () => {
  it('標題 = [game/realm] 名稱(refName) — 錯誤或 price check issue', () => {
    expect(buildReport(input()).title).toBe('[poe1/tw] 奇異之刃(Exquisite Blade) — price check issue')
    expect(buildReport(input({ error: 'HTTP 400: Invalid query' })).title).toBe('[poe1/tw] 奇異之刃(Exquisite Blade) — HTTP 400: Invalid query')
    expect(buildReport(input({ item: undefined, error: undefined, game: 'poe2', realm: 'intl' })).title).toBe('[poe2/intl] feedback')
  })

  it('內文含版本 / 遊戲 / 區 / 語言 / OS / 剪貼簿原文 / 解析摘要 / 查詢 JSON / 錯誤', () => {
    const { body } = buildReport(input({ error: 'boom' }))
    for (const s of [
      'Version: 3.29.0', 'Game: poe1', 'Realm: tw', 'Client language: cmn-Hant', 'UI language: en',
      'OS: Windows NT 10.0; Win64; x64 · Electron 33.4.11 · Chrome 130.0.6723.191',
      '### Clipboard', CLIP,
      'refName: Exquisite Blade', 'namespace: ITEM', 'category: Two-Handed Sword', 'rarity: Rare',
      'unknownModifiers (1):', '這行認不出來',
      '### Trade query', '```json', '"type": "Exquisite Blade"', 'Recomputed with default filters',
      '### Error', 'boom'
    ]) expect(body).toContain(s)
  })

  it('沒有物品 / 查詢時不放那兩段', () => {
    const { body } = buildReport(input({ item: undefined, request: undefined, clipboard: undefined }))
    expect(body).not.toContain('### Parsed item')
    expect(body).not.toContain('### Trade query')
    expect(body).not.toContain('### Clipboard')
    expect(body).toContain('Version: 3.29.0')
  })

  it('不外洩 accountName / token(即使輸入物件夾帶)', () => {
    const { title, body } = buildReport(input())
    expect(body).not.toContain('SECRET_ACCOUNT_42')
    expect(title).not.toContain('SECRET_ACCOUNT_42')
    expect(body).not.toContain('tok_abc')
    expect(body).not.toMatch(/accountName/)
  })

  it('剪貼簿含 ``` 時圍欄加長,不會被截斷', () => {
    const { body } = buildReport(input({ clipboard: 'a\n```\nb' }))
    expect(body).toContain('````\na\n```\nb\n````')
  })
})

describe('sanitize / summarizeUserAgent', () => {
  it('遞迴移除敏感鍵、保留其他', () => {
    expect(sanitize({ a: 1, accountName: 'x', n: [{ POESESSID: 'y', b: 2 }] })).toEqual({ a: 1, n: [{ b: 2 }] })
  })
  it('空 UA', () => {
    expect(summarizeUserAgent(undefined)).toBe('unknown')
  })
})

describe('openIssue', () => {
  it('短報告:整份放在網址,不動剪貼簿', async () => {
    const r = recorder()
    const report = buildReport(input())
    const res = await openIssue(report, r.deps)
    expect(res.path).toBe('url')
    expect(r.clip).toEqual([])
    expect(r.opened).toEqual([res.url])
    expect(res.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH)
    expect(res.url.startsWith(`${ISSUE_NEW_URL}?title=`)).toBe(true)
    const u = new URL(res.url)
    expect(u.searchParams.get('title')).toBe(report.title)
    expect(u.searchParams.get('body')).toBe(report.body)
  })

  it('超過 6000 字元:網址只帶標題 + 提示,全文進剪貼簿', async () => {
    const r = recorder()
    const report = buildReport(input({ clipboard: 'x'.repeat(20 * 1024) }))
    const res = await openIssue(report, r.deps)
    expect(res.path).toBe('clipboard')
    expect(r.clip).toEqual([report.body])
    expect(res.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH)
    const u = new URL(r.opened[0])
    expect(u.searchParams.get('title')).toBe(report.title)
    expect(u.searchParams.get('body')).toBe(CLIPBOARD_HINT)
  })

  it('門檻:恰好 6000 走網址、6001 走剪貼簿', async () => {
    const base = buildReport(input({ clipboard: '' , request: undefined, item: undefined }))
    const baseLen = (`${ISSUE_NEW_URL}?title=${encodeURIComponent(base.title)}&body=${encodeURIComponent(base.body)}`).length
    const pad = (n: number) => ({ title: base.title, body: base.body + 'a'.repeat(n) })
    const r1 = recorder()
    expect((await openIssue(pad(MAX_ISSUE_URL_LENGTH - baseLen), r1.deps)).path).toBe('url')
    expect(r1.opened[0].length).toBe(MAX_ISSUE_URL_LENGTH)
    const r2 = recorder()
    expect((await openIssue(pad(MAX_ISSUE_URL_LENGTH - baseLen + 1), r2.deps)).path).toBe('clipboard')
  })
})

describe('copyReport', () => {
  it('標題 + 內文', async () => {
    const r = recorder()
    const report = buildReport(input())
    await copyReport(report, r.deps)
    expect(r.clip[0]).toBe(`# ${report.title}\n\n${report.body}`)
  })
})
