// PoE1 倉庫價格熱鍵:功能關著時按熱鍵 = 啟動(main 送 stash-enable,renderer 寫設定);熱鍵總表 / 衝突檢查不再以開關為條件。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { hotkeySlots } from '../src/web/settings/hotkey-conflicts'
import { hotkeyTable } from '../src/web/settings/hotkey-table'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('倉庫價格熱鍵不看功能開關', () => {
  it('倉庫價格關著時衝突檢查仍含 stashToggle 槽', () => {
    const c = { hotkey: 'F1', hotkeyHold: 'Ctrl', hotkeyLocked: 'F2', overlayKey: 'F3', game: 'poe1', hotkeyOcrReveal: '', hotkeyOcrRegion: '', hotkeyRuneshapeToggle: '', hotkeyStashToggle: 'F6', stashPricesEnabled: false, commands: [], stashSearch: [] }
    expect(hotkeySlots(c as never).some(x => x.id === 'stashToggle' && x.hotkey === 'F6')).toBe(true)
  })
  it('總表的倉庫價格熱鍵列不帶 needs、說明寫「啟動 / 暫停」', () => {
    const rows = hotkeyTable({ game: 'poe1', stashPricesEnabled: false, commands: [], stashSearch: [], regexBookmarkHotkeys: [] } as never, { overlay: true }).find(g => g.id === 'scan')!.rows
    const r = rows.find(x => x.id === 'stashToggle')!
    expect(r.kind === 'edit' && r.needs).toBeFalsy()
    expect(JSON.parse(read('../src/i18n/cmn-Hant.json')).ppz.scan.slot_stash_pause).toContain('啟動')
    expect(JSON.parse(read('../src/i18n/en.json')).ppz.scan.slot_stash_pause).toMatch(/start/i)
  })
})

describe('stash-enable 事件接線', () => {
  it('Config 收到事件把 stashPricesEnabled 設成 true', () => {
    const cfg = read('../src/web/Config.ts')
    const i = cfg.indexOf('Host.onStashEnable(')
    expect(i).toBeGreaterThan(0)
    expect(cfg.slice(i, cfg.indexOf('})', i))).toContain('config.stashPricesEnabled = true')
  })
  it('IPC 轉接(預覽 shim 沒有 → no-op)與型別', () => {
    expect(read('../src/web/background/IPC.ts')).toContain('window.host?.onStashEnable?.(cb) ?? (() => {})')
    expect(read('../../ipc/types.ts')).toContain('onStashEnable?:')
  })
})
