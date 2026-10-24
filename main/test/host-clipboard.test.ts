// HostClipboard 非同步化(Electron 44 起 clipboard.readText/writeText 回 Promise)。
// 只注入假剪貼簿 io + 假計時器:不碰系統剪貼簿、不送任何輸入。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 避免載入真的 electron 套件(本機沒有 Electron 執行檔)
vi.mock('electron', () => ({ clipboard: { readText: () => '', writeText: () => {} } }))

import { HostClipboard, type ClipboardIO } from '../src/HostClipboard'

const ITEM = 'Item Class: Rings\nRarity: Rare\nDoom Loop\nCoral Ring'
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform (p: string) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

function deferred () {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

/** 假剪貼簿:readImpl 依「第幾次讀取」回內容;writeImpl 可回延遲 promise 或 reject */
function makeIo (readImpl: (n: number) => string | Promise<string>, writeImpl?: (t: string) => void | Promise<void>) {
  const writes: string[] = []
  let reads = 0
  const io: ClipboardIO = {
    readText: () => readImpl(reads++),
    writeText: (t) => { writes.push(t); return writeImpl?.(t) }
  }
  return { io, writes }
}

/** 推進假計時器,回傳 promise 的目前狀態(ok: null = 仍 pending);不 await 未完成的 promise,也不讓 reject 變成未處理 */
async function settle<T> (fn: () => Promise<T>, ms = 1000) {
  const state: { ok: boolean | null, v?: T, e?: Error } = { ok: null }
  try {
    Promise.resolve(fn()).then((v) => { state.ok = true; state.v = v }, (e: Error) => { state.ok = false; state.e = e })
  } catch (e) {
    state.ok = false
    state.e = e as Error
  }
  await vi.advanceTimersByTimeAsync(ms)
  return state
}

beforeEach(() => {
  vi.useFakeTimers()
  setPlatform('win32')
})
afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(process, 'platform', realPlatform)
})

describe('HostClipboard.restoreShortly', () => {
  it('H1 還原開啟:cb 後 120 ms 才寫回,寫回完成前不解鎖', async () => {
    const gate = deferred()
    const { io, writes } = makeIo(() => 'saved-text', () => gate.promise)
    const hc = new HostClipboard(io)
    hc.updateOptions(true)
    const cb = vi.fn()
    const p = hc.restoreShortly(cb)
    await vi.advanceTimersByTimeAsync(0)
    expect(cb).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(119)
    // 時機錯誤(提早寫回)會讓這裡有內容
    expect(writes).toEqual([])
    const skippedEarly = vi.fn()
    await hc.restoreShortly(skippedEarly)
    expect(skippedEarly).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(writes).toEqual(['saved-text'])
    // 寫回尚未完成:仍上鎖,再呼叫被略過(完成前就解鎖會讓 cb 被執行)
    const skippedWhileWriting = vi.fn()
    await hc.restoreShortly(skippedWhileWriting)
    expect(skippedWhileWriting).not.toHaveBeenCalled()
    gate.resolve()
    await p
    // 完成後可再次執行
    const again = vi.fn()
    const p2 = hc.restoreShortly(again)
    await vi.advanceTimersByTimeAsync(0)
    expect(again).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    await p2
  })

  it('H2 還原關閉:cb 之後不寫回任何東西', async () => {
    const { io, writes } = makeIo(() => 'saved-text')
    const hc = new HostClipboard(io)
    hc.updateOptions(false)
    const cb = vi.fn()
    const p = hc.restoreShortly(cb)
    await vi.advanceTimersByTimeAsync(500)
    await p
    expect(cb).toHaveBeenCalledTimes(1)
    // 誤還原會覆蓋使用者剪貼簿
    expect(writes).toEqual([])
  })
})

describe('HostClipboard 物品文字讀取', () => {
  it('H3 清空未完成時不輪詢,清空完成後才開始', async () => {
    const clear = deferred()
    const { io, writes } = makeIo(() => ITEM, (t) => (t === '' ? clear.promise : undefined))
    const hc = new HostClipboard(io)
    hc.updateOptions(false)
    const arm = hc.armItemRead()
    const poll = hc.pollItemText()
    let got: string | undefined
    let err: unknown
    poll.then((v) => { got = v }, (e: unknown) => { err = e })
    await vi.advanceTimersByTimeAsync(300)
    expect(writes).toEqual([''])
    // 清空未完成就開始輪詢,會把遊戲已複製的物品文字吃掉(此時 io 已讀得到物品文字)
    expect(got).toBeUndefined()
    expect(err).toBeUndefined()
    clear.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await arm
    await vi.advanceTimersByTimeAsync(47)
    expect(got).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(got).toBe(ITEM)
  })

  it('H4 第 2 次輪詢讀到物品文字即回傳,並寫回 before', async () => {
    const t0 = Date.now()
    const { io, writes } = makeIo(() => (Date.now() - t0 >= 96 ? ITEM : 'old'))
    const hc = new HostClipboard(io)
    hc.updateOptions(true)
    const p = hc.readItemText()
    let got: string | undefined
    let err: unknown
    p.then((v) => { got = v }, (e: unknown) => { err = e })
    await vi.advanceTimersByTimeAsync(48)
    expect(got).toBeUndefined()
    await vi.advanceTimersByTimeAsync(47)
    // 第 95 ms:只讀過非物品內容,不能提早回傳
    expect(got).toBeUndefined()
    await vi.advanceTimersByTimeAsync(5)
    expect(err).toBeUndefined()
    expect(got).toBe(ITEM)
    // 非物品文字不清空,結束時只寫回 before
    expect(writes).toEqual(['old'])
  })

  it('H5 一直讀不到物品文字:400 ms 尚未結束,600 ms 逾時 reject 並還原', async () => {
    const { io, writes } = makeIo(() => 'old')
    const hc = new HostClipboard(io)
    hc.updateOptions(true)
    const p = hc.readItemText()
    let err: unknown
    let got: string | undefined
    p.then((v) => { got = v }, (e: unknown) => { err = e })
    await vi.advanceTimersByTimeAsync(400)
    expect(err).toBeUndefined()
    expect(got).toBeUndefined()
    expect(hc.isPolling).toBe(true)
    await vi.advanceTimersByTimeAsync(200)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/timed out/)
    // 逾時沒還原會讓使用者剪貼簿停在空字串
    expect(writes).toEqual(['old'])
    expect(hc.isPolling).toBe(false)
  })

  it('H6 同一 tick 併發 readItemText 共用同一工作階段(只清空一次)', async () => {
    const { io, writes } = makeIo(() => ITEM)
    const hc = new HostClipboard(io)
    hc.updateOptions(false)
    const a = hc.readItemText()
    const b = hc.readItemText()
    const r = await settle(() => Promise.all([a, b]), 200)
    // await 縫隙造成兩份工作階段會清空兩次
    expect(writes.filter((t) => t === '')).toHaveLength(1)
    expect(r).toEqual({ ok: true, v: [ITEM, ITEM] })
  })

  it('H7 讀剪貼簿失敗後 isPolling 為 false,再呼叫可重新開始', async () => {
    const { io } = makeIo((n) => {
      if (n === 0) return Promise.reject(new Error('read failed'))
      return n === 1 ? 'old' : ITEM
    })
    const hc = new HostClipboard(io)
    hc.updateOptions(false)
    const r1 = await settle(() => hc.readItemText())
    expect(r1.ok).toBe(false)
    expect(r1.e?.message).toBe('read failed')
    // 工作階段卡住會讓之後永遠失敗或永遠 true
    expect(hc.isPolling).toBe(false)
    const r2 = await settle(() => hc.readItemText())
    expect(r2).toEqual({ ok: true, v: ITEM })
  })

  it('H8 剪貼簿原本就是物品文字:非 linux 先寫入空字串', async () => {
    const { io, writes } = makeIo(() => ITEM)
    const hc = new HostClipboard(io)
    hc.updateOptions(false)
    const r = await settle(() => hc.readItemText(), 200)
    expect(r.ok).toBe(true)
    // 沒清空會把舊物品文字誤判為新複製
    expect(writes[0]).toBe('')
  })

  it('H8b linux 清空改寫 __PPZ_FORCE_EMPTY_ 前綴字串', async () => {
    setPlatform('linux')
    const { io, writes } = makeIo(() => ITEM)
    const hc = new HostClipboard(io)
    hc.updateOptions(false)
    const r = await settle(() => hc.readItemText(), 200)
    expect(r.ok).toBe(true)
    expect(writes[0]).toMatch(/^__PPZ_FORCE_EMPTY_/)
  })
})
