// 第 29 步:scripts/perf-scenario.mjs 的純函式(參數解析、行程樹、CPU / GPU 換算、PresentMon CSV、Markdown 表格)。
// 不執行量測(那要 PowerShell + 使用者手動擺情境)。
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error 腳本是 .mjs(無型別宣告)
import * as S from '../../scripts/perf-scenario.mjs'

const proc = (pid: number, ppid: number, name: string, cpu = 0, ws = 0, created = 1) => ({ pid, ppid, name, cpu, ws, created })

describe('parseArgs', () => {
  const now = new Date(2026, 9, 3, 13, 5, 9)
  it('預設值與輸出檔名', () => {
    const o = S.parseArgs([], now)
    expect(o).toMatchObject({ seconds: 60, delay: 5, app: 'ExileAppraiser', game: null, hwaccel: null, only: null })
    expect(o.out).toBe(path.join('docs', 'perf', 'run-20261003-130509.md'))
  })
  it('各參數', () => {
    const o = S.parseArgs(['--seconds', '30', '--delay', '0', '--app', 'electron', '--game', 'PathOfExile', '--hwaccel', 'ON',
      '--label', 'v0.1.2', '--only', 'no-app,panel', '--out', 'x.md'], now)
    expect(o).toMatchObject({ seconds: 30, delay: 0, app: 'electron', game: 'PathOfExile', hwaccel: 'on', label: 'v0.1.2', only: ['no-app', 'panel'], out: 'x.md' })
  })
  it('錯誤', () => {
    expect(() => S.parseArgs(['--hwaccel', 'maybe'])).toThrow(/on 或 off/)
    expect(() => S.parseArgs(['--only', 'nope'])).toThrow(/未知的情境/)
    expect(() => S.parseArgs(['--seconds'])).toThrow(/需要一個值/)
    expect(() => S.parseArgs(['--seconds', '0'])).toThrow(/正數/)
    expect(() => S.parseArgs(['--what'])).toThrow(/未知的參數/)
  })
  it('情境清單:id 唯一、有基準、與 main 情境鍵對應的那幾個在', () => {
    const ids = S.SCENARIOS.map((s: { id: string }) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['no-app', 'no-game', 'game-bg', 'fg-idle', 'panel', 'ocr-reveal', 'ocr-rune', 'bg-on', 'settings', 'window'])
    expect(S.SCENARIOS.filter((s: { baseline?: boolean }) => s.baseline)).toHaveLength(1)
  })
  it('sampleCount 至少 8', () => {
    expect(S.sampleCount(3)).toBe(8)
    expect(S.sampleCount(60)).toBe(60)
  })
})

describe('行程樹 / CPU', () => {
  const start = [
    proc(4, 0, 'System'),
    proc(100, 4, 'ExileAppraiser.exe', 10, 100 * 1048576),
    proc(101, 100, 'ExileAppraiser.exe', 5, 50 * 1048576),
    proc(102, 100, 'powershell.exe', 1, 20 * 1048576),
    proc(103, 102, 'conhost.exe', 0, 1048576),
    proc(200, 4, 'PathOfExile.exe', 100, 2000 * 1048576),
    proc(300, 4, 'exileappraiser-helper.exe', 1, 1)
  ]
  it('processTree:主行程與所有子孫(不分大小寫、.exe 可省略)', () => {
    expect([...S.processTree(start, 'ExileAppraiser')].sort()).toEqual([100, 101, 102, 103])
    expect([...S.processTree(start, 'exileappraiser.exe')].sort()).toEqual([100, 101, 102, 103])
    expect(S.processTree(start, 'nope').size).toBe(0)
    expect([...S.processesNamed(start, 'PathOfExile')]).toEqual([200])
  })
  it('cpuOf:工作管理員基準、新出現的整段算、結束的計數、pid 重用當新行程', () => {
    const end = [
      proc(100, 4, 'ExileAppraiser.exe', 13.2, 110 * 1048576), // +3.2 s
      proc(101, 100, 'ExileAppraiser.exe', 5.8, 50 * 1048576), // +0.8 s
      // 102 / 103 結束了
      proc(104, 100, 'powershell.exe', 2, 30 * 1048576, 999), // 量測期間啟動:整段 2 s
      proc(200, 4, 'PathOfExile.exe', 140, 2000 * 1048576)
    ]
    const a = S.cpuOf(start, end, S.processTree(start, 'ExileAppraiser'), S.processTree(end, 'ExileAppraiser'), 10, 4)
    expect(a.cpuPct).toBe(15) // 6 s / (10 s × 4) = 15 %
    expect(a.wsMB).toBe(190)
    expect(a.count).toBe(3)
    expect(a.exited).toBe(2)
    expect(a.procs[0]).toMatchObject({ pid: 100, cpuPct: 8 })
    const reused = S.cpuOf(start, [proc(101, 100, 'ExileAppraiser.exe', 0.5, 0, 77)], new Set([101]), new Set([101]), 10, 1)
    expect(reused.cpuPct).toBe(5) // created 不同 → 整段 0.5 s
  })
})

describe('gpuOf', () => {
  it('每秒樣本平均:本程式 / 遊戲 = 全部引擎,系統 = 3D 引擎;系統 CPU 平均', () => {
    const samples = [
      { cpu: 20, gpu: { 100: [1, 0.5], 101: [0.2, 0.2], 200: [80, 70], 999: [5, 5] } },
      { cpu: 30, gpu: { 100: [3, 2.5], 200: [90, 85] } }
    ]
    const g = S.gpuOf(samples, new Set([100, 101]), new Set([200]))
    expect(g).toEqual({ n: 2, appGpu: 2.1, gameGpu: 85, sys3d: 81.6, sysCpu: 25 })
    expect(S.gpuOf(samples, new Set([100]), null).gameGpu).toBeNull()
    expect(S.gpuOf([], new Set(), null)).toEqual({ n: 0, appGpu: null, gameGpu: null, sys3d: null, sysCpu: null })
    expect(S.gpuOf([{ cpu: null, gpu: {} }], new Set(), null).sysCpu).toBeNull()
  })
})

describe('PresentMon', () => {
  it('parsePresentMonCsv:MsBetweenPresents / FrameTime;平均與 1% low', () => {
    const rows = Array.from({ length: 99 }, () => '10').concat(['50'])
    const csv = ['Application,ProcessID,MsBetweenPresents', ...rows.map(r => `PathOfExile.exe,200,${r}`)].join('\r\n')
    expect(S.parsePresentMonCsv(csv)).toEqual({ frames: 100, fpsAvg: 96.2, fps1Low: 20 })
    const v2 = 'Application,FrameTime\nx,16.6667\nx,16.6667\n'
    expect(S.parsePresentMonCsv(v2)).toMatchObject({ frames: 2, fpsAvg: 60, fps1Low: 60 })
    expect(S.parsePresentMonCsv('a,b\n1,2')).toBeNull()
    expect(S.parsePresentMonCsv('')).toBeNull()
  })
  it('findPresentMon:PATH 上的 PresentMon.exe 或 PresentMon-*.exe', () => {
    const p = ['C:\\a', 'C:\\b'].join(path.delimiter)
    expect(S.findPresentMon(p, () => false, () => [])).toBeNull()
    expect(S.findPresentMon(p, (f: string) => f === path.join('C:\\b', 'PresentMon.exe'), () => [])).toBe(path.join('C:\\b', 'PresentMon.exe'))
    expect(S.findPresentMon(p, () => false, (d: string) => d === 'C:\\a' ? ['PresentMon-2.3.0-x64.exe'] : [])).toBe(path.join('C:\\a', 'PresentMon-2.3.0-x64.exe'))
  })
})

describe('buildMarkdown', () => {
  const meta = { when: '2026-10-03 13:00', label: 'v0.1.2', hwaccel: 'off', seconds: 60, cores: 16, app: 'ExileAppraiser', game: 'PathOfExile', presentMon: null, host: 'h', os: 'Windows' }
  const r = (id: string, title: string, o: Record<string, unknown> = {}) => ({
    id, title, baseline: id === 'no-app', wallSec: 60, cores: 16,
    app: { cpuPct: 1.5, wsMB: 300, count: 5, exited: 0, procs: [{ pid: 1, name: 'ExileAppraiser.exe', cpuPct: 1, wsMB: 100 }] },
    game: { cpuPct: 10 }, gpu: { n: 60, appGpu: 0.4, gameGpu: 90, sys3d: 95, sysCpu: 20 }, fps: null, fpsError: null, ...o
  })
  it('情境表 + 與基準差值 + 無 FPS 註明 + 警告', () => {
    const md = S.buildMarkdown(meta, [
      r('no-app', '無程式基準', { app: { cpuPct: 0, wsMB: 0, count: 0, exited: 0, procs: [] }, gpu: { n: 60, appGpu: 0, gameGpu: 88, sys3d: 92, sysCpu: 18 } }),
      r('panel', '查價面板開'),
      { id: 'window', title: 'window 模式', baseline: false, skipped: true },
      r('fg-idle', '前景無面板', { gpu: { n: 5, appGpu: 0, gameGpu: 87.5, sys3d: 91.5, sysCpu: 18 } })
    ])
    expect(md).toContain('**無 FPS**(本機 PATH 沒有 PresentMon)')
    expect(md).toContain('| 查價面板開(`panel`) | off | 60 | 1.5 | 0.4 | 300 | 5 | 20 | 95 | 10 | 90 | 無 FPS | — |')
    expect(md).toContain('| window 模式(`window`) | off | 略過 |')
    expect(md).toContain('| 查價面板開(`panel`) | +2 | +3 | 0 | +2 | — | — |')
    expect(md).toContain('| 前景無面板(`fg-idle`) | 0 | -0.5 | 0 | -0.5 | — | — |')
    expect(md).toContain('GPU 樣本只有 5 個(< 8)')
    expect(md).toContain('ExileAppraiser.exe#1 1% / 100 MB')
    // 每個表格列欄數一致
    for (const line of md.split('\n').filter((l: string) => l.startsWith('| ') && l.includes('`'))) {
      const n = line.split('|').length
      expect([15, 9]).toContain(n)
    }
  })
  it('沒有基準 → 註明不算差值', () => {
    const md = S.buildMarkdown({ ...meta, hwaccel: null }, [r('panel', '查價面板開')])
    expect(md).toContain('沒有量「無程式基準」')
    expect(md).toContain('硬體加速:(未標記)')
  })
  it('stamp', () => {
    expect(S.stamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405')
  })
  it('measureScript:只讀(沒有 SendKeys / Stop-Process / Start-Process 等),樣本數帶進去', () => {
    const s = S.measureScript(12)
    expect(s).toContain('-MaxSamples 12')
    expect(s).toContain('Processor Information(_Total)')
    expect(s).not.toMatch(/SendKeys|SendInput|Stop-Process|Start-Process|keybd_event|mouse_event/i)
  })
})
