// 第 33 步:正則書籤一鍵貼進遊戲(src/regex-paste.ts)。假剪貼簿 / 假送鍵 / 假焦點 / 假 sleep,**不送任何真實輸入**。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CTRL_QUIET_MS, FOCUS_TIMEOUT_MS, RegexPaster, SETTLE_MS, copiesOnBlock, regexPasteBlock, regexToastMessage, type RegexPasteEnv
} from '../src/regex-paste'
import { stashSearchSequence } from '../src/text-box'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const ok: RegexPasteEnv = { mode: 'overlay', attached: true, gameFocused: true, overlayInteractable: false, busy: false }

describe('regexPasteBlock', () => {
  it('遊戲在前景 / overlay 有焦點 → 可以貼', () => {
    expect(regexPasteBlock(ok, 'x')).toBeNull()
    expect(regexPasteBlock({ ...ok, gameFocused: false, overlayInteractable: true }, 'x')).toBeNull()
  })
  it('各原因(優先序:空字串 → 正在送 → 視窗模式 → 沒有遊戲 → 不在前景)', () => {
    expect(regexPasteBlock(ok, '  ')).toBe('empty')
    expect(regexPasteBlock({ ...ok, busy: true }, 'x')).toBe('busy')
    expect(regexPasteBlock({ ...ok, mode: 'window' }, 'x')).toBe('window-mode')
    expect(regexPasteBlock({ ...ok, attached: false }, 'x')).toBe('no-game')
    expect(regexPasteBlock({ ...ok, gameFocused: false }, 'x')).toBe('game-inactive')
    expect(regexPasteBlock({ ...ok, mode: 'window', attached: false, gameFocused: false }, '')).toBe('empty')
  })
  it('只有 empty / busy 不動剪貼簿', () => {
    expect(copiesOnBlock('empty')).toBe(false)
    expect(copiesOnBlock('busy')).toBe(false)
    for (const r of ['window-mode', 'no-game', 'game-inactive', 'focus-timeout', 'copy-failed'] as const) expect(copiesOnBlock(r)).toBe(true)
  })
})

/** 假環境:記錄所有副作用的順序;sleep 推進假時鐘並在指定時間讓遊戲取得前景 */
function setup (o: {
  env?: Partial<RegexPasteEnv>, focusAfterMs?: number | null, loseFocusAt?: number,
  /** 取代預設的 writeClipboard(預設只記錄 clip 事件);回傳 promise 可延遲 / 失敗 */
  writeClipboard?: (t: string, ev: string[]) => void | Promise<void>
} = {}) {
  const ev: string[] = []
  let clock = 0
  let focused = o.env?.gameFocused ?? true
  const env = { ...ok, ...o.env }
  let focusRequestedAt: number | null = null
  const p = new RegexPaster({
    env: () => ({ mode: env.mode, attached: env.attached, gameFocused: focused, overlayInteractable: env.overlayInteractable }),
    writeClipboard: async (t) => {
      if (o.writeClipboard) return o.writeClipboard(t, ev)
      ev.push(`clip:${t}`)
    },
    tap: (k, m) => { ev.push(`tap:${[...m, k].join('+')}`) },
    focusGame: () => { ev.push('focusGame'); focusRequestedAt = clock },
    gameFocused: () => focused,
    quietCtrl: (on) => { ev.push(`quiet:${on ? 1 : 0}`) },
    platform: 'win32',
    sleep: async (ms) => {
      clock += ms
      if (focusRequestedAt != null && o.focusAfterMs != null && clock - focusRequestedAt >= o.focusAfterMs) focused = true
      if (o.loseFocusAt != null && clock >= o.loseFocusAt) focused = false
    }
  })
  return { p, ev, focus: (v: boolean) => { focused = v }, get clock () { return clock } }
}

describe('RegexPaster', () => {
  it('遊戲在前景(書籤熱鍵):寫剪貼簿 → Ctrl+F → Ctrl+V → Enter,不搶焦點、不等待;quietCtrl 包住送鍵', async () => {
    const s = setup()
    const r = await s.p.paste('"成凋" 地圖階級')
    expect(r).toEqual({ pasted: true })
    const seq = stashSearchSequence('"成凋" 地圖階級', 'win32')
    expect(seq.keys.map(k => [...k.mods, k.key].join('+'))).toEqual(['Ctrl+F', 'Ctrl+V', 'Enter'])
    expect(s.ev.slice(0, 5)).toEqual(['quiet:1', 'clip:"成凋" 地圖階級', 'tap:Ctrl+F', 'tap:Ctrl+V', 'tap:Enter'])
    // quiet 在 sleep(CTRL_QUIET_MS) 之後才放掉(Ctrl 輪詢器 50 ms 一次,還在路上的 c1 不算);遊戲本來在前景 = 沒有其他等待
    await Promise.resolve(); await Promise.resolve()
    expect(s.ev.slice(5)).toEqual(['quiet:0'])
    expect(s.clock).toBe(CTRL_QUIET_MS)
  })
  it('overlay 有焦點(書籤列 / 快速面板):先交還焦點,等遊戲取得前景 + SETTLE_MS 才送', async () => {
    const s = setup({ env: { gameFocused: false, overlayInteractable: true }, focusAfterMs: 100 })
    const r = await s.p.paste('abc')
    expect(r).toEqual({ pasted: true })
    expect(s.ev.slice(0, 2)).toEqual(['focusGame', 'quiet:1'])
    expect(s.ev.slice(2, 6)).toEqual(['clip:abc', 'tap:Ctrl+F', 'tap:Ctrl+V', 'tap:Enter'])
    expect(s.clock).toBeGreaterThanOrEqual(100 + SETTLE_MS)
  })
  it('交還焦點後等不到遊戲 → 只複製(focus-timeout),不送任何鍵', async () => {
    const s = setup({ env: { gameFocused: false, overlayInteractable: true }, focusAfterMs: null })
    const r = await s.p.paste('abc')
    expect(r).toEqual({ pasted: false, copied: true, reason: 'focus-timeout' })
    expect(s.ev.filter(e => e.startsWith('tap:'))).toEqual([])
    expect(s.ev).toContain('clip:abc')
    expect(s.clock).toBeGreaterThanOrEqual(FOCUS_TIMEOUT_MS)
  })
  it('等待期間使用者切走 → 只複製', async () => {
    const s = setup({ env: { gameFocused: false, overlayInteractable: true }, focusAfterMs: 40, loseFocusAt: 40 + SETTLE_MS })
    const r = await s.p.paste('abc')
    expect(r).toMatchObject({ pasted: false, reason: 'focus-timeout' })
    expect(s.ev.filter(e => e.startsWith('tap:'))).toEqual([])
  })
  it('遊戲不在前景 / 視窗模式 / 沒有遊戲 → 只複製並回原因;不交還焦點、不送鍵', async () => {
    for (const [env, reason] of [
      [{ gameFocused: false }, 'game-inactive'],
      [{ mode: 'window' }, 'window-mode'],
      [{ attached: false }, 'no-game']
    ] as const) {
      const s = setup({ env })
      expect(await s.p.paste('abc')).toEqual({ pasted: false, copied: true, reason })
      expect(s.ev).toEqual(['clip:abc'])
    }
  })
  it('空字串 → 什麼都不做', async () => {
    const s = setup()
    expect(await s.p.paste(' ')).toEqual({ pasted: false, copied: false, reason: 'empty' })
    expect(s.ev).toEqual([])
  })
  it('一次一個:送鍵中(等焦點期間)再按 → busy,不動剪貼簿、不送第二組', async () => {
    const s = setup({ env: { gameFocused: false, overlayInteractable: true }, focusAfterMs: 60 })
    const first = s.p.paste('one')
    expect(s.p.isBusy).toBe(true)
    const second = await s.p.paste('two')
    expect(second).toEqual({ pasted: false, copied: false, reason: 'busy' })
    expect(await first).toEqual({ pasted: true })
    expect(s.ev.filter(e => e.startsWith('clip:'))).toEqual(['clip:one'])
    expect(s.ev.filter(e => e === 'tap:Ctrl+F')).toHaveLength(1)
    expect(s.p.isBusy).toBe(false)
  })
})

describe('RegexPaster 剪貼簿非同步寫入', () => {
  const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0) })

  it('R1 寫入未完成前不送任何鍵,完成後才送 Ctrl+F → Ctrl+V → Enter', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const s = setup({ writeClipboard: async (t, ev) => { ev.push(`clip:${t}`); await gate } })
    const pr = s.p.paste('abc')
    await flush()
    expect(s.ev).toContain('clip:abc')
    // 漏 await 會在寫入前就送 Ctrl+F / Ctrl+V,貼到舊內容
    expect(s.ev.filter(e => e.startsWith('tap:'))).toEqual([])
    release()
    expect(await pr).toEqual({ pasted: true })
    expect(s.ev.filter(e => e.startsWith('tap:'))).toEqual(['tap:Ctrl+F', 'tap:Ctrl+V', 'tap:Enter'])
  })

  it('R2 寫入失敗:回 copy-failed、不送任何鍵、busy 解除', async () => {
    const s = setup({ writeClipboard: () => Promise.reject(new Error('clipboard denied')) })
    const r = await s.p.paste('abc')
    // 失敗卻回報 pasted、或 busy 不解除,都會讓之後的書籤全部失效
    expect(r).toEqual({ pasted: false, copied: false, reason: 'copy-failed' })
    expect(s.ev.filter(e => e.startsWith('tap:'))).toEqual([])
    expect(s.p.isBusy).toBe(false)
  })

  it('R3 寫入期間遊戲失焦:不送鍵,只複製(focus-timeout)', async () => {
    const s = setup({
      writeClipboard: async (t, ev) => { ev.push(`clip:${t}`); s.focus(false) }
    })
    const r = await s.p.paste('abc')
    // 寫入後沒再檢查前景,按鍵會送進別的視窗
    expect(r).toEqual({ pasted: false, copied: true, reason: 'focus-timeout' })
    expect(s.ev.filter(e => e.startsWith('tap:'))).toEqual([])
    expect(s.ev).toContain('clip:abc')
  })
})

describe('regexToastMessage', () => {
  it('兩語:第一行書籤名、第二行原因', () => {
    expect(regexToastMessage('cmn-Hant', '地圖', 'game-inactive')).toEqual({ lang: 'cmn-Hant', kind: 'scan', title: '正則書籤「地圖」', hint: '遊戲不在前景,已複製' })
    expect(regexToastMessage('en', 'Maps', 'missing').title).toBe('Regex bookmark "Maps"')
    for (const lang of ['cmn-Hant', 'en'] as const) {
      for (const r of ['window-mode', 'no-game', 'game-inactive', 'focus-timeout', 'busy', 'empty', 'missing', 'copy-failed'] as const) {
        expect(String(regexToastMessage(lang, 'x', r).hint ?? '').length).toBeGreaterThan(3)
      }
    }
  })
})

describe('接線守門(main.ts / preload / Shortcuts)', () => {
  const main = read('../src/main.ts')
  it("'regex-paste' 在登錄表、preview: false;熱鍵沒貼成才提示", () => {
    const i = main.indexOf("'regex-paste': {")
    expect(i).toBeGreaterThan(0)
    const block = main.slice(i, i + 900)
    expect(block).toContain('preview: false')
    expect(block).toContain("req.source === 'hotkey' && !res.pasted")
    expect(main).toContain("send('regex-quick-open')")
    expect(main).toContain("send('regex-bookmark-run', e)")
    // 快速面板:先讓 overlay 取得焦點(閒置隱藏的視窗在 focus() 前顯示)再開面板
    const q = main.indexOf('onRegexQuick: () => {')
    expect(main.indexOf('overlay?.assertOverlayActive()', q)).toBeLessThan(main.indexOf("send('regex-quick-open')", q))
    expect(main).toContain('quietCtrl: (on) => { stashScroll?.quietCtrl(on) }')
  })
  it('preload 對應;預覽 boot script 沒有這三個方法', () => {
    const preload = read('../src/preload.ts')
    expect(preload).toContain("regexPaste: (req: RegexPasteRequest) => ipcRenderer.invoke('regex-paste', req)")
    expect(preload).toContain("subscribe('regex-quick-open'")
    expect(preload).toContain("subscribe('regex-bookmark-run', cb)")
    const preview = read('../src/preview-server.ts')
    expect(preview).not.toMatch(/regexPaste|onRegexQuickOpen|onRegexBookmarkRun/)
  })
  it('Shortcuts:兩個動作先放開熱鍵按鍵(走一般釋放路徑)再呼叫回呼', () => {
    const src = read('../src/Shortcuts.ts')
    const release = src.indexOf("entry.shortcut.split(' + ').reverse().forEach")
    expect(release).toBeGreaterThan(0)
    expect(src.indexOf("action.type === 'regex-quick'")).toBeGreaterThan(release)
    expect(src.indexOf("action.type === 'regex-bookmark'")).toBeGreaterThan(release)
  })
})
