// 一鍵從 PobTools 送正則分享碼:renderer 確認流程(renderer/src/web/regex/incoming-share.ts)與接線。
// 流程:參數錯誤 / 解碼失敗 / 清單沒載 → 錯誤;解碼成功 → 確認;「套用」才 apply,「取消」什麼都不改;新請求取代舊請求(含解碼中途)。
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { ResolvedState, ShareState } from '@exile-appraiser/regex'
import type { RegexShareRequest } from '@ipc/types'
import { createIncomingShare, summarizeShare, type CurrentCombo, type IncomingDeps } from '../src/web/regex/incoming-share'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

const STATE: ShareState = { v: 2, game: 'poe2', mode: 'any', pages: { waystone_mods: ['a', 'b'] }, sections: {}, numeric: {}, custom: ['x'], excludes: [] }
const RESOLVED: ResolvedState = { picks: { waystone_mods: [0, 3], waystone_numeric: [], tablet_mods: [] }, values: {}, missed: 2, unknownPages: ['nope'] }
const CUR: CurrentCombo = { pages: [{ id: 'tablet_mods', n: 4 }, { id: 'relic_mods', n: 0 }], custom: 1, excludes: 2, mode: 'all' }
const req = (id: number, o: Partial<RegexShareRequest> = {}): RegexShareRequest => ({ id, source: 'pobtools', via: 'arg', code: 'abc', ...o })

function deps (o: Partial<IncomingDeps> = {}): IncomingDeps & { apply: ReturnType<typeof vi.fn> } {
  return {
    decode: async () => ({ state: STATE, warnings: [] }),
    prepare: async () => ({ pages: [], resolved: RESOLVED }),
    current: () => CUR,
    apply: vi.fn(),
    log: () => {},
    ...o
  } as IncomingDeps & { apply: ReturnType<typeof vi.fn> }
}

describe('summarizeShare', () => {
  it('會套用的清單(只列有勾選的)、會被覆蓋的目前清單、自訂 / 排除 / 模式、找不到幾項', () => {
    expect(summarizeShare(STATE, RESOLVED, CUR, 1)).toEqual({
      game: 'poe2', mode: 'any',
      incoming: [{ id: 'waystone_mods', n: 2 }],
      replaced: [{ id: 'tablet_mods', n: 4 }],
      custom: 1, excludes: 0,
      current: { custom: 1, excludes: 2, mode: 'all' },
      missed: 2, unknownPages: ['nope'], warnings: 1
    })
  })
})

describe('createIncomingShare', () => {
  it('確認後才套用;套用後對話框關閉', async () => {
    const d = deps()
    const s = createIncomingShare(d)
    await s.receive(req(1))
    expect(s.view.value?.phase).toBe('confirm')
    expect(d.apply).not.toHaveBeenCalled()
    expect(s.confirm()).toBe(true)
    expect(d.apply).toHaveBeenCalledWith(STATE)
    expect(s.view.value).toBeNull()
    expect(s.confirm()).toBe(false)
  })
  it('取消:什麼都不套用', async () => {
    const d = deps()
    const s = createIncomingShare(d)
    await s.receive(req(1))
    s.cancel()
    expect(s.view.value).toBeNull()
    expect(d.apply).not.toHaveBeenCalled()
  })
  it('參數錯誤 → 錯誤畫面,不解碼、不能套用', async () => {
    const decode = vi.fn()
    const d = deps({ decode })
    const s = createIncomingShare(d)
    await s.receive(req(1, { code: undefined, error: { reason: 'charset', detail: 'U+0020' } }))
    expect(s.view.value).toEqual({ phase: 'error', id: 1, reason: 'charset', detail: 'U+0020' })
    expect(decode).not.toHaveBeenCalled()
    expect(s.confirm()).toBe(false)
    expect(d.apply).not.toHaveBeenCalled()
  })
  it('解碼失敗 / 清單載入失敗 → 錯誤', async () => {
    const s1 = createIncomingShare(deps({ decode: async () => { throw new Error('壞碼') } }))
    await s1.receive(req(1))
    expect(s1.view.value).toMatchObject({ phase: 'error', reason: 'decode', detail: '壞碼' })
    const s2 = createIncomingShare(deps({ prepare: async () => null }))
    await s2.receive(req(2))
    expect(s2.view.value).toMatchObject({ phase: 'error', reason: 'not-loaded', detail: 'poe2' })
  })
  it('新請求取代解碼中的舊請求;取消後到的舊結果也丟掉', async () => {
    let release!: () => void
    const slow = new Promise<void>(r => { release = r })
    const d = deps({ decode: async (code) => { if (code === 'slow') await slow; return { state: { ...STATE, custom: [code] }, warnings: [] } } })
    const s = createIncomingShare(d)
    const p1 = s.receive(req(1, { code: 'slow' }))
    await s.receive(req(2, { code: 'fast' }))
    expect(s.view.value).toMatchObject({ phase: 'confirm', id: 2 })
    release(); await p1
    expect(s.view.value).toMatchObject({ phase: 'confirm', id: 2 })
    // 取消後舊的才完成 → 不再跳出
    let release2!: () => void
    const slow2 = new Promise<void>(r => { release2 = r })
    const s2 = createIncomingShare(deps({ decode: async () => { await slow2; return { state: STATE, warnings: [] } } }))
    const p = s2.receive(req(3))
    expect(s2.view.value?.phase).toBe('loading')
    s2.cancel()
    release2(); await p
    expect(s2.view.value).toBeNull()
  })
})

describe('字串與接線', () => {
  const zh = JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz.regex
  const en = JSON.parse(read('renderer/src/i18n/en.json')).ppz.regex
  const panel = read('renderer/src/web/regex/RegexPanel.vue')
  it('對話框用到的 incoming_* 鍵兩語都有、參數一致、不含 vue-i18n 特殊字元;每種錯誤原因都有字串', () => {
    const used = new Set([...panel.matchAll(/'ppz\.regex\.(incoming_\w+)'/g)].map(m => m[1]))
    expect(used.size).toBeGreaterThan(8)
    const reasons = ['missing-value', 'both-flags', 'empty', 'too-long', 'charset', 'file-read', 'file-too-large', 'decode', 'not-loaded']
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
    for (const k of [...used, ...reasons.map(r => `incoming_err_${r}`)]) {
      expect(typeof zh[k], `zh ${k}`).toBe('string')
      expect(typeof en[k], `en ${k}`).toBe('string')
      expect(params(en[k]), k).toEqual(params(zh[k]))
      expect(zh[k] + en[k], k).not.toMatch(/[|@$]/)
    }
  })
  it('RegexPanel:確認對話框 Teleport 綁 fs-own;套用 / 取消接到 incomingShare', () => {
    const i = panel.indexOf('data-regex="incoming-dialog"')
    expect(i).toBeGreaterThan(0)
    const open = panel.lastIndexOf('<div v-if="incoming"', i)
    expect(panel.slice(open, i)).toMatch(/:class="fsClass" :style="fsStyle"/)
    expect(panel).toContain('confirmIncoming () { incomingShare.confirm() }')
    expect(panel).toContain('cancelIncoming () { incomingShare.cancel() }')
  })
  it('App.vue:先掛 onRegexShare 再 regexShareTake;收到就開設定 › 正則', () => {
    const app = read('renderer/src/web/App.vue')
    const on = app.indexOf('unsubscribers.push(Host.onRegexShare(onRegexShare))')
    expect(on).toBeGreaterThan(0)
    expect(app.indexOf('Host.regexShareTake()')).toBeGreaterThan(on)
    expect(app).toMatch(/openSettingsTo\('regex', `PobTools 正則分享碼 #\$\{req\.id\}`\)/)
  })
  it('預覽分頁也拿得到(main 依來源分流);套用走與貼上分享碼相同的 applyCombo', () => {
    const ipc = read('renderer/src/web/background/IPC.ts')
    const fn = ipc.slice(ipc.indexOf('async regexShareTake'), ipc.indexOf('async regexShareTake') + 200)
    expect(fn).not.toContain('isPreview')
    const store = read('renderer/src/web/regex/store.ts')
    expect(store).toContain("applyCombo(s, 'share', gameLabel(s.game))")
  })
})
