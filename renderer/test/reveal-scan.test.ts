// 2026-10-01:褻瀆自動辨識的 renderer 端(徽章層事件處理、設定頁狀態列、設定欄位往返)
import { describe, expect, it } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'
import { fallbackNoteShows, revealScanAction, revealScanStatus } from '../src/web/overlay/ocr-reveal'

const row = { text: '+16 最大生命', x: 1, y: 2, w: 3, h: 4 }

describe('revealScanAction:徽章跟著自動辨識事件更新', () => {
  it('有列 → 比對;PoE1 / 沒有列 → 清除', () => {
    expect(revealScanAction({ reason: 'rows', rows: [row] }, 'poe2')).toEqual({ kind: 'match' })
    expect(revealScanAction({ reason: 'rows', rows: [row] }, 'poe1').kind).toBe('clear')
    expect(revealScanAction({ reason: 'rows', rows: [] }, 'poe2').kind).toBe('clear')
  })
  it('只在 empty / inactive / 暫停清除;繼續不動(下一個有列的事件再畫)', () => {
    expect(revealScanAction({ reason: 'empty', rows: [] }, 'poe2')).toEqual({ kind: 'clear', reason: '面板關了' })
    expect(revealScanAction({ reason: 'inactive', rows: [] }, 'poe2')).toEqual({ kind: 'clear', reason: '停止辨識' })
    expect(revealScanAction({ reason: 'user-paused', rows: [] }, 'poe2')).toEqual({ kind: 'clear', reason: '使用者暫停' })
    expect(revealScanAction({ reason: 'user-resumed', rows: [] }, 'poe2')).toEqual({ kind: 'ignore' })
  })
  it('沒有 15 秒逾時 / 再按清除:模組不再匯出 TTL 常數', async () => {
    const mod = await import('../src/web/overlay/ocr-reveal')
    expect('BADGE_TTL_MS' in mod).toBe(false)
    expect('ERROR_TTL_MS' in mod).toBe(false)
  })
  it('退回整個畫面的提示只在剛切過去時顯示一次', () => {
    expect(fallbackNoteShows(true, false)).toBe(true)
    expect(fallbackNoteShows(true, true)).toBe(false)
    expect(fallbackNoteShows(false, true)).toBe(false)
    expect(fallbackNoteShows(undefined, false)).toBe(false)
  })
})

describe('revealScanStatus:設定頁狀態列', () => {
  const t = (k: string, a?: Record<string, unknown>) => a ? `${k}:${JSON.stringify(a)}` : k
  it('暫停 > 退回 > 找到 > 尋找中', () => {
    expect(revealScanStatus(undefined, t, 'Ctrl + Shift + R')).toBeNull()
    expect(revealScanStatus({ reason: 'user-paused', panel: 'found', mode: 'auto' }, t, 'Ctrl + Shift + R'))
      .toEqual({ code: 'paused', warn: true, text: 'ppz.ocr.scan_status_paused:{"hotkey":"Ctrl + Shift + R"}' })
    expect(revealScanStatus({ panel: 'found', mode: 'manual', fallback: true }, t, '')?.code).toBe('fallback')
    expect(revealScanStatus({ panel: 'found', mode: 'auto' }, t, '')).toEqual({ code: 'found', warn: false, text: 'ppz.ocr.scan_status_found' })
    expect(revealScanStatus({ panel: 'not-found', mode: 'auto' }, t, '')?.code).toBe('searching')
    expect(revealScanStatus({ panel: 'unknown', mode: 'auto' }, t, '')?.code).toBe('searching')
  })
})

describe('設定欄位 revealAutoEnabled / revealIntervalMs', () => {
  it('舊設定檔沒有 → 預設開、1000 ms;熱鍵與區域不受影響', () => {
    const { config, serialized } = _roundTripForTest(JSON.stringify({ game: 'poe2', hotkeyOcrReveal: 'Ctrl + Shift + R' }))
    expect(config.revealAutoEnabled).toBe(true)
    expect(config.revealIntervalMs).toBe(1000)
    expect(JSON.parse(serialized)).toMatchObject({ revealAutoEnabled: true, revealIntervalMs: 1000, hotkeyOcrReveal: 'Ctrl + Shift + R', ocrRegion: null })
  })
  it('只有明確 false 才關;間隔夾在 500–3000', () => {
    expect(_roundTripForTest(JSON.stringify({ revealAutoEnabled: false })).config.revealAutoEnabled).toBe(false)
    expect(_roundTripForTest(JSON.stringify({ revealAutoEnabled: 'no' })).config.revealAutoEnabled).toBe(true)
    expect(_roundTripForTest(JSON.stringify({ revealIntervalMs: 100 })).config.revealIntervalMs).toBe(500)
    expect(_roundTripForTest(JSON.stringify({ revealIntervalMs: 1800 })).config.revealIntervalMs).toBe(1800)
    expect(_roundTripForTest(JSON.stringify({ revealIntervalMs: 'x' })).config.revealIntervalMs).toBe(1000)
  })
})
