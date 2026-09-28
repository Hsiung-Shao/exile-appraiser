/**
 * 托盤選單字串(兩語系)。main 沒有 vue-i18n,只有這 6 個字,直接寫在這裡;
 * 語言跟 renderer 的 `uiLanguage`(`host-config` 送來,收到時重建選單)。
 */
export type TrayLang = 'cmn-Hant' | 'en'

export interface TrayStrings {
  show: string
  settings: string
  checkUpdate: string
  openConfigFolder: string
  about: string
  quit: string
}

export const TRAY_STRINGS: Readonly<Record<TrayLang, TrayStrings>> = {
  'cmn-Hant': {
    show: '顯示',
    settings: '設定',
    checkUpdate: '檢查更新',
    openConfigFolder: '開啟設定資料夾',
    about: '關於',
    quit: '結束'
  },
  en: {
    show: 'Show',
    settings: 'Settings',
    checkUpdate: 'Check for updates',
    openConfigFolder: 'Open config folder',
    about: 'About',
    quit: 'Quit'
  }
}

export function trayStrings (lang: string | undefined): TrayStrings {
  return lang === 'en' ? TRAY_STRINGS.en : TRAY_STRINGS['cmn-Hant']
}
