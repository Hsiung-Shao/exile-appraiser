// 2026-10-01:褻瀆自動辨識的 renderer 端(徽章層事件處理、設定頁狀態列、設定欄位往返)
import { describe, expect, it } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'
import { revealScanAction, revealScanStatus } from '../src/web/overlay/ocr-reveal'

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
  it('第 13 步:「已改找整個畫面」提示與它的判斷函式已移除(有框區域只看區域)', async () => {
    const mod = await import('../src/web/overlay/ocr-reveal')
    expect('fallbackNoteShows' in mod).toBe(false)
  })
})

describe('revealScanStatus:設定頁狀態列', () => {
  const t = (k: string, a?: Record<string, unknown>) => a ? `${k}:${JSON.stringify(a)}` : k
  it('暫停 > 框選區域內有 / 沒有找到(同符文塑形的狀態)> 找到 > 尋找中', () => {
    expect(revealScanStatus(undefined, t, 'Ctrl + Shift + R')).toBeNull()
    expect(revealScanStatus({ reason: 'user-paused', panel: 'found', mode: 'auto' }, t, 'Ctrl + Shift + R'))
      .toEqual({ code: 'paused', warn: true, text: 'ppz.ocr.scan_status_paused:{"hotkey":"Ctrl + Shift + R"}' })
    expect(revealScanStatus({ panel: 'found', mode: 'manual' }, t, ''))
      .toEqual({ code: 'manual-found', warn: false, text: 'ppz.runeshape.status_manual_found' })
    expect(revealScanStatus({ panel: 'not-found', mode: 'manual' }, t, ''))
      .toEqual({ code: 'manual-not-found', warn: true, text: 'ppz.runeshape.status_manual_not_found' })
    expect(revealScanStatus({ panel: 'unknown', mode: 'manual' }, t, '')?.code).toBe('searching')
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
  it('只有明確 false 才關;間隔夾在 100–3000(下限 2026-10-01 由 500 放寬)', () => {
    expect(_roundTripForTest(JSON.stringify({ revealAutoEnabled: false })).config.revealAutoEnabled).toBe(false)
    expect(_roundTripForTest(JSON.stringify({ revealAutoEnabled: 'no' })).config.revealAutoEnabled).toBe(true)
    expect(_roundTripForTest(JSON.stringify({ revealIntervalMs: 100 })).config.revealIntervalMs).toBe(100)
    expect(_roundTripForTest(JSON.stringify({ revealIntervalMs: 20 })).config.revealIntervalMs).toBe(100)
    // 2026-10-01 設定頁拿掉手動比例欄位,但舊設定檔(或手改)的 ocrRegion 仍照常讀寫
    const region = { x: 0.19, y: 0.44, w: 0.28, h: 0.25 }
    const r = _roundTripForTest(JSON.stringify({ ocrRegion: region }))
    expect(r.config.ocrRegion).toEqual(region)
    expect(JSON.parse(r.serialized).ocrRegion).toEqual(region)
    expect(_roundTripForTest(JSON.stringify({ revealIntervalMs: 1800 })).config.revealIntervalMs).toBe(1800)
    expect(_roundTripForTest(JSON.stringify({ revealIntervalMs: 'x' })).config.revealIntervalMs).toBe(1000)
  })
  it('第 13 步 revealShowAllCandidates:舊設定檔沒有 → 關;只有明確 true 才開;往返保留', () => {
    expect(_roundTripForTest(JSON.stringify({})).config.revealShowAllCandidates).toBe(false)
    expect(_roundTripForTest(JSON.stringify({ revealShowAllCandidates: 'yes' })).config.revealShowAllCandidates).toBe(false)
    const r = _roundTripForTest(JSON.stringify({ revealShowAllCandidates: true }))
    expect(r.config.revealShowAllCandidates).toBe(true)
    expect(JSON.parse(r.serialized).revealShowAllCandidates).toBe(true)
  })
})
