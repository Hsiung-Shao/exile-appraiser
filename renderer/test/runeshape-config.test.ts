// WP-R2:符文塑形自動查價的設定欄位(Config.ts 五處:介面、預設、serialize、applyLoaded、host-config)
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RUNESHAPE_THRESHOLDS, SCAN_INTERVAL_CPU_WARN_MS, SCAN_INTERVAL_MAX_MS, SCAN_INTERVAL_MIN_MS, _roundTripForTest, clampRuneshapeInterval,
  normRuneshapeThresholds
} from '../src/web/Config'

describe('正規化', () => {
  it('clampRuneshapeInterval:100–3000(下限 2026-10-01 由 500 放寬),預設 1000;與 main 同值', () => {
    expect(SCAN_INTERVAL_MIN_MS).toBe(100)
    expect(SCAN_INTERVAL_MAX_MS).toBe(3000)
    expect(SCAN_INTERVAL_CPU_WARN_MS).toBe(500)
    expect(clampRuneshapeInterval(undefined)).toBe(1000)
    expect(clampRuneshapeInterval(50)).toBe(100)
    expect(clampRuneshapeInterval(100)).toBe(100)
    expect(clampRuneshapeInterval(300)).toBe(300)
    expect(clampRuneshapeInterval(5000)).toBe(3000)
    expect(clampRuneshapeInterval(1499.6)).toBe(1500)
    expect(clampRuneshapeInterval('800')).toBe(1000)
  })
  it('normRuneshapeThresholds:非負有限數、high < low 對調、壞掉用預設', () => {
    expect(normRuneshapeThresholds(undefined)).toEqual(DEFAULT_RUNESHAPE_THRESHOLDS)
    expect(DEFAULT_RUNESHAPE_THRESHOLDS).toEqual({ low: 0.5, high: 5 })
    expect(normRuneshapeThresholds({ low: 3, high: 1 })).toEqual({ low: 1, high: 3 })
    expect(normRuneshapeThresholds({ low: -1, high: 'x' })).toEqual({ low: 0.5, high: 5 })
    expect(normRuneshapeThresholds({ low: 0, high: 20 })).toEqual({ low: 0, high: 20 })
  })
})

describe('設定檔往返', () => {
  it('舊設定檔(沒有 WP-R2 欄位)→ 預設:關、未框選、1000 ms、門檻 0.5 / 5、熱鍵空', () => {
    const { config, serialized } = _roundTripForTest(JSON.stringify({ game: 'poe2', hotkeyOcrReveal: 'Ctrl + Shift + R' }))
    expect(config.runeshapeEnabled).toBe(false)
    expect(config.runeshapeRegion).toBeNull()
    expect(config.runeshapeIntervalMs).toBe(1000)
    expect(config.runeshapeThresholds).toEqual({ low: 0.5, high: 5 })
    expect(config.hotkeyRuneshapeToggle).toBe('')
    expect(config.hotkeyRuneshapeRegion).toBe('')
    const out = JSON.parse(serialized)
    expect(out).toMatchObject({ runeshapeEnabled: false, runeshapeRegion: null, runeshapeIntervalMs: 1000, runeshapeThresholds: { low: 0.5, high: 5 }, hotkeyRuneshapeToggle: '', hotkeyRuneshapeRegion: '' })
    // 揭露面板的欄位不受影響
    expect(out.hotkeyOcrReveal).toBe('Ctrl + Shift + R')
    expect(out.ocrRegion).toBeNull()
  })
  it('寫入值讀回相同;壞值被正規化', () => {
    const saved = {
      runeshapeEnabled: true,
      runeshapeRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      runeshapeIntervalMs: 1500,
      runeshapeThresholds: { low: 1, high: 10 },
      hotkeyRuneshapeToggle: 'Ctrl + Shift + P',
      hotkeyRuneshapeRegion: 'Ctrl + Shift + O'
    }
    const a = _roundTripForTest(JSON.stringify(saved))
    expect(JSON.parse(a.serialized)).toMatchObject(saved)
    const b = _roundTripForTest(JSON.stringify({
      runeshapeEnabled: 'yes',
      runeshapeRegion: { x: 0.9, y: 0, w: 0.5, h: 1 },
      runeshapeIntervalMs: 50,
      runeshapeThresholds: { low: 9, high: 2 },
      hotkeyRuneshapeToggle: 5,
      hotkeyRuneshapeRegion: null
    }))
    expect(b.config.runeshapeEnabled).toBe(false)
    expect(b.config.runeshapeRegion).toBeNull() // x + w > 1
    expect(b.config.runeshapeIntervalMs).toBe(100)
    expect(b.config.hotkeyRuneshapeRegion).toBe('')
    expect(b.config.runeshapeThresholds).toEqual({ low: 2, high: 9 })
    expect(b.config.hotkeyRuneshapeToggle).toBe('')
  })
})
