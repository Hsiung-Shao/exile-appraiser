import { createI18n, Composer as I18n, useI18n } from 'vue-i18n'
import { nextTick } from 'vue'

/**
 * 與上游 `web/i18n.ts` 相同,只把資料路徑改成 `./data/<game>/<lang>/app_i18n.json`
 * (PoE1 的字串來自 apt-patched、PoE2 的來自 ee2-patched;切遊戲時 `loadLang(lang, game)` 兩個語系都重載)
 * (上游 UI 字串檔隨資料一起逐位元組同步;本專案自己的字串放 `src/i18n/<lang>.json` 疊上去)。
 * `lang` 是**介面語言**(`AppConfig().uiLanguage`),不是客戶端語言;資料集由 main.ts 依 `language` 另外載。
 * 兩個遊戲上游字串檔都缺的根鍵(`Retry`、`You`…)補在 `src/i18n/<lang>.json`(以 poe1 cmn-Hant 為準)。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _global: I18n<any, any, any, any, any>

export type I18nGame = 'poe1' | 'poe2'
let currentGame: I18nGame = 'poe1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadMessages (lang: string, game: I18nGame): Promise<any> {
  const upstream = await (await fetch(`./data/${game}/${lang}/app_i18n.json`)).json()
  const own = (await import(`../i18n/${lang}.json`)).default
  return { ...upstream, ...own }
}

export async function init (lang: string, game: I18nGame = 'poe1') {
  currentGame = game
  const plugin = createI18n<false>({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    fallbackFormat: true,
    fallbackWarn: false,
    missingWarn: false,
    messages: {
      en: await loadMessages('en', game)
    }
  })
  _global = plugin.global
  await loadLang(lang, game)
  return plugin
}

export async function loadLang (lang: string, game: I18nGame = currentGame): Promise<void> {
  if (game !== currentGame) {
    // 換遊戲:英文(fallback)那份也要換成該遊戲的上游字串
    _global.setLocaleMessage('en', await loadMessages('en', game))
    currentGame = game
  }
  if (lang !== 'en') {
    _global.setLocaleMessage(lang, await loadMessages(lang, game))
  }
  const prevLang = _global.locale.value
  _global.locale.value = lang
  if (prevLang !== 'en' && prevLang !== lang) {
    _global.setLocaleMessage(prevLang, {})
  }
  document.documentElement.lang = lang
  await nextTick()
}

export function useI18nNs (name: string) {
  const { t } = useI18n()
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  const _t = t as Function
  return {
    t: ((path, ...args) => {
      if (typeof path === 'string' && path.startsWith(':')) {
        return _t(path.replace(':', `${name}.`), ...args)
      } else {
        return _t(path, ...args)
      }
    }) as typeof t
  }
}
