// 第 15 步:倉庫頁籤捲動設定 `stashScroll`(Config.ts:介面、預設、serialize、applyLoaded、host-config)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _roundTripForTest, hostConfigOf } from '../src/web/Config'
import { createHostConfigSync } from '../src/web/host-config-sync'
import type { HostConfigForMain } from '@ipc/types'

describe('stashScroll 設定檔往返', () => {
  it('全新 / 舊設定檔沒有這欄 → 預設開(同 APT),且會寫進檔', () => {
    for (const raw of [null, '{"game":"poe1"}', '{"game":"poe2","commands":[]}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.stashScroll).toBe(true)
      expect(JSON.parse(serialized).stashScroll).toBe(true)
    }
  })
  it('明確 false 才關;非布林值當成開', () => {
    const off = _roundTripForTest('{"stashScroll":false}')
    expect(off.config.stashScroll).toBe(false)
    expect(JSON.parse(off.serialized).stashScroll).toBe(false)
    expect(_roundTripForTest('{"stashScroll":0}').config.stashScroll).toBe(true)
    expect(_roundTripForTest('{"stashScroll":"no"}').config.stashScroll).toBe(true)
    expect(_roundTripForTest('{"stashScroll":true}').config.stashScroll).toBe(true)
  })
})

describe('host-config 包含 stashScroll', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('hostConfigOf 帶出目前值', () => {
    expect(hostConfigOf(_roundTripForTest(null).config).stashScroll).toBe(true)
    expect(hostConfigOf(_roundTripForTest('{"stashScroll":false}').config).stashScroll).toBe(false)
  })
  it('只改 stashScroll 也會送出(去抖後),改回原值則不送', () => {
    const send = vi.fn()
    const sync = createHostConfigSync<HostConfigForMain>({ send, immediateKeys: ['game', 'overlayMode'] })
    const { config } = _roundTripForTest(null)
    const on = hostConfigOf(config)
    sync.update(on)
    expect(send).toHaveBeenCalledTimes(1)
    config.stashScroll = false
    sync.update(hostConfigOf(config))
    vi.advanceTimersByTime(300)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0].stashScroll).toBe(false)
    // 又改回:與上次送出的(false)不同 → 送;同值重複 → 不送
    config.stashScroll = true
    sync.update(hostConfigOf(config))
    sync.update(hostConfigOf(config))
    vi.advanceTimersByTime(300)
    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls[2][0].stashScroll).toBe(true)
    // 改了又在去抖期間改回已送出的值 → 不送
    config.stashScroll = false
    sync.update(hostConfigOf(config))
    config.stashScroll = true
    sync.update(hostConfigOf(config))
    vi.advanceTimersByTime(300)
    expect(send).toHaveBeenCalledTimes(3)
  })
})
