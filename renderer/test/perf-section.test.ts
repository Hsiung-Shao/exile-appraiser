// 第 29 步:設定 › 記錄 › 效能(PerfSection.vue):字串兩語都有且 {sec} 參數一致、記錄分頁接線、只給 Electron 視窗、
// 開關不進 config.json / host-config(關著時與改版前行為相同)。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

const KEYS = ['title', 'enable', 'hint', 'by_arg', 'last', 'none', 'off', 'open_file', 'open_failed', 'set_failed']

describe('效能區字串', () => {
  it('中英文 ppz.perf.* 都有,參數相同', () => {
    const zh = JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz.perf
    const en = JSON.parse(read('renderer/src/i18n/en.json')).ppz.perf
    for (const k of KEYS) {
      expect(typeof zh[k], `cmn-Hant ppz.perf.${k}`).toBe('string')
      expect(typeof en[k], `en ppz.perf.${k}`).toBe('string')
      const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
      expect(params(en[k]), k).toEqual(params(zh[k]))
    }
  })

  it('元件用到的 ppz.perf 鍵都存在', () => {
    const vue = read('renderer/src/web/settings/tabs/PerfSection.vue')
    const used = [...vue.matchAll(/t\('ppz\.perf\.(\w+)'/g)].map(m => m[1])
    expect(used.length).toBeGreaterThan(5)
    for (const k of used) expect(KEYS).toContain(k)
  })
})

describe('效能區接線', () => {
  it('記錄分頁只在 Host.canPerf(Electron 視窗)時掛效能區', () => {
    const log = read('renderer/src/web/settings/tabs/Log.vue')
    expect(log).toContain('<PerfSection v-if="canPerf" />')
    expect(log).toContain('const canPerf = Host.canPerf')
    const ipc = read('renderer/src/web/background/IPC.ts')
    expect(ipc).toMatch(/get canPerf \(\): boolean \{ return !this\.isPreview && typeof window\.host\?\.perfGet === 'function' \}/)
  })

  it('開關走 perf-set(main 存 perf.json),不進 config.json / host-config', () => {
    const vue = read('renderer/src/web/settings/tabs/PerfSection.vue')
    expect(vue).toContain('Host.perfSet(on)')
    expect(vue).not.toMatch(/config\.(value\.)?perf/)
    const cfg = read('renderer/src/web/Config.ts')
    expect(cfg).not.toMatch(/perf/i)
    const types = read('ipc/types.ts')
    const host = /export interface HostConfigForMain \{[\s\S]*?\n\}/.exec(types)![0]
    expect(host).not.toMatch(/perf/i)
  })

  it('關著不輪詢(只在 enabled 時 setInterval),卸載時清掉', () => {
    const vue = read('renderer/src/web/settings/tabs/PerfSection.vue')
    expect(vue).toMatch(/if \(on\) poll = setInterval/)
    expect(vue).toMatch(/onBeforeUnmount\(\(\) => \{\s*stopPoll\(\)/)
  })
})
