// 2026-10-03 實機回歸:uiohook-napi.node 路徑過長 → SetWindowsHookEx 失敗(0x7E)。純函式部分(不載入原生模組、不裝掛鉤)。
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_HOOK_MODULE_PATH, planUiohookPrebuild, toUnpackedPath } from '../src/uiohook-prebuild'

const w = path.win32.join
const REL = w('prebuilds', 'win32-x64', 'uiohook-napi.node')
/** 組出 <root>\resources\app.asar\node_modules\uiohook-napi(打包版 node-gyp-build 回傳的寫法) */
const pkgUnder = (root: string) => w(root, 'resources', 'app.asar', 'node_modules', 'uiohook-napi')
const HASH = 'abcdef0123456789'.repeat(4)
const SHORT_ROOT = w('C:', 'Users', 'u', 'AppData', 'Roaming', 'exile-appraiser', 'native')

describe('toUnpackedPath', () => {
  it('app.asar 段換成 app.asar.unpacked(兩種分隔符),其他不動、已 unpacked 不重複換', () => {
    expect(toUnpackedPath(w('C:', 'x', 'resources', 'app.asar', 'node_modules', 'a.node')))
      .toBe(w('C:', 'x', 'resources', 'app.asar.unpacked', 'node_modules', 'a.node'))
    expect(toUnpackedPath('/opt/x/resources/app.asar/node_modules/a.node')).toBe('/opt/x/resources/app.asar.unpacked/node_modules/a.node')
    const unpacked = w('C:', 'x', 'app.asar.unpacked', 'a.node')
    expect(toUnpackedPath(unpacked)).toBe(unpacked)
    const dev = w('D:', 'repo', 'node_modules', 'uiohook-napi', REL)
    expect(toUnpackedPath(dev)).toBe(dev)
    expect(toUnpackedPath(w('C:', 'my.app.asar.d', 'a.node'))).toBe(w('C:', 'my.app.asar.d', 'a.node'))
  })
})

describe('planUiohookPrebuild', () => {
  it('一般安裝路徑(短)→ 不動', () => {
    const pkgDir = pkgUnder(w('C:', 'Users', 'u', 'AppData', 'Local', 'Programs', 'ExileAppraiser'))
    const plan = planUiohookPrebuild({ platform: 'win32', nodePath: w(pkgDir, REL), pkgDir, shortRoot: SHORT_ROOT, hash: HASH })
    expect(plan.action).toBe('none')
    expect(plan.reason).toMatch(/^path-ok/)
    expect(plan.source).toContain('app.asar.unpacked')
  })

  it('實機回歸的測試版路徑(284 字元)→ 轉到短路徑,保留原相對路徑、目錄名含雜湊前 12 碼', () => {
    const root = w('C:', 'Users', 'jerry', 'AppData', 'Local', 'Temp', 'claude',
      'D--codeproject-Pob2--claude-worktrees-trade-query-encoding-migration-52633e', '1032c9a0-f5ba-4f11-a1e5-e8d5bf42f930',
      'scratchpad', 'ea-test-build6', 'win-unpacked')
    const pkgDir = pkgUnder(root)
    const plan = planUiohookPrebuild({ platform: 'win32', nodePath: w(pkgDir, REL), pkgDir, shortRoot: SHORT_ROOT, hash: HASH })
    expect(plan.source.length).toBe(284)
    expect(plan.action).toBe('redirect')
    if (plan.action !== 'redirect') return
    expect(plan.prebuildDir).toBe(w(SHORT_ROOT, 'uiohook-napi-abcdef012345'))
    expect(plan.target).toBe(w(plan.prebuildDir, REL))
    expect(plan.target.length).toBeLessThanOrEqual(MAX_HOOK_MODULE_PATH)
  })

  it('門檻:恰好上限不轉、多一字元才轉', () => {
    const mk = (len: number) => {
      const base = w('C:', 'x')
      const pad = len - w(base, 'd', 'resources', 'app.asar.unpacked', 'node_modules', 'uiohook-napi', REL).length + 1
      const pkgDir = pkgUnder(w(base, 'd'.repeat(pad)))
      return planUiohookPrebuild({ platform: 'win32', nodePath: w(pkgDir, REL), pkgDir, shortRoot: SHORT_ROOT, hash: HASH })
    }
    expect(mk(MAX_HOOK_MODULE_PATH).source.length).toBe(MAX_HOOK_MODULE_PATH)
    expect(mk(MAX_HOOK_MODULE_PATH).action).toBe('none')
    expect(mk(MAX_HOOK_MODULE_PATH + 1).action).toBe('redirect')
  })

  it('非 Windows 不動;短路徑副本仍過長 / 版面不如預期 → 不動(照原路徑載入,交給 gate 記錄失敗)', () => {
    const pkgDir = pkgUnder(w('C:', 'x'.repeat(300)))
    expect(planUiohookPrebuild({ platform: 'linux', nodePath: w(pkgDir, REL), pkgDir, shortRoot: SHORT_ROOT, hash: HASH }).reason).toBe('not-win32')
    expect(planUiohookPrebuild({ platform: 'win32', nodePath: w(pkgDir, REL), pkgDir, shortRoot: w('C:', 'y'.repeat(300)), hash: HASH }).reason)
      .toMatch(/^short-copy-still-too-long/)
    expect(planUiohookPrebuild({ platform: 'win32', nodePath: w(pkgDir, REL), pkgDir: w('C:', 'elsewhere'), shortRoot: SHORT_ROOT, hash: HASH }).reason)
      .toMatch(/^unexpected-layout/)
  })
})
