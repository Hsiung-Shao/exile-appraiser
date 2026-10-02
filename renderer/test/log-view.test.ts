// 設定 › 記錄 的純函式(renderer/src/web/settings/log-view.ts,第 28 步):篩選 / 關鍵字 / 合併 / 複製格式 / 自動捲動判定。
import { describe, expect, it } from 'vitest'
import type { LogEntry, LogLevel } from '@ipc/types'
import {
  LOG_FILTERS, filterLogEntries, formatLogText, isAtBottom, isErrorLine, logTime, matchesFilter, mergeLogEntries, oneLine
} from '../src/web/settings/log-view'

const e = (seq: number, text: string, level: LogLevel = 'info'): LogEntry => ({ seq, ts: new Date(2026, 9, 3, 12, 0, 0, seq).getTime(), level, text })

describe('isErrorLine', () => {
  it('error 等級、[renderer-error]、含 failed / 失敗 / Error', () => {
    expect(isErrorLine({ level: 'error', text: 'x' })).toBe(true)
    expect(isErrorLine({ level: 'info', text: '[renderer] [renderer-error] foo' })).toBe(true)
    expect(isErrorLine({ level: 'info', text: '[http] fetch failed: 500' })).toBe(true)
    expect(isErrorLine({ level: 'info', text: '[app] 解析(poe1) 失敗: x' })).toBe(true)
    expect(isErrorLine({ level: 'warn', text: 'TypeError: x is not a function' })).toBe(true)
    expect(isErrorLine({ level: 'info', text: '[main] 視窗模式 window' })).toBe(false)
    expect(isErrorLine({ level: 'warn', text: '[bg] 不支援的檔案類型' })).toBe(false)
  })
})

describe('matchesFilter(以行內容 tag 判定)', () => {
  const cases: Array<[string, string[], string[]]> = [
    ['ocr', ['[ocr] 可用', '[reveal-scan] 找到面板', '[runeshape] 掃描', '[ocr-region] 框選', '[renderer] [reveal-scan] x', '[capture] overlay screenshot 不可用', '[scan-mask] 遮掉 2 塊'], ['[shortcuts] x', '[app] 解析 OK']],
    ['trade', ['[app] 解析(poe1) OK: A / B', '[trade] POST /search', '[trade-site] 開啟', '[ninja] 價格表', '[http] GET', '[renderer] [app] 解析(poe2) 失敗: x'], ['[ocr] x', '[shortcuts] y']],
    ['hotkey', ['[shortcuts] 註冊 Ctrl+D', '[uiohook] start', '[uiohook-selftest] x'], ['[ocr] x', '[trade] y']]
  ]
  for (const [f, yes, no] of cases) {
    it(f, () => {
      for (const text of yes) expect(matchesFilter({ level: 'info', text }, f as 'ocr'), text).toBe(true)
      for (const text of no) expect(matchesFilter({ level: 'info', text }, f as 'ocr'), text).toBe(false)
    })
  }
  it('all 全過;error 走 isErrorLine', () => {
    expect(matchesFilter({ level: 'info', text: 'anything' }, 'all')).toBe(true)
    expect(matchesFilter({ level: 'error', text: 'x' }, 'error')).toBe(true)
    expect(matchesFilter({ level: 'info', text: 'ok' }, 'error')).toBe(false)
  })
  it('篩選清單', () => { expect(LOG_FILTERS).toEqual(['all', 'error', 'ocr', 'trade', 'hotkey']) })
})

describe('filterLogEntries', () => {
  const list = [e(1, '[ocr] a'), e(2, '[trade] b failed'), e(3, '[shortcuts] C'), e(4, '[main] c', 'error')]
  it('篩選 + 關鍵字(不分大小寫)疊加,順序不變', () => {
    expect(filterLogEntries(list, 'all', '').map(x => x.seq)).toEqual([1, 2, 3, 4])
    expect(filterLogEntries(list, 'error', '').map(x => x.seq)).toEqual([2, 4])
    expect(filterLogEntries(list, 'all', 'c').map(x => x.seq)).toEqual([1, 3, 4])
    expect(filterLogEntries(list, 'error', 'C').map(x => x.seq)).toEqual([4])
    expect(filterLogEntries(list, 'ocr', '  ').map(x => x.seq)).toEqual([1])
    expect(filterLogEntries(list, 'hotkey', 'zzz')).toEqual([])
  })
  it('all + 無關鍵字回傳複本', () => {
    const out = filterLogEntries(list, 'all', '')
    expect(out).not.toBe(list)
    expect(out).toEqual(list)
  })
})

describe('mergeLogEntries', () => {
  it('即時追加:接在後面', () => {
    const cur = [e(1, 'a'), e(2, 'b')]
    expect(mergeLogEntries(cur, [e(3, 'c'), e(4, 'd')]).map(x => x.seq)).toEqual([1, 2, 3, 4])
  })
  it('快照與即時追加重疊:以 seq 去重並排序', () => {
    const cur = [e(5, 'e'), e(6, 'f')] // 先收到的即時追加
    const out = mergeLogEntries(cur, [e(3, 'c'), e(4, 'd'), e(5, 'e'), e(6, 'f')])
    expect(out.map(x => x.seq)).toEqual([3, 4, 5, 6])
  })
  it('空的追加回原陣列;超過上限只留最新', () => {
    const cur = [e(1, 'a')]
    expect(mergeLogEntries(cur, [])).toBe(cur)
    const big = Array.from({ length: 10 }, (_, i) => e(i + 1, String(i)))
    expect(mergeLogEntries([], big, 4).map(x => x.seq)).toEqual([7, 8, 9, 10])
    expect(mergeLogEntries(big.slice(0, 5), big.slice(5), 6).map(x => x.seq)).toEqual([5, 6, 7, 8, 9, 10])
  })
  it('追加內部亂序也能排好', () => {
    expect(mergeLogEntries([e(1, 'a')], [e(4, 'd'), e(2, 'b'), e(3, 'c')]).map(x => x.seq)).toEqual([1, 2, 3, 4])
  })
})

describe('顯示 / 複製格式', () => {
  it('logTime 本機 HH:MM:SS.mmm', () => {
    expect(logTime(new Date(2026, 9, 3, 9, 5, 7, 42).getTime())).toBe('09:05:07.042')
  })
  it('formatLogText:每筆一個時間戳開頭的區塊,多行續行縮排', () => {
    const t = formatLogText([e(1, 'one'), e(2, 'two\nstack', 'error')])
    expect(t).toBe('2026-10-03 12:00:00.001 [INFO] one\n2026-10-03 12:00:00.002 [ERROR] two\n    stack')
  })
  it('oneLine:換行串成 ↵', () => {
    expect(oneLine('a\n   b\r\nc')).toBe('a ↵ b ↵ c')
    expect(oneLine('plain')).toBe('plain')
  })
})

describe('isAtBottom(自動捲動:往上捲暫停,捲回底部恢復)', () => {
  it('底部 / 接近底部 = true;往上捲 = false', () => {
    expect(isAtBottom(600, 400, 1000)).toBe(true)
    expect(isAtBottom(590, 400, 1000)).toBe(true) // 差 10px 內
    expect(isAtBottom(500, 400, 1000)).toBe(false)
    expect(isAtBottom(0, 400, 300)).toBe(true) // 內容比視窗短
  })
})
