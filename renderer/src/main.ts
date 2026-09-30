import { createApp, watch } from 'vue'
import App from './web/App.vue'
import * as I18n from './web/i18n'
import { initConfig, AppConfig } from './web/Config'
import { Host } from './web/background/IPC'
import { useLeagues } from './web/background/Leagues'
import { poe1Adapter, browserDataSource } from '@exile-appraiser/poe1'
import { setTradeContextProvider } from '@/web/price-check/trade/common'
import * as Poe2 from '@poe2-entry'
import type { Game, Language } from '@exile-appraiser/core/realm'
import type { TradeContext } from '@exile-appraiser/core/games/adapter'
import { loadedGame } from './web/games/active'
import { bgImageUrl, useBackground, useTheme } from './web/useTheme'
import { runReload } from './web/loadState'

/** 載入某個遊戲的資料集(每個 adapter 各自持有模組層級資料;切回來時語言沒變就是 no-op)。 */
async function loadGameData (game: Game, lang: Language): Promise<void> {
  const started = performance.now()
  if (game === 'poe2') {
    await Poe2.poe2Adapter.loadData(Poe2.browserDataSource('./data/poe2'), lang)
  } else {
    await poe1Adapter.loadData(browserDataSource('./data/poe1'), lang)
  }
  console.log(`[app] 資料載入完成 game=${game} lang=${lang}(${Math.round(performance.now() - started)} ms)`)
}

/** 啟動失敗時直接把錯誤畫在 #app(純 DOM,不依賴 Vue),避免視窗全空白沒有線索。 */
function renderBootError (error: unknown) {
  console.error('[exile-appraiser] 啟動失敗', error)
  const root = document.getElementById('app') ?? document.body
  const title = document.createElement('h3')
  title.textContent = 'ExileAppraiser 啟動失敗'
  title.style.cssText = 'color:#fc8181;margin:12px;font-family:sans-serif'
  const pre = document.createElement('pre')
  pre.textContent = error instanceof Error ? (error.stack ?? String(error)) : String(error)
  pre.style.cssText = 'color:#fed7d7;background:#2d1f1f;margin:12px;padding:8px;white-space:pre-wrap;word-break:break-all;font-size:12px'
  root.replaceChildren(title, pre)
}

;(async function () {
  try {
    await boot()
  } catch (error) {
    renderBootError(error)
  }
})()

async function boot () {
  // overlay 模式:透明視窗疊在遊戲上;在任何東西畫出來之前就讓背景透明
  if (Host.isOverlay) document.documentElement.classList.add('ppz-overlay')
  await initConfig()
  // 外觀(data-theme / --fs-base / 強調色)先套,載資料期間畫面就是正確主題
  useTheme(() => AppConfig())
  // 自訂背景圖(查價面板與設定視窗內的 .bgimg 層;overlay 其他區域維持透明)
  useBackground(() => AppConfig().bg,
    file => bgImageUrl(file, { electron: Host.isElectron, preview: Host.isPreview, baseURI: document.baseURI }))
  // 介面字串跟 uiLanguage;資料集跟 language(客戶端語言)
  const i18nPlugin = await I18n.init(AppConfig().uiLanguage, AppConfig().game)
  await loadGameData(AppConfig().game, AppConfig().language)
  loadedGame.value = AppConfig().game

  // 移植來的 Vue 元件透過 activeTradeContext() 取得 http / realm / 設定
  // 兩個遊戲 package 各有自己的 provider 持有者,都接到同一份設定
  const tradeContext = (): TradeContext => ({
    http: Host.httpFetch,
    realm: AppConfig().realm,
    latencySeconds: AppConfig().priceCheck.apiLatencySeconds,
    accountName: AppConfig().accountName
  })
  setTradeContextProvider(tradeContext)
  Poe2.setTradeContextProvider(tradeContext)
  // PoE2 parser / filters 讀的設定(E 原本直接讀 AppConfig)
  Poe2.setHostOptionsProvider(() => ({
    language: AppConfig().language,
    savedAugments: AppConfig().priceCheck.savedAugments,
    searchStatRange: AppConfig().priceCheck.searchStatRange
  }))

  // 切遊戲 / 客戶端語言:重載該遊戲的資料集(不必重啟);切遊戲或介面語言:重載 app_i18n。
  // 只切介面語言不碰資料集。資料載完才切 loadedGame。
  watch(() => [AppConfig().game, AppConfig().language, AppConfig().uiLanguage] as const,
    async ([game, lang, uiLang], [prevGame, prevLang, prevUiLang]) => {
      const dataChanged = game !== prevGame || lang !== prevLang
      const stringsChanged = game !== prevGame || uiLang !== prevUiLang
      // 面板頂端的載入列 / 失敗 + 重試(loadState.ts)
      await runReload(async () => {
        if (dataChanged) {
          console.log(`[app] 設定變更 game ${prevGame}→${game} lang ${prevLang}→${lang},重載資料`)
          await loadGameData(game, lang)
        }
        if (stringsChanged) {
          if (!dataChanged) console.log(`[app] 介面語言 ${prevUiLang}→${uiLang}`)
          await I18n.loadLang(uiLang, game)
        }
        if (dataChanged) loadedGame.value = game
      })
    })

  void useLeagues().load()

  createApp(App)
    .use(i18nPlugin)
    .mount('#app')
}
