// 第五輪 30.5:硬體加速設定(hw-accel.ts)與 main.ts 接線守門。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { hardwareAccelerationFromConfig, isConfigContents, shouldDisableHardwareAcceleration } from '../src/hw-accel'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('hardwareAccelerationFromConfig', () => {
  it('沒有檔 / 壞檔 / 舊設定檔沒有這個鍵 → false(= 改版前一律關)', () => {
    for (const raw of [null, undefined, '', '{', 'null', '[]', '{"game":"poe2","overlayMode":true}']) {
      expect(hardwareAccelerationFromConfig(raw)).toBe(false)
    }
  })
  it('只有明確 true 才開;非布林值當成關', () => {
    expect(hardwareAccelerationFromConfig('{"hardwareAcceleration":true}')).toBe(true)
    for (const v of ['false', '1', '"true"', 'null', '{}']) {
      expect(hardwareAccelerationFromConfig(`{"hardwareAcceleration":${v}}`)).toBe(false)
    }
  })
})

describe('shouldDisableHardwareAcceleration', () => {
  it('正常啟動看設定;selftest / 量測 / 控制參數 / 第二實例一律關', () => {
    expect(shouldDisableHardwareAcceleration({ skipStartup: false, setting: false })).toBe(true)
    expect(shouldDisableHardwareAcceleration({ skipStartup: false, setting: true })).toBe(false)
    expect(shouldDisableHardwareAcceleration({ skipStartup: true, setting: true })).toBe(true)
    expect(shouldDisableHardwareAcceleration({ skipStartup: true, setting: false })).toBe(true)
  })
})

describe('isConfigContents(app-relaunch 寫檔前檢查)', () => {
  it('只接受 JSON 物件字串', () => {
    expect(isConfigContents('{"hardwareAcceleration":true}')).toBe(true)
    for (const v of [undefined, null, 1, '', '{', '[]', 'null', '"x"', { a: 1 }]) expect(isConfigContents(v)).toBe(false)
  })
})

describe('main.ts 接線', () => {
  const main = read('../src/main.ts')
  it('不再無條件 disableHardwareAcceleration;在舊版設定搬移之後、依設定決定', () => {
    const calls = main.match(/app\.disableHardwareAcceleration\(\)/g) ?? []
    expect(calls.length).toBe(1)
    const line = main.split('\n').find(l => l.includes('app.disableHardwareAcceleration()'))!
    expect(line).toContain('if (shouldDisableHardwareAcceleration({ skipStartup, setting: HW_ACCEL_SETTING }))')
    expect(main.indexOf('if (!skipStartup) migrateLegacyConfig()')).toBeLessThan(main.indexOf('app.disableHardwareAcceleration()'))
    // 在 app ready 之前(模組頂層,whenReady 的啟動流程之前)
    expect(main.indexOf('app.disableHardwareAcceleration()')).toBeLessThan(main.indexOf('if (!skipStartup) app.whenReady()'))
  })
  it('IPC hw-accel-active / app-relaunch 不開放預覽;relaunch 先寫檔再重新啟動', () => {
    expect(main).toMatch(/'hw-accel-active': \{ kind: 'invoke', preview: false,/)
    const i = main.indexOf("'app-relaunch': {")
    const block = main.slice(i, main.indexOf('    },', i))
    expect(block).toContain('preview: false')
    expect(block.indexOf('await fs.writeFile(CONFIG_PATH(), contents)')).toBeLessThan(block.indexOf('relaunchSelf('))
    expect(block).toContain('if (isConfigContents(contents))')
  })
  it('preload 對應;預覽 boot script 沒有這兩個方法', () => {
    const preload = read('../src/preload.ts')
    expect(preload).toContain("hwAccelActive: () => ipcRenderer.invoke('hw-accel-active')")
    expect(preload).toContain("appRelaunch: (contents: string) => ipcRenderer.invoke('app-relaunch', contents)")
    const preview = read('../src/preview-server.ts')
    expect(preview).not.toContain('hw-accel-active')
    expect(preview).not.toContain('app-relaunch')
  })
})
