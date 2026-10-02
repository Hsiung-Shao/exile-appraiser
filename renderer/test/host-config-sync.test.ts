// host-config 送出節流:相同內容不送、一般欄位 300 ms trailing debounce、第一次 / game / overlayMode 立刻送、flush。
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { afterHostConfigApplied, createHostConfigSync } from '../src/web/host-config-sync'
import { HOST_CONFIG_IMMEDIATE_KEYS, hostConfigOf, _roundTripForTest } from '../src/web/Config'
import type { HostConfigForMain } from '@ipc/types'

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

describe('settled():設定頁狀態列等設定送到 main 才讀(code review 第 C 批)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('沒有等待中 / 送出中 → 立刻 resolve;去抖中 → 等到送出且 send 的 promise 結束', async () => {
    let reply!: () => void
    const send = vi.fn((_: Cfg) => new Promise<void>(res => { reply = res }))
    const sync = createHostConfigSync<Cfg>({ send, immediateKeys: ['game'] })
    let done = false
    void sync.settled().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
    sync.update(base) // 第一次立刻送,main 還沒回
    done = false
    void sync.settled().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    reply()
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
    sync.update({ ...base, text: 'x' }) // 去抖中
    done = false
    void sync.settled().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(299)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(2)
    expect(done).toBe(false) // 送出了但 main 還沒回
    reply()
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })

  it('送出失敗也算結束;改回已送出的內容(取消等待中)也算結束', async () => {
    const send = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'))
    const sync = createHostConfigSync<Cfg>({ send, immediateKeys: ['game'] })
    sync.update(base)
    await vi.advanceTimersByTimeAsync(0)
    sync.update({ ...base, game: 'poe1' }) // 立刻送、失敗
    let done = false
    void sync.settled().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
    sync.update({ ...base, text: 'y' })
    sync.update({ ...base }) // ≠ lastSent(失敗後清掉)→ 仍排程;再改回同一份等待中 → 不重排
    done = false
    void sync.settled().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(300)
    expect(done).toBe(true)
  })
})

describe('HOST_CONFIG_IMMEDIATE_KEYS:掃描開關 / 區域 / 間隔不去抖(狀態列一定讀到新狀態)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('涵蓋 main scanConfigKey 的全部欄位 + game / overlayMode', () => {
    expect([...HOST_CONFIG_IMMEDIATE_KEYS].sort()).toEqual([
      'game', 'ocrLang', 'ocrRegion', 'overlayMode', 'revealAutoEnabled', 'revealIntervalMs', 'runeshapeEnabled', 'runeshapeIntervalMs', 'runeshapeRegion'
    ])
    const main = fs.readFileSync(new URL('../../main/src/scan-config.ts', import.meta.url), 'utf8')
    const body = main.slice(main.indexOf('function scanConfigKey'))
    for (const k of ['revealAutoEnabled', 'revealIntervalMs', 'ocrRegion', 'runeshapeEnabled', 'runeshapeRegion', 'runeshapeIntervalMs']) {
      expect(body).toContain('cfg.' + k)
    }
  })

  /** 模擬:main 收到設定就記下(= 掃描器換模式);狀態列在 afterHostConfigApplied 之後讀 main 目前的區域 */
  function scenario (immediateKeys: Array<keyof HostConfigForMain>) {
    const { config } = _roundTripForTest('{"game":"poe2"}')
    let mainRegion: unknown = 'unset'
    const send = vi.fn(async (c: HostConfigForMain) => { await Promise.resolve(); mainRegion = c.runeshapeRegion })
    const sync = createHostConfigSync<HostConfigForMain>({ send, immediateKeys })
    sync.update(hostConfigOf(config)) // 啟動
    return { config, sync, send, statusSaw: [] as unknown[], main: () => mainRegion }
  }
  for (const [name, keys, expectNew] of [
    ['改前(只有 game / overlayMode 不去抖):300 ms 內又改別的欄位 → 狀態列讀到舊區域', ['game', 'overlayMode'], false],
    ['改後(HOST_CONFIG_IMMEDIATE_KEYS)+ settled:狀態列讀到新區域', [...HOST_CONFIG_IMMEDIATE_KEYS], true]
  ] as const) {
    it(name, async () => {
      const t = scenario([...keys])
      await vi.advanceTimersByTimeAsync(0)
      const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
      t.config.runeshapeRegion = region
      t.sync.update(hostConfigOf(t.config))
      // 狀態列(OcrScanSection watch):改前 = 固定 300 ms 後讀;改後 = 等 settled 再 300 ms
      if (expectNew) void afterHostConfigApplied(() => t.sync.settled(), () => { t.statusSaw.push(t.main()) })
      else setTimeout(() => { t.statusSaw.push(t.main()) }, 300)
      await vi.advanceTimersByTimeAsync(200)
      t.config.startupToast = !t.config.startupToast // 300 ms 內又改了別的(一般)欄位 → 去抖重新計時
      t.sync.update(hostConfigOf(t.config))
      await vi.advanceTimersByTimeAsync(1000)
      expect(t.statusSaw).toHaveLength(1)
      if (expectNew) expect(t.statusSaw[0]).toEqual(region)
      else expect(t.statusSaw[0]).not.toEqual(region)
    })
  }
})
