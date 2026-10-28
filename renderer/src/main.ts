// exile-appraiser: 2026-10-24 Tailwind 4 升級:這三份含 url()(字型)的 CSS 原本在 App.vue 第一段 <style> 用 `@import`,
// `@tailwindcss/postcss` 內嵌時不重寫 url() 的相對路徑,build 後字型檔找不到(圖示與遊戲字型壞掉)。
// 改由 JS 進入點匯入,Vite 依各檔自己的位置解析並輸出到 assets/;順序維持在 App.vue 樣式之前。守門 renderer/test/css-import-urls.test.ts。
import '@fortawesome/fontawesome-free/css/all.min.css'
import 'animate.css/animate.css'
import './assets/font.css'
import { createApp, watch } from 'vue'
import App from './web/App.vue'
import * as I18n from './web/i18n'
import { initConfig, AppConfig } from './web/Config'
import { Host } from './web/background/IPC'
import { useLeagues } from './web/background/Leagues'
import { poe1Adapter, browserDataSource } from '@exile-appraiser/poe1'
import { setTradeContextProvider } from '@/web/price-check/trade/common'
import { configureDisplayZh as configurePoe1DisplayZh, scheduleDisplayZhPreload as schedulePoe1DisplayZhPreload } from '@/web/price-check/trade/display-zh'
import * as Poe2 from '@poe2-entry'
import type { Game, Language } from '@exile-appraiser/core/realm'
import type { TradeContext } from '@exile-appraiser/core/games/adapter'
import { dataLanguage, loadedGame } from './web/games/active'
import { bgImageUrl, useBackground, useTheme } from './web/useTheme'
import { runReload } from './web/loadState'
import { bumpDataGeneration } from './web/overlay/scan-dedupe'
import { usePoeninja } from './web/background/Prices'
import { createPoe2PriceSource } from './web/background/poe2-price-source'
import { installVueErrorHandler, installWindowErrorLogging } from './web/renderer-errors'
import { ensureStateLoaded as ensureRegexStateLoaded } from './web/regex/store'
import { initRendererPerf } from './web/perf/renderer-perf'

// 未捕捉的例外 / Promise 一律帶堆疊寫進 main log(`[renderer-error]`;main 只收得到 console 的訊息字串)
installWindowErrorLogging(window)

/** 載入某個遊戲的資料集(每個 adapter 各自持有模組層級資料;切回來時語言沒變就是 no-op)。 */
async function loadGameData (game: Game, lang: Language): Promise<void> {
  const started = performance.now()
  if (game === 'poe2') {
    await Poe2.poe2Adapter.loadData(Poe2.browserDataSource('./data/poe2'), lang)
  } else {
    await poe1Adapter.loadData(browserDataSource('./data/poe1'), lang)
  }
  dataLanguage.value = lang // 第 27 步:回到客戶端語言那一套
  console.log(`[app] 資料載入完成 game=${game} lang=${lang}(${Math.round(performance.now() - started)} ms)`)
  // OCR 徽章「同一份列不重算」的鍵含資料集世代:換資料後同一份列要重新比對
  bumpDataGeneration()
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
  // 第 33 步:正則書籤的個別熱鍵存在 regex_state.json → 啟動就讀(不載清單),讀到後併進 host-config 註冊
  void ensureRegexStateLoaded()
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
  // 第 27 步:`language` 不從設定給 —— adapter 依目前資料集的語系自己設(國際服會依複製文字自動判斷語言)
  Poe2.setHostOptionsProvider(() => ({
    savedAugments: AppConfig().priceCheck.savedAugments,
    searchStatRange: AppConfig().priceCheck.searchStatRange,
    uiLanguage: AppConfig().uiLanguage,
    // code review 第 B 批:懸停浮窗關閉時查價結果不載 / 不翻繁中資料(display-zh.ts)
    itemHoverTooltip: AppConfig().priceCheck.itemHoverTooltip
  }))
  // 第 24 步:PoE2 查價元件(通貨價格區、結果列換算價、ExtractionValue…)讀 renderer 的 poe.ninja 價格表
  // (getter:第一次用到才建立 usePoeninja,不改變它的建立時機)
  Poe2.setPriceSource(createPoe2PriceSource(() => usePoeninja()))
  // 2026-10-15:PoE2 查價結果懸停浮窗的繁中資料在資料載好後閒置時預先載入(原本第一次查價才背景載入 → 第一次全英文);
  // 換遊戲 / 客戶端語言(新的資料來源)/ 伺服器 / 介面語言 / 浮窗設定時重看,不符條件或已載好是 no-op
  // 2026-10-15:PoE1 查價結果懸停浮窗也繁中化(poe1 display-zh.ts):注入設定與資料來源,預載同 PoE2
  const poe1ZhSource = browserDataSource('./data/poe1')
  configurePoe1DisplayZh({
    options: () => ({ uiLanguage: AppConfig().uiLanguage, itemHoverTooltip: AppConfig().priceCheck.itemHoverTooltip }),
    source: () => poe1ZhSource
  })
  watch(() => [loadedGame.value, dataLanguage.value, AppConfig().realm, AppConfig().uiLanguage, AppConfig().priceCheck.itemHoverTooltip] as const,
    ([game, , realm]) => {
      if (game === 'poe2') Poe2.scheduleDisplayZhPreload(realm)
      else if (game === 'poe1') schedulePoe1DisplayZhPreload(realm)
    },
    { immediate: true })

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

  const app = createApp(App)
  // Vue 錯誤(沒被查價面板的 ErrorBoundary 攔下的)帶元件路徑與堆疊寫進 main log;正式版預設只印 `console.error(err)`
  installVueErrorHandler(app)
  app.use(i18nPlugin).mount('#app')

  // B8:效能診斷開著時才收 renderer 指標(longtask / 幀間隔 / 查價延遲 / 背景圖);關著 = 0 observer / 0 計時器
  initRendererPerf(Host, {
    PerformanceObserver: typeof PerformanceObserver === 'function' ? PerformanceObserver as never : undefined,
    raf: (cb) => requestAnimationFrame(cb),
    caf: (h) => { cancelAnimationFrame(h) },
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => { clearInterval(h as ReturnType<typeof setInterval>) },
    now: () => performance.now(),
    framesWanted: () => {
      if (document.visibilityState !== 'visible') return false
      if (!Host.isOverlay) return true
      const c = Host.lastOverlayContent
      return c != null && Object.values(c).some(v => v === true)
    },
    onItemText: (cb) => Host.onItemText(() => { cb() }),
    send: (r) => { Host.perfRenderer(r) }
  })
}
