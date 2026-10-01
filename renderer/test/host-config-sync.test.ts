// host-config 送出節流:相同內容不送、一般欄位 300 ms trailing debounce、第一次 / game / overlayMode 立刻送、flush。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHostConfigSync } from '../src/web/host-config-sync'

type Cfg = { game: string, overlayMode: boolean, text: string }
const base: Cfg = { game: 'poe2', overlayMode: true, text: '' }

describe('createHostConfigSync', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const make = () => {
    const send = vi.fn()
    const sync = createHostConfigSync<Cfg>({ send, immediateKeys: ['game', 'overlayMode'] })
    return { send, sync }
  }

  it('第一次(啟動)立刻送', () => {
    const { send, sync } = make()
    sync.update(base)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('連續打字只在停手 300 ms 後送最後一份', () => {
    const { send, sync } = make()
    sync.update(base)
    for (const t of ['a', 'ab', 'abc']) { sync.update({ ...base, text: t }); vi.advanceTimersByTime(100) }
    expect(send).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(199) // 最後一次輸入後 199 ms
    expect(send).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0].text).toBe('abc')
  })
  it('內容與上次送出的相同 → 不送(含改回原值)', () => {
    const { send, sync } = make()
    sync.update(base)
    sync.update({ ...base })
    vi.advanceTimersByTime(1000)
    expect(send).toHaveBeenCalledTimes(1)
    sync.update({ ...base, text: 'x' })
    sync.update(base) // 改回去 → 取消等待中的
    vi.advanceTimersByTime(1000)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('game / overlayMode 變了立刻送(main 會據此重新啟動),並取消等待中的', () => {
    const { send, sync } = make()
    sync.update(base)
    sync.update({ ...base, text: 'x' })
    sync.update({ ...base, text: 'x', game: 'poe1' })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0]).toMatchObject({ game: 'poe1', text: 'x' })
    vi.advanceTimersByTime(1000)
    expect(send).toHaveBeenCalledTimes(2)
    sync.update({ ...base, game: 'poe1', overlayMode: false })
    expect(send).toHaveBeenCalledTimes(3)
  })
  it('flush 把等待中的立刻送出;沒有等待中就不動作', () => {
    const { send, sync } = make()
    sync.update(base)
    sync.flush()
    expect(send).toHaveBeenCalledTimes(1)
    sync.update({ ...base, text: 'x' })
    sync.flush()
    expect(send).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1000)
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('送失敗後,同內容再來仍會重送', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('x'))
    const sync = createHostConfigSync<Cfg>({ send, immediateKeys: ['game'] })
    sync.update(base)
    await vi.advanceTimersByTimeAsync(0)
    sync.update(base)
    vi.advanceTimersByTime(300)
    expect(send).toHaveBeenCalledTimes(2)
  })
})
