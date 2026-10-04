// 托盤右鍵選單精簡(步 38):只留 在瀏覽器開啟設定 / 版本(灰字)/ 檢查更新 / ─ / 結束;
// 「開啟設定資料夾」移到設定 › 關於(IPC config-open-folder,preview: false)。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOST_METHOD_CHANNELS, bootScript } from '../src/preview-server'
import { TRAY_STRINGS, trayStrings } from '../src/tray-strings'

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8')
const main = read('../src/main.ts')

describe('tray-strings', () => {
  it('兩語系字串齊全且只有 4 個鍵', () => {
    for (const lang of ['cmn-Hant', 'en'] as const) {
      expect(Object.keys(TRAY_STRINGS[lang]).sort()).toEqual(['checkUpdate', 'openInBrowser', 'quit', 'version'])
    }
  })
  it('版本標籤:中文「流亡鑑價 v…」、英文 `ExileAppraiser v…`;未知語系回中文', () => {
    expect(trayStrings('cmn-Hant').version('0.1.3')).toBe('流亡鑑價 v0.1.3')
    expect(trayStrings('en').version('0.1.3')).toBe('ExileAppraiser v0.1.3')
    expect(trayStrings(undefined).version('1.0.0')).toBe('流亡鑑價 v1.0.0')
  })
})

describe('rebuildTrayMenu 範本', () => {
  const fn = /function rebuildTrayMenu[\s\S]*?\n}\n/.exec(main)?.[0] ?? ''
  it('依序:瀏覽器開啟 / 版本(不可點)/ 檢查更新 / 分隔線 / 結束', () => {
    const order = ['s.openInBrowser', 's.version(app.getVersion())', 's.checkUpdate', "type: 'separator'", 's.quit']
    const idx = order.map((k) => fn.indexOf(k))
    expect(idx.every((i) => i >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    expect(/s\.version\(app\.getVersion\(\)\), enabled: false/.test(fn)).toBe(true)
  })
  it('已移除 顯示 / 設定 / 開啟設定資料夾 / 關於', () => {
    for (const k of ['s.show', 's.settings', 's.openConfigFolder', 's.about', 'openSettings']) expect(fn).not.toContain(k)
  })
  it('雙擊托盤圖示仍叫出視窗', () => {
    expect(main).toContain("tray.on('double-click', actions.show)")
  })
})

describe('開啟設定資料夾移到設定 › 關於', () => {
  it('config-open-folder:invoke + preview: false;不在預覽方法表', () => {
    const m = /'config-open-folder':\s*\{[\s\S]*?\n    \},/.exec(main)?.[0] ?? ''
    expect(m).toContain("kind: 'invoke'")
    expect(m).toContain('preview: false')
    expect(Object.values(HOST_METHOD_CHANNELS)).not.toContain('config-open-folder')
    expect(bootScript({ prefix: '/t/' + 'a'.repeat(32) + '/', version: '1.0.0' })).not.toContain('"openConfigFolder"')
  })
  it('preload / About.vue / 兩語系 i18n 都有入口', () => {
    expect(read('../src/preload.ts')).toContain("ipcRenderer.invoke('config-open-folder')")
    expect(read('../../renderer/src/web/settings/tabs/About.vue')).toContain('data-action="config-open-folder"')
    for (const lang of ['cmn-Hant', 'en']) {
      const about = JSON.parse(read(`../../renderer/src/i18n/${lang}.json`)).ppz.about
      expect(about.config_folder).toBeTruthy()
      expect(about.config_folder_open).toBeTruthy()
    }
  })
})
