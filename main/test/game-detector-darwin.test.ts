// GameDetector 的 macOS 視窗列舉:darwin 用 osascript 取標題, (真機行為與權限要在 Mac 上手動測)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getSources: vi.fn(),
  execFile: vi.fn()
}))
vi.mock('electron', () => ({ desktopCapturer: { getSources: h.getSources } }))
vi.mock('node:child_process', () => ({ execFile: h.execFile }))

import { listWindowNamesDefault } from '../src/windowing/GameDetector'

type Cb = (err: Error | null, stdout: string) => void
function osascriptReturns (err: Error | null, stdout = '') {
  h.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Cb) => { cb(err, stdout) })
}

const realPlatform = process.platform
function setPlatform (p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

beforeEach(() => {
  h.getSources.mockReset().mockResolvedValue([{ name: 'from-capturer' }])
  h.execFile.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  setPlatform(realPlatform)
  vi.restoreAllMocks()
})

describe('listWindowNamesDefault(darwin)', () => {
  it('用 osascript JXA 取標題,不呼叫 desktopCapturer', async () => {
    setPlatform('darwin')
    osascriptReturns(null, '["Path of Exile 2","Finder"]\n')
    await expect(listWindowNamesDefault()).resolves.toEqual(['Path of Exile 2', 'Finder'])
    expect(h.execFile).toHaveBeenCalledTimes(1)
    const [cmd, args] = h.execFile.mock.calls[0] as [string, string[]]
    expect(cmd).toBe('osascript')
    expect(args.slice(0, 2)).toEqual(['-l', 'JavaScript'])
    expect(h.getSources).not.toHaveBeenCalled()
  })

  it('osascript 失敗(沒權限等)→ 退回 desktopCapturer', async () => {
    setPlatform('darwin')
    osascriptReturns(new Error('Not authorized to send Apple events to System Events'))
    await expect(listWindowNamesDefault()).resolves.toEqual(['from-capturer'])
    expect(h.getSources).toHaveBeenCalledTimes(1)
  })

  it('輸出不是 JSON → 退回 desktopCapturer', async () => {
    setPlatform('darwin')
    osascriptReturns(null, 'garbage')
    await expect(listWindowNamesDefault()).resolves.toEqual(['from-capturer'])
    expect(h.getSources).toHaveBeenCalledTimes(1)
  })
})

describe('listWindowNamesDefault(非 darwin)', () => {
  it.each(['win32', 'linux'] as const)('%s 只用 desktopCapturer,不 spawn osascript', async (p) => {
    setPlatform(p)
    await expect(listWindowNamesDefault()).resolves.toEqual(['from-capturer'])
    expect(h.execFile).not.toHaveBeenCalled()
  })
})
