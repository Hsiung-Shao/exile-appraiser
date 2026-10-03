<!--
  兩種版面共用同一組面板內容:
  - overlay(預設):照 APT `OverlayWindow.vue` + `PriceCheckWindow.vue` 的版面。根元素全螢幕透明,
    查價面板固定寬 28.75rem,依按下熱鍵時游標在遊戲左/右半邊決定放在 stash 側(先空出遊戲側欄寬 --game-panel)
    或 inventory 側。快速查價放開修飾鍵移開滑鼠就關(main 的 WidgetAreaTracker),鎖定查價可點擊。
    面板寬 = PANEL_WIDTH_EM × fsBase × LEGACY_FS_SCALE(px),見 script。
    外觀(主題 / 強調色 / 字級)由 useTheme.ts 寫在 <html>;樣式 token 在 ../theme/pobtools.css。
  - window(備援:`--window` / overlayMode=false / 純瀏覽器):原本的獨立小視窗 + 貼上框。
  外觀(WP2,PobTools 語彙):標題列 = 金色菱形 + 品牌名 + 遊戲/區服徽章(.chip)+ 聯盟下拉(.select.sm)+ 齒輪/關閉(.btn.ghost.sm);
  面板容器 --surface-1 + 左 3px 金邊(overlay 另加 --shadow-float 與圓角);重載 / 限流 / 失敗用面板頂端的細條;
  限流狀態鈕:視窗模式在底列右側,overlay 在面板外側(不與面板重疊)。
  拆粉排行(2026-09-30 起)是設定視窗的「拆粉排行」分頁(settings/tabs/Dust.vue);標題列 ⚖ = 開設定並切到該分頁
  (設定開著時查價面板隱藏,⚖ 只會是「開」)。WP-Q 的「停靠在查價下方 + 分隔條」已移除。
  交易站網頁一律經 ./trade-site.ts 的 openTradeSite(provide 'builtin-browser' 也是它;預設系統瀏覽器)。
  設定(settings/SettingsWindow.vue,APT 式方正視窗):overlay 是獨立於 #price-window 的置中浮動層(.settings-layer 暗幕,
  點暗幕 / Esc / ✕ 關閉;設定開著時查價面板整個隱藏,只剩設定視窗,關閉後有物品回到查價面板、沒物品整個收起);
  window 模式與瀏覽器預覽填滿視窗內容區(取代 .window-body)。
  收到新物品關閉設定;OCR 框選開啟時隱藏設定,由設定開的框選結束後回到設定的熱鍵分頁(ocr-reveal.ts returnsToSettings)。
  overlayKey(預設 Shift + Space)一律開設定(符文塑形徽章不可點;無 ninja 價的列由 RuneshapePrices.vue 自動查市集)。
  查價面板 / 設定開著時寫 `runeshapeTradeHold`(overlay/runeshape-view.ts)→ 自動查市集佇列暫停,限流額度讓給一般查價。
  自訂背景圖(2026-10-01):#price-window 與設定視窗是 .bg-host,第一個子元素 BgLayer.vue(圖 + 面板底色層),只畫在容器內;
  overlay 根元素與其他區域維持透明(theme/pobtools.css「自訂背景圖」)。
  2026-10-01 起沒有「按住 Alt 讓路」(APT OverlayVisibility 已移除):查價中按 Alt 不會藏任何 overlay 介面。
-->
<template>
  <div id="app" class="font-ui text-ink-0"
    :class="isOverlay ? 'overlay-root' : 'bg-surface-0'"
    :style="rootStyle">
    <div v-if="isOverlay" class="absolute inset-0" @click="handleBackgroundClick" />

    <!-- 設定開著時查價面板(含標題列、側邊限流鈕)一律讓位;overlay 只是 v-show 藏起,關設定後原樣回來 -->
    <div v-show="panelVisible"
      :class="isOverlay ? ['absolute', 'inset-0', 'flex', 'pointer-events-none', clickPosition === 'stash' ? 'flex-row' : 'flex-row-reverse'] : 'window-body'">
      <div v-if="isOverlay" class="layout-column shrink-0" style="width: var(--game-panel);" />

      <div id="price-window" class="layout-column min-h-0 price-panel bg-host"
        :class="isOverlay ? 'is-overlay shrink-0 pointer-events-auto' : 'is-window grow'"
        :style="isOverlay ? { width: `${panelWidth}px` } : undefined">
        <!-- 自訂背景圖(設定 › 一般 › 背景;只畫在面板裡,overlay 其他區域維持透明)。第 30.6 步:面板藏起時整層卸載 -->
        <bg-layer host="panel" :shown="panelVisible" />
        <header class="titlebar" :style="isOverlay ? undefined : '-webkit-app-region: drag;'">
          <span class="brand"><i class="mark" />{{ t('ppz.title') }}</span>
          <span class="chip" data-badge="game">{{ gameBadge }}</span>
          <span class="chip" data-badge="realm">{{ realmBadge }}</span>
          <div class="titlebar-center">
            <select v-model="leagueId" class="select sm league-select" style="-webkit-app-region: no-drag;"
              :title="t('ppz.league')" :disabled="leagues.isLoading.value">
              <option v-if="leagues.isLoading.value" :value="leagueId">{{ t('ppz.league_loading') }}</option>
              <option v-for="l in leagues.list.value" :key="l.id" :value="l.id">{{ l.id }}</option>
            </select>
          </div>
          <button class="btn ghost sm icon-btn" :title="t('ppz.dust.toggle')" :aria-label="t('ppz.dust.toggle')"
            style="-webkit-app-region: no-drag;" data-action="dust" @click="openDust">⚖</button>
          <button class="btn ghost sm icon-btn" :class="{ on: showSettings }" :title="t('ppz.settings')" :aria-label="t('ppz.settings')"
            style="-webkit-app-region: no-drag;" data-action="settings" @click="toggleSettings">⚙</button>
          <button class="btn ghost sm icon-btn" :title="t('ppz.close')" :aria-label="t('ppz.close')"
            style="-webkit-app-region: no-drag;" data-action="close" @click="close">✕</button>
        </header>

        <div v-if="reloadPhase === 'loading'" class="strip" data-strip="loading">
          <span class="pulse">{{ t('ppz.reloading') }}</span>
        </div>
        <div v-else-if="reloadPhase === 'error'" class="strip bad" data-strip="error">
          <span class="grow truncate">{{ t('ppz.reload_failed', { error: reloadError }) }}</span>
          <button class="btn sm" @click="retryReload">{{ t('Retry') }}</button>
        </div>
        <div v-if="rateLimitWait" class="strip warn" data-strip="rate-limit">
          <span>{{ t('ppz.rate_limited', { seconds: rateLimitWait }) }}</span>
        </div>
        <div v-if="reportMessage" class="strip" :class="{ bad: reportMessage.bad }" data-strip="report">
          <span class="grow">{{ reportMessage.text }}</span>
        </div>

        <div class="price-body grow min-h-0" data-layout="price-body">
          <main class="price-main relative">
            <ui-error-box v-if="leagues.error.value" class="m-3">
              <template #name>{{ t('ppz.league_failed', { error: leagues.error.value }) }}</template>
              <p>{{ t('ppz.league_failed_help') }}</p>
              <template #actions>
                <button class="btn sm" @click="openCaptcha">{{ t('ppz.open_captcha') }}</button>
                <button class="btn sm primary" @click="leagues.load()">{{ t('Retry') }}</button>
              </template>
            </ui-error-box>
            <ui-error-box v-else-if="!supported" class="m-3" data-error="unsupported-combo">
              <template #name>{{ t('ppz.unsupported_combo') }}</template>
              <template #actions>
                <button class="btn sm" data-action="switch-intl" @click="switchToIntl">{{ t('ppz.switch_to_intl') }}</button>
                <button class="btn sm primary" data-action="switch-zh" @click="switchToZh">{{ t('ppz.switch_to_zh') }}</button>
              </template>
            </ui-error-box>

            <template v-if="parsed?.isErr()">
              <ui-error-box class="m-3" data-error="parse">
                <template #name>{{ t('ppz.parse_error') }}</template>
                <p>{{ parseErrorText(parsed.error) }}</p>
                <template #actions>
                  <button class="btn sm" data-action="copy-raw" @click="copyRaw">{{ copied ? t('ppz.copied') : t('ppz.copy_raw') }}</button>
                  <button class="btn sm" data-action="report-parse" @click="reportParseError">{{ t('ppz.report.parse') }} ↗</button>
                </template>
              </ui-error-box>
              <pre class="raw-text selectable mx-3 mb-3">{{ rawText }}</pre>
            </template>
            <!-- 元件出錯時改畫錯誤框(寫進 main log)而不是整塊空白;換物品自動清除 -->
            <error-boundary v-else-if="parsed?.isOk() && leagueId && supported" :reset-key="itemKey" where="price-check">
              <!-- PoE2 未鑑定傳奇:先選是哪個傳奇(上游 PriceCheckWindow.vue 同位置;只有一個就自動選) -->
              <component :is="unidentifiedResolverComponent" v-if="unidentifiedResolverComponent"
                :key="`u${itemKey}`" :item="parsed.value" @identify="onIdentify" />
              <component :is="checkedItemComponent"
                :key="itemKey"
                :item="parsed.value" :advanced-check="advancedCheck" />
            </error-boundary>

            <div v-if="!parsed" class="paste-area">
              <p class="paste-hint">{{ t('ppz.paste_hint', { hotkey: hotkeyLabel }) }}</p>
              <textarea v-model="pasteText" class="input paste-input" rows="10"
                :placeholder="t('ppz.paste_placeholder')" @keydown.ctrl.enter="parsePasted" />
              <div class="flex gap-2">
                <button class="btn primary" @click="parsePasted">{{ t('ppz.parse') }}</button>
              </div>
            </div>
          </main>
        </div>

        <footer v-if="parsed || !isOverlay" class="bottombar">
          <button v-if="parsed" class="btn sm" data-action="paste-another" @click="reset">{{ t('ppz.paste') }}</button>
          <template v-if="parsed?.isOk()">
            <button class="btn ghost sm" data-action="report-item" @click="reportItem">{{ t('ppz.report.item') }} ↗</button>
            <button class="btn ghost sm" data-action="report-copy" @click="copyItemReport">{{ t('ppz.report.copy') }}</button>
          </template>
          <span class="grow" />
          <component :is="rateLimiterComponent" v-if="!isOverlay" align="end" />
        </footer>
      </div>

      <div v-if="isOverlay" class="layout-column flex-1 min-w-0 justify-end">
        <div class="flex p-2" :class="clickPosition === 'stash' ? 'justify-start' : 'justify-end'">
          <component :is="rateLimiterComponent" class="pointer-events-auto side-rate-limiter"
            :align="clickPosition === 'stash' ? 'start' : 'end'" />
        </div>
      </div>
    </div>

    <!-- 設定視窗:overlay = 暗幕 + 置中浮動(點暗幕關閉);window / 預覽 = 填滿內容區 -->
    <div v-if="settingsVisible" class="settings-layer" :class="isOverlay ? 'is-overlay' : 'is-window'" data-layer="settings"
      @pointerdown="onSettingsLayerPointerDown" @click="onSettingsLayerClick">
      <settings-window :floating="isOverlay" :game-badge="gameBadge" :realm-badge="realmBadge" @close="closeSettings('✕')">
        <template #strips>
          <div v-if="reloadPhase === 'loading'" class="strip" data-strip="settings-loading">
            <span class="pulse">{{ t('ppz.reloading') }}</span>
          </div>
          <div v-else-if="reloadPhase === 'error'" class="strip bad" data-strip="settings-error">
            <span class="grow truncate">{{ t('ppz.reload_failed', { error: reloadError }) }}</span>
            <button class="btn sm" @click="retryReload">{{ t('Retry') }}</button>
          </div>
        </template>
      </settings-window>
    </div>

    <!-- WP-S:靈魂之井揭露面板 OCR 徽章(與查價面板並列,不受 panelShown 控制) -->
    <ocr-badges v-if="isOverlay" />
    <!-- WP-R2:符文塑形面板自動查價徽章(同 OCR 徽章層級) -->
    <runeshape-prices v-if="isOverlay" />
    <!-- WP-S2:在遊戲畫面上框選 OCR 區域(開著時忽略背景點擊) -->
    <ocr-region-picker v-if="isOverlay" />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, provide, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ok, type Result } from 'neverthrow'
import type { ItemTextEvent } from '@ipc/types'
// 兩個遊戲各自的 parser / CheckedItem / RateLimiterState;依 loadedGame(資料已載入完成的遊戲)切換
import { parseClipboard, type ParsedItem } from '@/parser'
import CheckedItem from '@poe1/CheckedItem.vue'
import RateLimiterState from '@poe1/trade/RateLimiterState.vue'
import * as Poe2 from '@poe2-entry'
import { dataLanguage, loadedGame } from './games/active'
import { poe1Adapter } from '@exile-appraiser/poe1'
import type { ItemTextLanguage } from '@exile-appraiser/core/games/adapter'
import { TRADE_PATHS } from '@exile-appraiser/core/realm'
import UiErrorBox from '@/web/ui/UiErrorBox.vue'
import ErrorBoundary from './ui/ErrorBoundary.vue'
import BgLayer from './ui/BgLayer.vue'
import SettingsWindow from './settings/SettingsWindow.vue'
import OcrBadges from './overlay/OcrBadges.vue'
import OcrRegionPicker from './overlay/OcrRegionPicker.vue'
import RuneshapePrices from './overlay/RuneshapePrices.vue'
import { runeshapeTradeHold } from './overlay/runeshape-view'
import { recordPoe2Item, regionPickerClosed, regionPickerOpen, returnsToSettings } from './overlay/ocr-reveal'
import type { SettingsTabId } from '@ipc/types'
import { AppConfig } from './Config'
import { Host } from './background/IPC'
import { openTradeSite } from './trade-site'
import { useLeagues } from './background/Leagues'
import { REALMS, isSupportedCombination } from '@exile-appraiser/core/realm'
import { reloadPhase, reloadError, retryReload } from './loadState'
import { reportIssue, copyIssueReport, reportStatus, type ReportContext } from './report'
import { settingsTab } from './settings/tabState'
import { createBackdropGuard } from './settings/settings-window-geom'

/** APT 的面板寬 28.75rem(rem 當時 = 16px → 460px)。 */
const PANEL_WIDTH_EM = 28.75
/**
 * 舊字級 16px 對應新預設 fsBase 13(16 / 13 ≈ 1.23):面板寬 / 關閉距離乘上它,
 * fsBase 13 時維持原本 460px 的視覺寬度,並隨 fsBase 等比縮放。
 */
const LEGACY_FS_SCALE = 1.23

export default defineComponent({
  components: { UiErrorBox, ErrorBoundary, BgLayer, SettingsWindow, OcrBadges, OcrRegionPicker, RuneshapePrices },
  setup () {
    const { t, te } = useI18n()
    const leagues = useLeagues()
    const isOverlay = Host.isOverlay
    const parsed = shallowRef<Result<ParsedItem | Poe2.Poe2ParsedItem, string> | null>(null)
    const rawText = shallowRef('')
    const pasteText = shallowRef('')
    const showSettings = shallowRef(false)
    const itemKey = shallowRef(0)
    const rateLimitWait = shallowRef(0)
    // ---- overlay 狀態(APT WidgetManager 的最小子集) ----
    const panelShown = shallowRef(false)
    const advancedCheck = shallowRef(false)
    const checkPosition = shallowRef({ x: 1, y: 1 })
    const overlayActive = shallowRef(false)
    const winHeight = shallowRef(window.innerHeight)
    const copied = shallowRef(false)
    let copiedTimer: ReturnType<typeof setTimeout> | null = null
    /** 物品解析的時間(一鍵回報:之後送出的查詢才算這件的)。 */
    let loadedAt = 0
    /** 一鍵回報的結果提示(面板頂端細條,6 秒後消失)。 */
    const reportNotice = shallowRef<{ text: string, bad: boolean } | null>(null)
    let reportTimer: ReturnType<typeof setTimeout> | null = null

    // 上游元件用 inject('builtin-browser') 開交易站網頁(錯誤框「瀏覽器」、builtinBrowser 時 TradeLinks 主鈕)。
    // 一律交給 openTradeSite:預設系統瀏覽器(同「交易」鈕的 Host.openExternal,使用者已登入);
    // 以前這裡直接開 Host.openCaptcha(沒有登入狀態的 Electron 視窗)。Cloudflare 驗證另有「開啟驗證視窗」鈕。
    provide('builtin-browser', openTradeSite)

    /** 第 27 步:每次 load 遞增;換語系資料要等時,較舊的那次等完就不再覆蓋較新的物品。 */
    let loadSeq = 0

    async function load (text: string) {
      const seq = ++loadSeq
      rawText.value = text
      loadedAt = Date.now()
      reportNotice.value = null
      // 第 27 步:國際服依複製文字的語言換資料集(與客戶端語言不同時;第一次另讀檔,之後快取);台服維持客戶端語言
      const game = loadedGame.value
      const adapter = game === 'poe2' ? Poe2.poe2Adapter : poe1Adapter
      let langInfo: ItemTextLanguage | undefined
      try {
        langInfo = await adapter.prepareItemText(text, AppConfig().realm)
      } catch (e) {
        console.error('[app] 換語系資料失敗,改用目前的資料集解析', e)
      }
      if (seq !== loadSeq) return // 等資料期間又來了一件 → 交給較新的那次
      if (game !== loadedGame.value) { void load(text); return } // 等資料期間換了遊戲 → 用新遊戲重來
      dataLanguage.value = adapter.dataLanguage() ?? AppConfig().language
      parsed.value = loadedGame.value === 'poe2' ? Poe2.parseClipboard(text) : parseClipboard(text)
      itemKey.value += 1
      const p = parsed.value
      const langNote = langInfo && langInfo.clientLanguage && langInfo.lang !== langInfo.clientLanguage
        ? ` [依文字改用 ${langInfo.lang} 解析(客戶端 ${langInfo.clientLanguage})]`
        : ''
      console.log(`[app] 解析(${loadedGame.value})${langNote} ${p.isOk() ? `OK: ${p.value.info.name ?? ''} / ${p.value.info.refName ?? ''}` : `失敗: ${p.error}`}`)
      // WP-S:揭露面板 OCR 的 profile 來源 = 最近 10 分鐘內查價的 PoE2 物品
      if (loadedGame.value === 'poe2' && p.isOk()) recordPoe2Item(p.value as Poe2.Poe2ParsedItem)
    }

    /** 面板寬(CSS px),隨 fsBase。 */
    const panelWidth = computed(() => PANEL_WIDTH_EM * AppConfig().fsBase * LEGACY_FS_SCALE)

    /** 遊戲側欄寬(APT GameWindow.uiSidebarWidth:800x600 時 370px)。 */
    const gamePanel = computed(() => isOverlay ? Math.round(winHeight.value * 370 / 600) : 0)

    function handleItemText (e: ItemTextEvent) {
      if (isOverlay && !e.focusOverlay) {
        // everything in CSS pixels(照 APT PriceCheckWindow.vue)
        const width = panelWidth.value
        const screenX = ((e.position.x - window.screenX) > window.innerWidth / 2)
          ? (window.screenX + window.innerWidth) - gamePanel.value - width
          : window.screenX + gamePanel.value
        Host.trackArea({
          holdKey: AppConfig().hotkeyHold,
          closeThreshold: 2.5 * AppConfig().fsBase * LEGACY_FS_SCALE,
          from: e.position,
          area: {
            x: screenX,
            y: window.screenY,
            width,
            height: window.innerHeight
          },
          dpr: window.devicePixelRatio
        })
      }
      checkPosition.value = e.position
      advancedCheck.value = e.focusOverlay
      showSettings.value = false
      panelShown.value = true
      void load(e.clipboard)
      if (isOverlay) {
        console.log(`[app] 面板顯示 side=${clickPosition.value} locked=${e.focusOverlay} overlay=${window.screenX},${window.screenY} ${window.innerWidth}x${window.innerHeight} gamePanel=${gamePanel.value}`)
      }
    }

    function hidePanel (reason: string) {
      if (!panelShown.value) return
      panelShown.value = false
      console.log(`[app] 面板隱藏(${reason})`)
    }

    /** 設定視窗實際顯示:overlay 還要面板開著(失焦 hide-on-blur 一起收);框選層開著時讓出整個畫面 */
    const settingsVisible = computed(() => showSettings.value && !regionPickerOpen.value && (!isOverlay || panelShown.value))
    /** 查價面板(含標題列、側邊限流鈕)的 v-show 條件;第 30.6 步起背景圖層也照它卸載 / 掛載 */
    const panelVisible = computed(() => isOverlay ? panelShown.value && !settingsVisible.value : !settingsVisible.value)

    /** 開設定到指定分頁(托盤、OCR 框選返回);overlay 要讓面板可互動(main 已 / 另行 assertOverlayActive) */
    function openSettingsTo (tab: SettingsTabId, reason: string) {
      settingsTab.value = tab
      showSettings.value = true
      if (isOverlay) {
        panelShown.value = true
        advancedCheck.value = true
      }
      console.log(`[app] 開啟設定 tab=${tab}(${reason})`)
    }

    function closeSettings (reason: string) {
      if (!showSettings.value) return
      showSettings.value = false
      console.log(`[app] 關閉設定(${reason})`)
      // overlay 沒有物品時,面板只是為了設定才開的:一起收起並把焦點還給遊戲
      if (isOverlay && !parsed.value) {
        hidePanel('關閉設定且沒有物品')
        Host.focusGame()
      }
    }

    // 點暗幕關閉:按下與放開都在暗幕上才算(在視窗內按住 / 拖曳移動 / 調整大小後在暗幕上放開不關;settings-window-geom.ts)
    const backdrop = createBackdropGuard()
    function onSettingsLayerPointerDown (e: PointerEvent) {
      backdrop.down(e.target === e.currentTarget)
    }
    function onSettingsLayerClick (e: MouseEvent) {
      if (backdrop.click(e.target === e.currentTarget) && isOverlay) closeSettings('點暗幕')
    }

    const unsubscribers: Array<() => void> = []
    const onResize = () => { winHeight.value = window.innerHeight }
    const onFocus = () => { Host.usedRecently(Host.isElectron) }
    onMounted(() => {
      unsubscribers.push(Host.onItemText(handleItemText))
      // 托盤「設定」「關於」:main 已把視窗叫到前景(overlay:assertOverlayActive),這裡開設定到該分頁
      unsubscribers.push(Host.onOpenSettings(({ tab }) => { openSettingsTo(tab, '托盤') }))
      if (isOverlay) {
        unsubscribers.push(Host.onHideWidget(() => { hidePanel('hide-exclusive-widget') }))
        unsubscribers.push(Host.onFocusChange((state) => {
          overlayActive.value = state.overlay
          if (state.overlay === false) {
            // APT: wmFlags 'hide-on-blur'
            hidePanel(`focus-change game=${state.game} overlay=false`)
          } else if (state.usingHotkey && !panelShown.value) {
            // overlayKey 叫出 overlay 但沒有物品:開面板 + 設定(本專案沒有 APT 的選單 widget)
            parsed.value = null
            showSettings.value = true
            panelShown.value = true
            advancedCheck.value = true
            console.log('[app] overlayKey 叫出設定面板')
          }
        }))
        window.addEventListener('resize', onResize)
      }
      window.addEventListener('focus', onFocus)
      window.addEventListener('keydown', onKey)
      Host.usedRecently(Host.isElectron)
      console.log(`[app] mounted mode=${Host.windowMode}`)
    })
    onUnmounted(() => {
      unsubscribers.forEach(fn => fn())
      window.removeEventListener('resize', onResize)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('keydown', onKey)
    })

    function onKey (e: KeyboardEvent) {
      // overlay 模式的 Escape 通常先被 main 的 before-input-event 攔下(→ 焦點回遊戲 → hide-on-blur);
      // renderer 收得到時(window 模式、預覽):設定開著先關設定,否則 window 模式隱藏視窗。
      // 熱鍵擷取欄(HotkeyInput)用 Esc 清除,會 preventDefault;框選層在 capture 階段自己處理。
      if (e.key !== 'Escape' || e.defaultPrevented || regionPickerOpen.value) return
      if (settingsVisible.value) {
        e.preventDefault()
        closeSettings('Esc')
      } else if (!isOverlay) {
        close()
      }
    }

    function close () {
      if (isOverlay) {
        hidePanel('關閉鈕')
        Host.focusGame()
      } else {
        void Host.hideWindow()
      }
    }

    function handleBackgroundClick () {
      // WP-S2:框選中不因背景點擊關閉(框選層本身在最上層,這裡是保險)
      if (regionPickerOpen.value) return
      if (AppConfig().overlayBackgroundClose) {
        hidePanel('點背景')
        Host.focusGame()
      }
    }

    let waitTimer: ReturnType<typeof setInterval> | null = null
    // WP-S2:開框選層(設定頁按鈕或熱鍵)→ 關掉設定 / 查價面板,整個遊戲畫面留給框選;
    // 由設定開的,使用者確認 / 取消 / 清除後回到設定的熱鍵分頁(失焦結束的不回)
    watch(regionPickerOpen, (open) => {
      if (open) {
        showSettings.value = false
        hidePanel('開啟框選層')
        return
      }
      const c = regionPickerClosed.value
      if (c && returnsToSettings(c.source, c.outcome)) {
        openSettingsTo('hotkeys', `框選結束:${c.outcome}`)
      }
    })

    // WP-R2:查價面板 / 設定 / 框選層開著 → main 暫停符文塑形掃描(overlay 限定;預覽 / window 模式是 no-op)
    if (isOverlay) {
      watch(() => ({ panel: panelShown.value, settings: settingsVisible.value, picker: regionPickerOpen.value }), (s) => {
        Host.runeshapeUiState(s)
        // 符文塑形自動查市集:查價面板 / 設定開著 → 佇列暫停,限流額度讓給一般查價
        runeshapeTradeHold.value = s.settings ? '設定開著' : s.panel ? '查價面板開著' : null
      }, { immediate: true })
    }

    // 換遊戲後舊物品是另一個 parser 的結果,不能交給新遊戲的 CheckedItem
    watch(loadedGame, (game) => {
      parsed.value = null
      console.log(`[app] 已切換到 ${game}`)
    })

    // 429 Retry-After:面板頂端 --warn 細條倒數(Host.rateLimitWait 每次等待換新物件)
    watch(Host.rateLimitWait, ({ seconds: s }) => {
      rateLimitWait.value = s
      if (waitTimer) clearInterval(waitTimer)
      if (s > 0) {
        waitTimer = setInterval(() => {
          rateLimitWait.value = Math.max(0, rateLimitWait.value - 1)
          if (rateLimitWait.value === 0 && waitTimer) { clearInterval(waitTimer); waitTimer = null }
        }, 1000)
      }
    })

    watch(reportStatus, (s) => {
      if (!s) return
      const text = s.kind === 'url'
        ? t('ppz.report.opened')
        : s.kind === 'clipboard'
          ? t('ppz.report.clipboard')
          : s.kind === 'copied' ? t('ppz.report.copied') : t('ppz.report.failed', { error: s.message ?? '' })
      reportNotice.value = { text, bad: s.kind === 'error' }
      if (reportTimer) clearTimeout(reportTimer)
      reportTimer = setTimeout(() => { reportNotice.value = null }, 6000)
    })

    function itemReportContext (): ReportContext {
      const p = parsed.value
      return { clipboard: rawText.value, item: p?.isOk() ? p.value : undefined, loadedAt }
    }

    const clickPosition = computed(() =>
      checkPosition.value.x > (window.screenX + window.innerWidth / 2) ? 'inventory' : 'stash')

    return {
      t,
      leagues,
      isOverlay,
      parsed,
      rawText,
      pasteText,
      showSettings,
      settingsVisible,
      panelVisible,
      closeSettings,
      onSettingsLayerPointerDown,
      onSettingsLayerClick,
      toggleSettings () {
        // 按得到 ⚙ = 面板已可互動,不必再動 panelShown / advancedCheck
        if (showSettings.value) {
          closeSettings('⚙')
        } else {
          showSettings.value = true
          console.log(`[app] 開啟設定 tab=${settingsTab.value}(⚙)`)
        }
      },
      /**
       * ⚖ = 開設定並切到「拆粉排行」分頁(拆粉排行 2026-09-30 起在設定視窗裡)。
       * 設定開著時查價面板整個隱藏、按不到 ⚖,所以這裡只會是「開」;關閉走設定視窗的 ✕ / Esc / 暗幕。
       */
      openDust () {
        openSettingsTo('dust', '⚖')
      },
      itemKey,
      rateLimitWait,
      checkedItemComponent: computed(() => loadedGame.value === 'poe2' ? Poe2.CheckedItem : CheckedItem),
      // PoE2 未鑑定傳奇的選擇列(PoE1 / APT 沒有這個元件)
      unidentifiedResolverComponent: computed(() => loadedGame.value === 'poe2' ? Poe2.UnidentifiedResolver : null),
      /** 上游 PriceCheckWindow `handleIdentification`:選定的傳奇換掉物品(CheckedItem 隨 prop 重建篩選) */
      onIdentify (identified: Poe2.Poe2ParsedItem) {
        console.log(`[app] 未鑑定傳奇選定:${identified.info.name} / ${identified.info.refName}`)
        parsed.value = ok(identified)
      },
      rateLimiterComponent: computed(() => loadedGame.value === 'poe2' ? Poe2.RateLimiterState : RateLimiterState),
      panelShown,
      advancedCheck,
      clickPosition,
      close,
      handleBackgroundClick,
      panelWidth,
      rootStyle: computed(() => ({
        '--game-panel': `${gamePanel.value}px`
      })),
      hotkeyLabel: computed(() => {
        const c = AppConfig()
        return isOverlay ? `${c.hotkeyHold} + ${c.hotkey} / ${c.hotkeyLocked}` : `${c.hotkeyHold} + ${c.hotkey}`
      }),
      gameBadge: computed(() => loadedGame.value === 'poe2' ? 'PoE2' : 'PoE1'),
      realmBadge: computed(() => AppConfig().realm === 'tw' ? t('ppz.realm_tw_short') : t('ppz.realm_intl_short')),
      reloadPhase,
      reloadError,
      retryReload,
      copied,
      reportMessage: reportNotice,
      reportItem () { void reportIssue(itemReportContext()) },
      copyItemReport () { void copyIssueReport(itemReportContext()) },
      reportParseError () {
        const p = parsed.value
        void reportIssue({ clipboard: rawText.value, error: p?.isErr() ? `${t('ppz.parse_error')}: ${p.error}` : undefined })
      },
      /** 解析失敗:把剪貼簿原文複製回剪貼簿(方便回報)。 */
      async copyRaw () {
        try {
          await navigator.clipboard.writeText(rawText.value)
          copied.value = true
          if (copiedTimer) clearTimeout(copiedTimer)
          copiedTimer = setTimeout(() => { copied.value = false }, 1500)
        } catch (e) {
          console.error('[app] 複製失敗', e)
        }
      },
      /** 台服 + 英文客戶端(不支援):一鍵切國際服或切繁中客戶端。 */
      /** parser 回的是 i18n 鍵(item.parse_error / item.unknown),可能帶「: 細節」;翻得到就翻,細節保留原文。 */
      parseErrorText (error: string): string {
        const i = error.indexOf(': ')
        const key = i < 0 ? error : error.slice(0, i)
        if (!te(key) && !te(key, 'en')) return error
        return i < 0 ? t(key) : `${t(key)}: ${error.slice(i + 2)}`
      },
      switchToIntl () { AppConfig().realm = 'intl' },
      switchToZh () { AppConfig().language = 'cmn-Hant' },
      supported: computed(() => isSupportedCombination(AppConfig().realm, AppConfig().language)),
      leagueId: computed<string | undefined>({
        get: () => leagues.selectedId.value,
        set: (id) => { leagues.selectedId.value = id }
      }),
      parsePasted () {
        if (pasteText.value.trim()) {
          advancedCheck.value = false
          void load(pasteText.value.replace(/\r\n/g, '\n').trimEnd() + '\n')
        }
      },
      reset () {
        parsed.value = null
        pasteText.value = ''
      },
      openCaptcha () {
        void Host.openCaptcha(`https://${REALMS[AppConfig().realm].host}${TRADE_PATHS[AppConfig().game].web}`)
      }
    }
  }
})
</script>

<!--
  exile-appraiser: 三段 style 決定層疊順序:Tailwind preflight → 主題(pobtools.css,蓋過 preflight 的
  html/body 字型、行高)→ Tailwind components/utilities(utility class 仍可蓋過 .btn 等主題元件)。
  html/body 底色、捲軸、.btn/.input/.card/.tab/.seg/.chip 等全域規則都在 pobtools.css;overlay 透明背景(html.ppz-overlay)也在那裡。
-->
<style lang="postcss">
@import url('@fortawesome/fontawesome-free/css/all.min.css');
@import url('animate.css/animate.css');
@import url('../assets/font.css');
@tailwind base;
</style>

<style>
@import url('../theme/pobtools.css');
</style>

<style lang="postcss">
@tailwind components;
@tailwind utilities;

.table-stripped tbody tr:nth-child(odd) {
  background: var(--surface-2);
}

#app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

#app.overlay-root {
  position: relative;
  width: 100vw;
  background: transparent;
}

.window-body {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-height: 0;
}

.layout-column {
  display: flex;
  flex-direction: column;
  height: 100%;
}

input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button {
  -webkit-appearance: none;
}

/* ---- 查價面板容器 ---- */
.price-panel {
  background: var(--surface-1);
  border-left: 3px solid var(--gold);
}
.price-panel.is-overlay {
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-float);
  overflow: hidden;
}

/* 標題列(PobTools TitleBar.svelte 的語彙,縮成面板寬) */
.titlebar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  /* 13px 時 34px,隨字級等比 */
  height: calc(var(--fs-base) + 21px);
  padding: 0 6px 0 10px;
  background: var(--surface-1);
  border-bottom: 1px solid var(--edge-0);
  user-select: none;
}
.titlebar .brand {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 600;
  letter-spacing: 0.05em;
  white-space: nowrap;
  margin-right: 2px;
}
.titlebar .mark {
  width: 10px;
  height: 10px;
  background: var(--gold);
  transform: rotate(45deg);
  border-radius: 2px;
  flex-shrink: 0;
}
.titlebar-center {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: center;
}
.league-select {
  max-width: 100%;
  min-width: 0;
  width: 11rem;
}
.titlebar .icon-btn {
  width: 24px;
  padding: 0;
  justify-content: center;
  color: var(--ink-1);
  font-size: var(--fs-md);
  line-height: 1;
}
.titlebar .icon-btn:hover:not(:disabled),
.titlebar .icon-btn.on {
  color: var(--ink-0);
}
.titlebar .icon-btn.on {
  background: var(--gold-soft);
}

/* 面板頂端細條:重載中(pulse)、失敗(--bad + 重試)、限流倒數(--warn) */
.strip {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
  padding: 2px 10px;
  font-size: var(--fs-2xs);
  color: var(--ink-2);
  background: var(--surface-2);
  border-bottom: 1px solid var(--edge-0);
}
.strip .grow {
  flex: 1;
  min-width: 0;
}
.strip.bad {
  color: var(--bad);
  background: color-mix(in srgb, var(--bad) 12%, var(--surface-1));
}
.strip.warn {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 12%, var(--surface-1));
}

/* 查價內容區(拆粉排行已移到設定視窗的分頁) */
.price-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.price-main {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* 貼上框(視窗模式 / 沒有物品時) */
.paste-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}
.paste-hint {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--fs-sm);
}
.paste-input {
  height: auto;
  padding: 8px 9px;
  resize: vertical;
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.raw-text {
  background: var(--surface-0);
  border: 1px solid var(--edge-0);
  border-radius: var(--radius-s);
  padding: 8px;
  font-size: var(--fs-2xs);
  color: var(--ink-1);
  white-space: pre-wrap;
  overflow-x: hidden;
  overflow-y: auto;
}

/* 底列:左「貼上另一件」,右(視窗模式)限流狀態鈕 */
.bottombar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 4px 8px;
  background: var(--surface-1);
  border-top: 1px solid var(--edge-0);
}
.bottombar .grow {
  flex: 1;
}

/* 設定視窗的外層:overlay = 全螢幕暗幕 + 置中;window / 預覽 = 填滿內容區 */
.settings-layer.is-overlay {
  position: absolute;
  inset: 0;
  z-index: 50; /* 在 OCR 徽章(40)之上、框選層(60)之下;查價面板此時已隱藏 */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: auto;
}
.settings-layer.is-window {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.settings-layer.is-window > .settings-window {
  flex: 1;
}

/* overlay:限流狀態鈕在面板外、疊在遊戲畫面上,要有實底才讀得到 */
.side-rate-limiter > .btn {
  background: var(--surface-1);
  border-color: var(--edge-1);
}
</style>
