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
-->
<template>
  <div id="app" class="font-ui text-ink-0"
    :class="isOverlay ? 'overlay-root' : 'bg-surface-0'"
    :style="rootStyle">
    <div v-if="isOverlay" class="absolute inset-0" @click="handleBackgroundClick" />

    <div v-show="!isOverlay || panelShown"
      :class="isOverlay ? ['absolute', 'inset-0', 'flex', 'pointer-events-none', clickPosition === 'stash' ? 'flex-row' : 'flex-row-reverse'] : 'window-body'">
      <div v-if="isOverlay" class="layout-column shrink-0" style="width: var(--game-panel);" />

      <div id="price-window" class="layout-column min-h-0 price-panel"
        :class="isOverlay ? 'is-overlay shrink-0 pointer-events-auto' : 'is-window grow'"
        :style="isOverlay ? { width: `${panelWidth}px` } : undefined">
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
          <button class="btn ghost sm icon-btn" :class="{ on: showSettings }" :title="t('ppz.settings')" :aria-label="t('ppz.settings')"
            style="-webkit-app-region: no-drag;" data-action="settings" @click="showSettings = !showSettings">⚙</button>
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
        <div v-if="reportMessage && !showSettings" class="strip" :class="{ bad: reportMessage.bad }" data-strip="report">
          <span class="grow">{{ reportMessage.text }}</span>
        </div>

        <settings-panel v-if="showSettings" class="grow min-h-0" @close="showSettings = false" />

        <main v-else class="grow layout-column min-h-0 relative">
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
          <component :is="checkedItemComponent" v-else-if="parsed?.isOk() && leagueId && supported"
            :key="itemKey"
            :item="parsed.value" :advanced-check="advancedCheck" />

          <div v-if="!parsed" class="paste-area">
            <p class="paste-hint">{{ t('ppz.paste_hint', { hotkey: hotkeyLabel }) }}</p>
            <textarea v-model="pasteText" class="input paste-input" rows="10"
              :placeholder="t('ppz.paste_placeholder')" @keydown.ctrl.enter="parsePasted" />
            <div class="flex gap-2">
              <button class="btn primary" @click="parsePasted">{{ t('ppz.parse') }}</button>
            </div>
          </div>
        </main>

        <footer v-if="!showSettings && (parsed || !isOverlay)" class="bottombar">
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
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, provide, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Result } from 'neverthrow'
import type { ItemTextEvent } from '@ipc/types'
// 兩個遊戲各自的 parser / CheckedItem / RateLimiterState;依 loadedGame(資料已載入完成的遊戲)切換
import { parseClipboard, type ParsedItem } from '@/parser'
import CheckedItem from '@poe1/CheckedItem.vue'
import RateLimiterState from '@poe1/trade/RateLimiterState.vue'
import * as Poe2 from '@poe2-entry'
import { loadedGame } from './games/active'
import { TRADE_PATHS } from '@exile-appraiser/core/realm'
import UiErrorBox from '@/web/ui/UiErrorBox.vue'
import SettingsPanel from './settings/SettingsPanel.vue'
import { AppConfig } from './Config'
import { Host } from './background/IPC'
import { useLeagues } from './background/Leagues'
import { REALMS, isSupportedCombination } from '@exile-appraiser/core/realm'
import { reloadPhase, reloadError, retryReload } from './loadState'
import { reportIssue, copyIssueReport, reportStatus, type ReportContext } from './report'
import { settingsTab } from './settings/tabState'

/** APT 的面板寬 28.75rem(rem 當時 = 16px → 460px)。 */
const PANEL_WIDTH_EM = 28.75
/**
 * 舊字級 16px 對應新預設 fsBase 13(16 / 13 ≈ 1.23):面板寬 / 關閉距離乘上它,
 * fsBase 13 時維持原本 460px 的視覺寬度,並隨 fsBase 等比縮放。
 */
const LEGACY_FS_SCALE = 1.23

export default defineComponent({
  components: { UiErrorBox, SettingsPanel },
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
    const hideUI = shallowRef(false)
    const overlayActive = shallowRef(false)
    const winHeight = shallowRef(window.innerHeight)
    const copied = shallowRef(false)
    let copiedTimer: ReturnType<typeof setTimeout> | null = null
    /** 物品解析的時間(一鍵回報:之後送出的查詢才算這件的)。 */
    let loadedAt = 0
    /** 一鍵回報的結果提示(面板頂端細條,6 秒後消失)。 */
    const reportNotice = shallowRef<{ text: string, bad: boolean } | null>(null)
    let reportTimer: ReturnType<typeof setTimeout> | null = null

    // 上游元件用 inject('builtin-browser') 開交易站;本專案開內建瀏覽器視窗(與 fetch 共用 cookie)
    provide('builtin-browser', (url: string) => { void Host.openCaptcha(url) })

    function load (text: string) {
      rawText.value = text
      loadedAt = Date.now()
      reportNotice.value = null
      parsed.value = loadedGame.value === 'poe2' ? Poe2.parseClipboard(text) : parseClipboard(text)
      itemKey.value += 1
      const p = parsed.value
      console.log(`[app] 解析(${loadedGame.value}) ${p.isOk() ? `OK: ${p.value.info.name ?? ''} / ${p.value.info.refName ?? ''}` : `失敗: ${p.error}`}`)
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
      load(e.clipboard)
      if (isOverlay) {
        console.log(`[app] 面板顯示 side=${clickPosition.value} locked=${e.focusOverlay} overlay=${window.screenX},${window.screenY} ${window.innerWidth}x${window.innerHeight} gamePanel=${gamePanel.value}`)
      }
    }

    function hidePanel (reason: string) {
      if (!panelShown.value) return
      panelShown.value = false
      console.log(`[app] 面板隱藏(${reason})`)
    }

    const unsubscribers: Array<() => void> = []
    const onResize = () => { winHeight.value = window.innerHeight }
    const onFocus = () => { Host.usedRecently(Host.isElectron) }
    onMounted(() => {
      unsubscribers.push(Host.onItemText(handleItemText))
      // 托盤「設定」「關於」:main 已把視窗叫到前景(overlay:assertOverlayActive),這裡開設定到該分頁
      unsubscribers.push(Host.onOpenSettings(({ tab }) => {
        settingsTab.value = tab
        showSettings.value = true
        if (isOverlay) {
          panelShown.value = true
          advancedCheck.value = true
        }
        console.log(`[app] 托盤開啟設定 tab=${tab}`)
      }))
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
        unsubscribers.push(Host.onVisibility((e) => {
          hideUI.value = !e.isVisible
          console.log(`[app] visibility ${e.isVisible}`)
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
      // overlay 模式的 Escape 由 main 的 before-input-event 處理(→ 焦點回遊戲 → hide-on-blur)
      if (e.key === 'Escape' && !isOverlay) close()
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
      if (AppConfig().overlayBackgroundClose) {
        hidePanel('點背景')
        Host.focusGame()
      }
    }

    let waitTimer: ReturnType<typeof setInterval> | null = null
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
      itemKey,
      rateLimitWait,
      checkedItemComponent: computed(() => loadedGame.value === 'poe2' ? Poe2.CheckedItem : CheckedItem),
      rateLimiterComponent: computed(() => loadedGame.value === 'poe2' ? Poe2.RateLimiterState : RateLimiterState),
      panelShown,
      advancedCheck,
      clickPosition,
      close,
      handleBackgroundClick,
      panelWidth,
      rootStyle: computed(() => ({
        '--game-panel': `${gamePanel.value}px`,
        visibility: hideUI.value ? 'hidden' as const : undefined
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
          load(pasteText.value.replace(/\r\n/g, '\n').trimEnd() + '\n')
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

/* overlay:限流狀態鈕在面板外、疊在遊戲畫面上,要有實底才讀得到 */
.side-rate-limiter > .btn {
  background: var(--surface-1);
  border-color: var(--edge-1);
}
</style>
