import { describe, expect, it, vi } from 'vitest'
import { createFontLister, FONT_NEGATIVE_CACHE_MS, LIST_FONTS_SCRIPT, parseFontList } from '../src/system-fonts'

const enc = (names: string[]) => Buffer.from(names.join('\n'), 'utf8').toString('base64')

describe('parseFontList(list-fonts 輸出解析)', () => {
  it('base64 UTF-8:中文字體名、去重(不分大小寫)、去空白、排序', () => {
    const out = parseFontList(`${enc(['微軟正黑體', 'Arial', ' Segoe UI ', 'arial', '', 'Noto Sans TC', '微軟正黑體'])}\r\n`)
    expect(out).toEqual(['Arial', 'Noto Sans TC', 'Segoe UI', '微軟正黑體'])
  })
  it('CRLF 分行也可', () => {
    expect(parseFontList(Buffer.from('A\r\nB', 'utf8').toString('base64'))).toEqual(['A', 'B'])
  })
  it('空輸出 / 非 base64(PowerShell 錯誤訊息)→ 空陣列', () => {
    expect(parseFontList('')).toEqual([])
    expect(parseFontList('   \r\n')).toEqual([])
    expect(parseFontList('Add-Type : 無法載入')).toEqual([])
  })
  it('含引號 / 反斜線 / 控制字元 / 亂碼的名稱略過', () => {
    expect(parseFontList(enc(['Ok', 'Bad"Name', 'Bad\\Name', 'Bad\tName', 'Bad�Name']))).toEqual(['Ok'])
  })
  it('腳本把輸出轉成 base64(避免 PowerShell 5.1 碼頁把中文變問號)', () => {
    expect(LIST_FONTS_SCRIPT).toContain('InstalledFontCollection')
    expect(LIST_FONTS_SCRIPT).toContain('ToBase64String')
    expect(LIST_FONTS_SCRIPT).toContain('UTF8')
  })
})

describe('createFontLister', () => {
  it('成功後快取:只跑一次行程;同時呼叫共用一個行程', async () => {
    const run = vi.fn(async () => enc(['B', 'A']))
    const l = createFontLister({ run, platform: 'win32', log: () => {} })
    const [a, b] = await Promise.all([l.list(), l.list()])
    expect(a).toEqual(['A', 'B'])
    expect(b).toEqual(['A', 'B'])
    expect(await l.list()).toEqual(['A', 'B'])
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('失敗 → 空陣列、5 分鐘負快取(期間不跑行程),期滿再試', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('spawn ENOENT'))
      .mockResolvedValueOnce(enc(['Arial']))
    const logs: string[] = []
    const clock = { t: 1_000_000 }
    const l = createFontLister({ run, platform: 'win32', log: m => logs.push(m), now: () => clock.t })
    expect(await l.list()).toEqual([])
    expect(logs[0]).toContain('列字體失敗')
    clock.t += FONT_NEGATIVE_CACHE_MS - 1
    expect(await l.list()).toEqual([])
    expect(run).toHaveBeenCalledTimes(1)
    clock.t += 1
    expect(await l.list()).toEqual(['Arial'])
    expect(run).toHaveBeenCalledTimes(2)
    // 成功後正快取
    clock.t += FONT_NEGATIVE_CACHE_MS * 10
    expect(await l.list()).toEqual(['Arial'])
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('空輸出 → 空陣列、同樣負快取 5 分鐘', async () => {
    const run = vi.fn(async () => '')
    const clock = { t: 0 }
    const l = createFontLister({ run, platform: 'win32', log: () => {}, now: () => clock.t })
    expect(await l.list()).toEqual([])
    expect(await l.list()).toEqual([])
    expect(run).toHaveBeenCalledTimes(1)
    clock.t += FONT_NEGATIVE_CACHE_MS
    expect(await l.list()).toEqual([])
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('非 Windows → 空陣列、不跑行程', async () => {
    const run = vi.fn(async () => enc(['Arial']))
    expect(await createFontLister({ run, platform: 'linux', log: () => {} }).list()).toEqual([])
    expect(run).not.toHaveBeenCalled()
  })
})
