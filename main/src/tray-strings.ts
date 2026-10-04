/**
 * 托盤選單字串(兩語系)。main 沒有 vue-i18n,只有這 4 個字,直接寫在這裡;
 * 語言跟 renderer 的 `uiLanguage`(`host-config` 送來,收到時重建選單)。
 * 選單只有:在瀏覽器開啟設定 / 版本(灰字不可點)/ 檢查更新 / ─ / 結束(步 38,2026-10-04 精簡)。
 */
export type TrayLang = 'cmn-Hant' | 'en'

export interface TrayStrings {
  /** 啟動瀏覽器預覽伺服器並用預設瀏覽器開設定頁(與設定「一般」分頁的按鈕同名)。 */
  openInBrowser: string
  checkUpdate: string
  quit: string
  /** 不可點的版本標籤,如「流亡鑑價 v0.1.3」/ `ExileAppraiser v0.1.3`。 */
  version: (ver: string) => string
}

export const TRAY_STRINGS: Readonly<Record<TrayLang, TrayStrings>> = {
  'cmn-Hant': {
    openInBrowser: '在瀏覽器開啟設定',
    checkUpdate: '檢查更新',
    quit: '結束',
    version: (ver) => `流亡鑑價 v${ver}`
  },
  en: {
    openInBrowser: 'Open settings in browser',
    checkUpdate: 'Check for updates',
    quit: 'Quit',
    version: (ver) => `ExileAppraiser v${ver}`
  }
}

export function trayStrings (lang: string | undefined): TrayStrings {
  return lang === 'en' ? TRAY_STRINGS.en : TRAY_STRINGS['cmn-Hant']
}
