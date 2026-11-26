/**
 * 3.30 倉庫價格疊層:格子擬合判出「綢帶」子頁 → `stash-scan-result` 的 show 帶 subtab 'threads' 與綢帶格子的 grid。
 * 只依規格寫;假時鐘 / 假擷取 / 假 fit·verify(target 控制畫面上是哪個子頁),不碰 Electron。
 */
import { describe, expect, it } from 'vitest'
import type { StashScanEvent } from '@ipc/types'
import type { Fingerprint, ScanCapture, ScanClock, ScanEnv } from '../src/ocr/panel-scan'
import { StashScan, type StashScanConfig } from '../src/ocr/stash-scan'
import { formulaGrid } from '../../core/src/stash/fit'
import { LAYOUTS_330 as LAYOUTS, createFitFakes } from './stash-fit-fakes'

const H = 1432
const W = 2546

function fakeClock () {
  let t = 0
  const clock: ScanClock = {
    now: () => t,
    setTimeout: () => 1,
    clearTimeout: () => {}
  }
  return clock
}

const fp = (v: number): Fingerprint => ({ w: 64, h: 12, data: new Uint8Array(64 * 12).fill(v) })

const G_GENERAL = formulaGrid(LAYOUTS, 'general', W, H)
const G_THREADS = formulaGrid(LAYOUTS, 'threads', W, H)

function harness () {
  const cfg: StashScanConfig = { enabled: true, game: 'poe1', intervalMs: 500 }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 100, y: 50, width: W, height: H } }
  const state = { frame: fp(10) }
  const fits = createFitFakes(LAYOUTS)
  const events: StashScanEvent[] = []
  const scan = new StashScan({
    clock: fakeClock(),
    config: () => cfg,
    env: () => env,
    capture: async (): Promise<ScanCapture> => ({
      size: { w: W, h: H },
      offset: { x: 0, y: 0 },
      client: { w: W, h: H },
      fingerprint: () => state.frame,
      recognize: async () => { throw new Error('倉庫偵測不該呼叫 OCR') },
      gray: fits.gray
    }),
    send: (e) => { events.push(e) },
    fit: fits.fit,
    verify: fits.verify,
    qty: { layouts: () => LAYOUTS, templates: () => null }
  })
  let v = 10
  const changeFrame = () => { v = (v + 37) % 250; state.frame = fp(v) }
  return { scan, events, fits, changeFrame }
}

describe('T9 掃描判出綢帶頁後送綢帶格子', () => {
  it('擬合成綢帶 → show 的 subtab 為 threads、grid 為綢帶格子位置', async () => {
    const h = harness()
    h.fits.show('threads', W, H)
    const r = await h.scan.tick()
    // 一律當一般頁 → 綢帶頁被當成沒有版面(不畫)或誤當一般
    expect(r).toMatchObject({ kind: 'fit', found: true, subtab: 'threads', sent: 'show' })
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ reason: 'show', subtab: 'threads', grid: G_THREADS, client: { w: W, h: H } })
    expect(h.scan.showing).toBe(true)
  })
  it('一般 → 綢帶 → 一般 各送一次 show,對不上(異能)連 2 次送 hide', async () => {
    const h = harness()
    h.fits.show('general', W, H)
    expect(await h.scan.tick()).toMatchObject({ subtab: 'general', sent: 'show' })

    h.fits.show('threads', W, H)
    h.changeFrame()
    // 同一次顯示中換子頁沒重送 → renderer 仍畫一般頁的格子
    expect(await h.scan.tick()).toMatchObject({ subtab: 'threads', sent: 'show' })
    expect(h.events.map(e => [e.reason, e.subtab])).toEqual([['show', 'general'], ['show', 'threads']])
    expect(h.events[1].grid).toEqual(G_THREADS)

    h.changeFrame()
    // 同子頁不重送
    expect(await h.scan.tick()).toMatchObject({ subtab: 'threads', sent: null })
    expect(h.events).toHaveLength(2)

    h.fits.show('general', W, H)
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ subtab: 'general', sent: 'show' })
    expect(h.events.at(-1)).toMatchObject({ reason: 'show', subtab: 'general', grid: G_GENERAL })

    h.fits.none()
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: false, sent: null })
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: false, sent: 'hide' })
    expect(h.events.at(-1)).toMatchObject({ reason: 'hide', subtab: null })
  })
  it('換子頁時快取位置驗證不過(驗證只看目前顯示的子頁)→ 重新擬合', async () => {
    const h = harness()
    h.fits.show('general', W, H)
    await h.scan.tick()
    h.fits.show('threads', W, H)
    h.changeFrame()
    await h.scan.tick()
    // 驗證用了新子頁 / 沒重擬合 → 疊層停在一般頁
    expect(h.fits.s.verifies).toBe(1)
    expect(h.fits.s.fits).toBe(2)
  })
})
