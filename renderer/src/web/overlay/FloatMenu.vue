<!--
  2026-10-08:APT 式懸浮選單(使用者要求;設計稿 https://claude.ai/artifact/NWGyMPAi5f14ofJ3tA65Pp C 板)。
  overlay 模式按 overlayKey(沒有物品時)叫出,取代原本直接開設定;點「設定」才開設定視窗(設定開著時選單仍在最上層)。
  2026-10-15 改 A 版「指令面板」(設計稿 https://claude.ai/artifact/8G1wDzZxwYDtEMv3KU7U81 `FloatMenuA`,使用者採用;
  最近查價與聊天指令已移除):
  - 標題列:拖曳把手(pointer capture,放開才寫設定 `floatMenu` 比例;顯示時夾回畫面,float-menu-geom.ts)、名稱、
    聯盟切換(useLeagues;換聯盟 → Prices.ts 讀新聯盟快取 → 市況自動重讀)、精簡限流點(PoE1 交易站限流規則有無排隊 +
    429 Retry-After 倒數 `useRateLimitWait`;不嵌 RateLimiterState —— 它的彈出框往上會出畫面)、✕。
  - 搜尋框(onMounted 聚焦)+ 篩選膠囊 全部 / 書籤 / 辨識 / 工具;清單模型、篩選、鍵盤在 float-menu-items.ts
    (↑↓ / Home / End / Enter;1–9、← →、Tab 不攔;overlay 的 Esc 由 main 攔下 → 收起選單)。
  - 分組:市況(market-rate.ts,**只讀 poe.ninja 既有快照,不觸發上網**)→ 倉庫本頁價值(PoE1 讀 stash-value.ts 共用狀態,沒資料顯示佔位;PoE2 淡化)→
    自動辨識開關(FLOAT_MENU_TOGGLES,直接寫設定)→ 正則書籤(PoE1 / PoE2 切換、資料夾收合與快速面板共用、字串預覽、熱鍵;
    目前遊戲 = 貼進遊戲 `runRegexBookmark(…, 'menu')`,另一代 = 只複製 `copyRegexBookmark`;「前往正則 ↗」)→
    工具(設定 / 速查表展開 / 拆粉排行 → open-tab 'dust')。底部鍵盤提示。
  - 速查表:內建一張或使用者匯入(`sheet-pick` → userData/cheatsheets,設定 `cheatSheet`);縮圖 hover 暫時放大(點擊穿透),
    點一下釘住(✕ / Esc 關;釘住時可移動 / 調整大小,放開才寫 `cheatSheetZoom`)。
  - 收起:✕、點選單外(App.vue 背景)、Esc / 再按 overlayKey(main 交還焦點 → focus-change)。
  寬高上限 = 畫面減邊距(大字級不超出畫面)。尺寸只用 em / --fs-*。overlay 圖層回報(`menu`)在 App.vue。
-->
<template>
  <div ref="root" class="fm" :class="{ dragging }" :style="placeStyle" data-layer="float-menu" @pointerdown.stop>
    <div class="fm-head" :title="t('ppz.menu.drag')" data-menu="drag"
      @pointerdown="onDragStart" @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd">
      <svg class="fm-grip" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01" /></svg>
      <i class="mark" />
      <span class="fm-title">{{ t('ppz.menu.title') }}</span>
      <select class="fm-league" data-menu="league" :value="leagueValue" :disabled="!leagueList.length"
        :aria-label="t('ppz.menu.league')" :title="t('ppz.menu.league')" @change="onLeague(($event.target as HTMLSelectElement).value)">
        <option v-if="!leagueList.length" :value="leagueValue">{{ leagueValue || t('ppz.menu.league_none') }}</option>
        <option v-for="l in leagueList" :key="l.id" :value="l.id">{{ l.id }}</option>
      </select>
      <span class="fm-rate" data-menu="rate" :data-tone="rateDot.tone" :title="rateTitle" :aria-label="rateTitle">
        <i class="fm-rate-dot" />
        <span v-if="rateDot.text" class="num">{{ rateDot.text }}</span>
      </span>
      <button type="button" class="fm-x" :aria-label="t('ppz.menu.close')" :title="t('ppz.menu.close')" data-action="menu-close" @click="emit('close', '✕')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>

    <div class="fm-top">
      <label class="fm-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
        <input ref="searchEl" type="search" data-menu="search" :value="query" :placeholder="t('ppz.menu.search_placeholder')"
          :aria-label="t('ppz.menu.search')" spellcheck="false" autocomplete="off"
          @input="onInput(($event.target as HTMLInputElement).value)" @keydown="onSearchKey">
        <span v-if="overlayKey" class="fm-kbd num">{{ overlayKey }}</span>
      </label>
      <div class="fm-chips" role="group" :aria-label="t('ppz.menu.chips')">
        <button v-for="c in MENU_CHIPS" :key="c" type="button" class="fm-chip" :class="{ on: chip === c }" :aria-pressed="chip === c ? 'true' : 'false'"
          :data-chip="c" @click="setChip(c)">{{ t(CHIP_LABELS[c]) }}</button>
      </div>
    </div>

    <div class="fm-list" data-menu="list">
      <!-- 市況 / 倉庫本頁價值:資訊列,只在「全部」且沒搜尋時顯示 -->
      <section v-if="showInfo" class="fm-group" data-group="market">
        <div class="fm-grp">{{ t('ppz.menu.grp_market') }}</div>
        <div class="fm-row fm-info" data-menu="market" :data-state="market ? 'ok' : 'none'">
          <span class="fm-ic"><img :src="currencyIcon(config.game, 'divine')" alt=""></span>
          <span v-if="market" class="fm-main">
            <span class="fm-rate-line">1 {{ t('ppz.menu.cur_divine') }} = <b class="num">{{ market.text }}</b><img class="fm-cur" :src="currencyIcon(config.game, market.to)" alt="">{{ t(market.to === 'exa' ? 'ppz.menu.cur_exa' : 'ppz.menu.cur_chaos') }}</span>
            <span class="fm-sub">{{ t('ppz.menu.market_sub') }} <span v-if="market.change != null" class="fm-delta" :data-tone="market.tone">{{ changeText(market.change) }}</span></span>
          </span>
          <span v-else class="fm-main">
            <span>{{ t('ppz.menu.market_none') }}</span>
            <span class="fm-sub">{{ t(config.realm === 'tw' ? 'ppz.menu.market_none_tw' : 'ppz.menu.market_none_sub') }}</span>
          </span>
          <span v-if="market && market.points.length" class="fm-spark">
            <price-sparkline :points="market.points" :draw-min="market.drawMin" :draw-max="market.drawMax" :tone="market.tone" />
          </span>
        </div>
      </section>
      <section v-if="showInfo" class="fm-group" data-group="stash">
        <div class="fm-row fm-info" :class="{ off: stashOff }" data-menu="stash" :data-disabled="stashOff ? 'true' : 'false'">
          <span class="fm-ic">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg>
          </span>
          <span class="fm-main">
            <span>{{ t('ppz.menu.stash_title') }}</span>
            <span v-if="stashRow" class="fm-sub">{{ t('ppz.menu.stash_sub', { subtab: t(`ppz.stash.subtab_${stashRow.subtab}`), known: stashRow.known, unknown: stashRow.unknown }) }}</span>
            <span v-else class="fm-sub">{{ t(config.game !== 'poe1' ? 'ppz.menu.stash_poe2' : config.realm === 'tw' ? 'ppz.menu.stash_tw' : 'ppz.menu.stash_none') }}</span>
          </span>
          <span v-if="stashRow" class="fm-value num" data-menu="stash-value">{{ stashRow.chaos }} {{ t('ppz.stash.unit_c') }}<template v-if="stashRow.div"> ≈ {{ stashRow.div }} {{ t('ppz.stash.unit_div') }}</template></span>
          <span v-else class="fm-value num">—</span>
        </div>
      </section>

      <!-- 自動辨識開關(依目前遊戲) -->
      <section v-if="scanItems.length" class="fm-group" data-group="scan">
        <div class="fm-grp">{{ t('ppz.menu.grp_scan', { game: gameLabel(config.game) }) }}</div>
        <div class="fm-toggle-row">
          <button v-for="s in scanItems" :key="s.id" type="button" role="switch" class="fm-sw" :class="{ on: config[s.toggle!], sel: selId === s.id }"
            :aria-checked="config[s.toggle!] ? 'true' : 'false'" :data-toggle="s.toggle" :data-item="s.id" :data-sel="selId === s.id ? 'true' : undefined"
            @click="flip(s.toggle!)">
            <span class="fm-sw-track" aria-hidden="true"><span class="fm-sw-knob" /></span>
            <span class="fm-sw-label">{{ s.label }}</span>
            <span class="fm-sw-state">{{ t(config[s.toggle!] ? 'ppz.menu.on' : 'ppz.menu.off') }}</span>
          </button>
        </div>
      </section>

      <!-- 正則書籤 -->
      <section v-if="showBookmarks" class="fm-group" data-group="bookmarks">
        <div class="fm-grp">
          <span>{{ t('ppz.menu.bookmarks') }}</span>
          <span class="fm-fill" />
          <span class="fm-seg" role="group" :aria-label="t('ppz.menu.bm_game')">
            <button v-for="g in games" :key="g" type="button" :class="{ on: listGame === g }" :aria-pressed="listGame === g ? 'true' : 'false'"
              :data-game="g" @click="setListGame(g)">{{ gameLabel(g) }}</button>
          </span>
          <button type="button" class="fm-link" data-action="menu-goto-regex" @click="emit('open-tab', 'regex')">{{ t('ppz.menu.goto_regex') }} ↗</button>
        </div>
        <p class="fm-hint">{{ t(action === 'paste' ? 'ppz.menu.bm_hint_paste' : 'ppz.menu.bm_hint_copy') }}</p>
        <template v-if="bmGroups.length">
          <template v-for="g in bmGroups" :key="g.folder">
            <button v-if="grouped.headers" type="button" class="fm-folder" :aria-expanded="!g.collapsed ? 'true' : 'false'" data-menu="bm-folder" :data-folder="g.folder"
              @click="toggleFolder(g.folder, !g.collapsed)">
              <span class="fm-caret" aria-hidden="true">{{ g.collapsed ? '▸' : '▾' }}</span>
              <span class="fm-folder-name">{{ g.folder || t('ppz.regex.fd_uncategorized') }}</span>
              <span class="fm-count num">{{ g.items.length }}</span>
            </button>
            <template v-if="!g.collapsed">
              <button v-for="it in g.items" :key="it.id" type="button" class="fm-row fm-bm" :class="{ sel: selId === it.id }"
                :disabled="running" data-menu="bm-item" :data-bm="it.label" :data-item="it.id" :data-sel="selId === it.id ? 'true' : undefined"
                @click="runBookmark(it.index!)">
                <span class="fm-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg></span>
                <span class="fm-main">
                  <span class="fm-ellipsis">{{ it.label }}</span>
                  <span class="fm-q" :title="previews[previewKey(it.index!)] || undefined">{{ previews[previewKey(it.index!)] ?? '…' }}</span>
                </span>
                <span v-if="it.hotkey" class="fm-kbd num">{{ it.hotkey }}</span>
              </button>
            </template>
          </template>
        </template>
        <p v-else-if="!queryOn" class="fm-empty" data-menu="bm-empty">{{ t('ppz.menu.bm_empty', { game: gameLabel(listGame) }) }}</p>
      </section>

      <!-- 工具 -->
      <section v-if="toolItems.length" class="fm-group" data-group="tools">
        <div class="fm-grp">{{ t('ppz.menu.grp_tools') }}</div>
        <div class="fm-tools">
          <button v-for="x in toolItems" :key="x.id" type="button" class="fm-tool" :class="{ on: toolOn(x.tool!), sel: selId === x.id }"
            :aria-expanded="x.tool === 'sheet' ? (section === 'sheet' ? 'true' : 'false') : undefined"
            :data-action="'menu-' + x.tool" :data-item="x.id" :data-sel="selId === x.id ? 'true' : undefined" @click="runTool(x.tool!)">
            <svg v-if="x.tool === 'settings'" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>
            <svg v-else-if="x.tool === 'sheet'" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z" /></svg>
            <span>{{ x.label }}</span>
          </button>
        </div>

        <!-- 速查表(工具列展開) -->
        <div v-if="section === 'sheet'" class="fm-sheet" data-menu="sheet">
          <template v-if="sheetUrl && !sheetBroken">
            <button type="button" class="fm-thumb" :aria-label="t('ppz.menu.sheet_zoom')" data-action="sheet-pin"
              @mouseenter="peek = true" @mouseleave="peek = false" @click="pinned = true">
              <img :src="sheetUrl" alt="" @error="sheetBroken = true">
            </button>
            <p class="fm-hint">{{ t('ppz.menu.sheet_hover_hint') }}</p>
            <div class="fm-sheet-row">
              <span class="fm-sheet-name" data-menu="sheet-name">{{ sheet.builtin ? t('ppz.menu.sheet_builtin', { version: BUILTIN_CHEAT_SHEET.version }) : config.cheatSheet }}</span>
              <button v-if="canPick" type="button" class="btn sm" data-action="sheet-change" @click="pickSheet">{{ t('ppz.menu.sheet_change') }}</button>
              <button v-if="!sheet.builtin" type="button" class="btn ghost sm" data-action="sheet-remove" @click="removeSheet">{{ t('ppz.menu.sheet_remove') }}</button>
            </div>
          </template>
          <div v-else class="fm-sheet-empty" data-menu="sheet-empty">
            <div>{{ t('ppz.menu.sheet_failed') }}</div>
            <div class="fm-hint">{{ t(canPick ? 'ppz.menu.sheet_empty_sub' : 'ppz.menu.sheet_no_dialog') }}</div>
            <button v-if="canPick" type="button" class="btn sm primary" data-action="sheet-import" @click="pickSheet">{{ t('ppz.menu.sheet_import') }}</button>
            <button v-if="!sheet.builtin" type="button" class="btn ghost sm" data-action="sheet-remove" @click="removeSheet">{{ t('ppz.menu.sheet_remove') }}</button>
          </div>
        </div>
      </section>

      <p v-if="queryOn && !rows.length" class="fm-empty" data-menu="no-match">{{ t('ppz.menu.no_match', { q: query.trim() }) }}</p>
    </div>

    <p v-if="notice" class="fm-notice" data-menu="notice">{{ notice }}</p>

    <div class="fm-foot">
      <span><span class="fm-kbd">↑ ↓</span> {{ t('ppz.menu.foot_move') }}</span>
      <span><span class="fm-kbd">Enter</span> {{ t('ppz.menu.foot_run') }}</span>
      <span class="fm-fill" />
      <span><span class="fm-kbd">Esc</span> {{ t('ppz.menu.foot_close') }}</span>
    </div>
  </div>

  <!-- 速查表放大:hover = 暫時(點擊穿透),點縮圖 = 釘住(標題列 ✕);釘住時拖標題列移動、四邊 / 四角調整大小(放開才寫 cheatSheetZoom) -->
  <div v-if="zoomShown" class="fm-zoom" :class="{ pinned, dragging: zoomLive != null }" :style="zoomStyle" data-layer="sheet-zoom">
    <div class="fm-zoom-head" :class="{ movable: pinned }" data-menu="sheet-zoom-drag" @pointerdown="onZoomHeadDown">
      <span class="fm-zoom-title">{{ t('ppz.menu.sheet_title') }}</span>
      <span class="fm-hint">{{ t(pinned ? 'ppz.menu.sheet_pinned_hint' : 'ppz.menu.sheet_peek_hint') }}</span>
      <button v-if="pinned && config.cheatSheetZoom" type="button" class="fm-x" :aria-label="t('ppz.menu.sheet_reset_size')" :title="t('ppz.menu.sheet_reset_size')"
        data-action="sheet-zoom-reset" @click="resetZoomRect">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6" /><path d="M20 12a8 8 0 1 1-2.3-5.7L4 10" /></svg>
      </button>
      <button v-if="pinned" type="button" class="fm-x" :aria-label="t('ppz.menu.sheet_close')" data-action="sheet-unpin" @click="pinned = false; peek = false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
    <img class="fm-zoom-img" :src="sheetUrl ?? undefined" alt="" draggable="false">
    <template v-if="pinned">
      <div v-for="e in zoomEdges" :key="e" class="fm-rz" :class="'rz-' + e" :data-resize="e" :style="{ cursor: edgeCursor(e) }"
        @pointerdown="beginZoomDrag($event, e)" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RegexGame } from '@exile-appraiser/regex'
import type { NinjaSnapshot } from '@exile-appraiser/core/ninja'
import type { RateLimiter } from '@exile-appraiser/core/http/RateLimiter'
import type { SettingsTabId } from '@ipc/types'
import { tradeSession as poe1TradeSession } from '@poe1/trade/common'
import { poe2TradeSession } from '@poe2-entry'
import { AppConfig } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import { useLeagues } from '@/web/background/Leagues'
import { usePoeninja } from '@/web/background/Prices'
import { useRateLimitWait } from '@/web/background/rate-limit-wait'
import { currencyIcon } from '@/web/price-panel/currency-icon'
import PriceSparkline from '@/web/ui/PriceSparkline.vue'
import { bgImageUrl, normBgFile } from '@/web/useTheme'
import { bookmarkGroupsOf, gameLabel, setBookmarkFolderCollapsed, useRegexStore } from '@/web/regex/store'
import { copyRegexBookmark, quickRunning, runRegexBookmark } from '@/web/regex/quick'
import { sharedPreviewCache } from './float-menu-preview-shared'
import { quickNoticeKey } from '@/web/regex/quick-geom'
import { BUILTIN_CHEAT_SHEET, bookmarkActionFor, cheatSheetUrl, floatMenuPlace, floatMenuPosOf, sheetZoomRect, type FloatMenuToggleKey } from './float-menu-geom'
import { MENU_CHIPS, filterMenuItems, menuItemsOf, menuKey, menuRows, rateDotOf, type MenuChip, type MenuItem, type MenuTool } from './float-menu-items'
import { floatMenuChip, floatMenuQuery, floatMenuSection, floatMenuSel } from './float-menu-state'
import { marketRateOf } from './market-rate'
import { stashValue, stashValueText } from './stash-value'
import { RESIZE_EDGES, clampSettingsRect, createRectDrag, edgeCursor, isInteractiveTarget, type DragEdge, type SettingsWindowRect } from '@/web/settings/settings-window-geom'

defineProps<{ settingsOpen: boolean }>()
const emit = defineEmits<{
  (e: 'close', reason: string): void
  (e: 'settings'): void
  (e: 'pasted'): void
  (e: 'zoom', on: boolean): void
  /** 跳到設定的某一頁(「前往正則」2026-10-14、「拆粉排行」2026-10-15) */
  (e: 'open-tab', tab: SettingsTabId): void
}>()

const { t } = useI18n()
const config = AppConfig()
const store = useRegexStore()
const games: RegexGame[] = ['poe1', 'poe2']
const CHIP_LABELS: Record<MenuChip, string> = { all: 'ppz.menu.chip_all', bookmark: 'ppz.menu.chip_bookmark', scan: 'ppz.menu.chip_scan', tool: 'ppz.menu.chip_tool' }

const overlayKey = computed(() => config.overlayKey)

// ---- 標題列:聯盟 ----
const leagues = useLeagues()
const leagueList = computed(() => leagues.list.value)
const leagueValue = computed(() => config.leagueId ?? '')
function onLeague (id: string) {
  if (!id || id === config.leagueId) return
  leagues.selectedId.value = id
  console.log(`[menu] 聯盟 → ${id}`)
}

// ---- 標題列:精簡限流點 ----
// PoE1 交易站限流規則(core RateLimiter 沒有 Vue 響應式 → subscribe 推 tick;另每秒對齊一次,規則集合會被 adjustRateLimits 增刪)。
// PoE2 經 @poe2-entry 的 poe2TradeSession(2026-10-15 補匯出)。
const waitSeconds = useRateLimitWait()
const rateTick = shallowRef(0)
const rateSubs = new Map<RateLimiter, () => void>()
function liveLimiters (): RateLimiter[] {
  const l = config.game === 'poe2' ? poe2TradeSession(config.realm).limits : poe1TradeSession(config.realm).limits
  return [...l.SEARCH, ...l.EXCHANGE, ...l.FETCH]
}
function syncRateSubs () {
  const live = new Set(liveLimiters())
  for (const [rl, off] of rateSubs) if (!live.has(rl)) { off(); rateSubs.delete(rl) }
  for (const rl of live) if (!rateSubs.has(rl)) rateSubs.set(rl, rl.subscribe(() => { rateTick.value++ }))
}
watch(() => [config.game, config.realm], () => { syncRateSubs(); rateTick.value++ })
const rateDot = computed(() => {
  void rateTick.value
  return rateDotOf(liveLimiters().map(rl => ({ active: rl.stack.length, max: rl.max, queue: rl.queue.value })), waitSeconds.value)
})
const rateTitle = computed(() => rateDot.value.tone === 'wait' ? t('ppz.menu.rate_wait', { seconds: waitSeconds.value }) : t('ppz.menu.rate'))
let ratePoll: ReturnType<typeof setInterval> | null = null

// ---- 市況(只讀既有快照;換聯盟 / 遊戲時 Prices.ts 自己讀新目標的快取) ----
const ninja = usePoeninja()
const marketTarget = computed(() => {
  const l = leagues.selected.value
  return config.realm === 'intl' && l?.id && l.isPopular ? { game: config.game, league: l.id } : null
})
const market = computed(() => marketRateOf(ninja.snapshot.value as NinjaSnapshot | null, marketTarget.value))
/** 倉庫本頁價值(2026-10-15):倉庫疊層算好的整頁價值(stash-value.ts);PoE1 且疊層顯示中有數量才有 */
/** 倉庫列停用:不是 PoE1,或台服(倉庫價格只支援國際服,main 不掃描) */
const stashOff = computed(() => config.game !== 'poe1' || config.realm === 'tw')
const stashRow = computed(() => {
  const v = stashValue.value
  if (stashOff.value || !v) return null
  return { subtab: v.subtab, known: v.known, unknown: v.unknown, ...stashValueText(v) }
})
function changeText (n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

// ---- 清單模型 / 篩選 / 鍵盤 ----
const chip = floatMenuChip
const query = floatMenuQuery
const selId = floatMenuSel
const queryOn = computed(() => query.value.trim() !== '')
const listGame = shallowRef<RegexGame>(config.game)
const action = computed(() => bookmarkActionFor(listGame.value, config.game))
const grouped = computed(() => bookmarkGroupsOf(listGame.value, true))
const items = computed(() => menuItemsOf({ game: config.game, bookmarks: grouped.value, t }))
const filtered = computed(() => filterMenuItems(items.value, chip.value, query.value))
const rows = computed(() => menuRows(filtered.value, query.value))
const scanItems = computed(() => filtered.value.filter(i => i.kind === 'scan'))
const toolItems = computed(() => filtered.value.filter(i => i.kind === 'tool'))
const showInfo = computed(() => chip.value === 'all' && !queryOn.value)
const showBookmarks = computed(() => (chip.value === 'all' || chip.value === 'bookmark') && (!queryOn.value || filtered.value.some(i => i.kind === 'bookmark')))
/** 書籤依資料夾分組(只留篩選後的);搜尋中一律展開 */
const bmGroups = computed(() => {
  const byId = new Map(filtered.value.filter(i => i.kind === 'bookmark').map(i => [i.id, i]))
  return grouped.value.groups
    .map(g => ({
      folder: g.folder,
      collapsed: grouped.value.headers && g.collapsed && !queryOn.value,
      items: g.items.map(it => byId.get(`bm:${it.index}`)).filter((x): x is MenuItem => !!x)
    }))
    .filter(g => g.items.length)
})

function onInput (v: string) {
  query.value = v
  // 打字時預選第一列(Enter 直接執行最上面那個);清空 = 不選
  selId.value = queryOn.value ? (rows.value[0]?.id ?? null) : null
}
function setChip (c: MenuChip) {
  chip.value = c
  if (selId.value && !rows.value.some(r => r.id === selId.value)) selId.value = null
}
function onSearchKey (e: KeyboardEvent) {
  const list = rows.value
  const r = menuKey(e, list.length, list.findIndex(x => x.id === selId.value), !queryOn.value)
  if (!r) return
  e.preventDefault()
  const it = list[r.sel]
  selId.value = it.id
  if (r.run) { runItem(it); return }
  void nextTick(() => {
    const el = (root.value as (HTMLElement & { querySelector?: HTMLElement['querySelector'] }) | null)?.querySelector?.('[data-sel="true"]')
    el?.scrollIntoView?.({ block: 'nearest' })
  })
}
function runItem (it: MenuItem) {
  if (it.kind === 'scan' && it.toggle) flip(it.toggle)
  else if (it.kind === 'bookmark' && it.index != null) void runBookmark(it.index)
  else if (it.kind === 'tool' && it.tool) runTool(it.tool)
}

// ---- 辨識開關(直接寫設定,掃描開關立即送 main) ----
function flip (key: FloatMenuToggleKey) {
  config[key] = !config[key]
  console.log(`[menu] 開關 ${key} → ${config[key] ? '開' : '關'}`)
}

// ---- 工具 ----
const section = floatMenuSection
function toolOn (tool: MenuTool): boolean {
  return tool === 'sheet' && section.value === 'sheet'
}
function runTool (tool: MenuTool) {
  notice.value = ''
  if (tool === 'settings') emit('settings')
  else if (tool === 'dust') emit('open-tab', 'dust')
  else section.value = section.value === 'sheet' ? '' : 'sheet'
}

// ---- 位置 / 拖曳 ----
const root = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)
const view = reactive({ w: window.innerWidth, h: window.innerHeight })
const size = reactive({ w: 0, h: 0 })
const draft = shallowRef<{ left: number, top: number } | null>(null)
const dragging = shallowRef(false)
let grab = { dx: 0, dy: 0, id: -1 }

const place = computed(() => draft.value ?? floatMenuPlace(config.floatMenu, view, size))
const placeStyle = computed(() => ({ left: `${place.value.left}px`, top: `${place.value.top}px` }))

function onDragStart (e: PointerEvent) {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button, select')) return
  const p = place.value
  grab = { dx: e.clientX - p.left, dy: e.clientY - p.top, id: e.pointerId }
  dragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  e.preventDefault()
}
function onDragMove (e: PointerEvent) {
  if (!dragging.value || e.pointerId !== grab.id) return
  draft.value = floatMenuPlace({ x: (e.clientX - grab.dx) / Math.max(1, view.w), y: (e.clientY - grab.dy) / Math.max(1, view.h) }, view, size)
}
function onDragEnd (e: PointerEvent) {
  if (!dragging.value || e.pointerId !== grab.id) return
  dragging.value = false
  if (draft.value) config.floatMenu = floatMenuPosOf(draft.value, view, size)
  draft.value = null
}

let ro: ResizeObserver | null = null
const onResize = () => { view.w = window.innerWidth; view.h = window.innerHeight }

// ---- 正則書籤 ----
const running = quickRunning
const notice = shallowRef('')
const previews = reactive<Record<string, string>>({})
const previewKey = (index: number) => {
  const b = store.ui.bookmarks[index]
  return b ? `${b.game}|${b.page}|${b.name}|${b.keys.join(',')}|${b.mode}|${b.lang}` : `#${index}`
}

/** 看得見的書籤逐筆算字串預覽;算過的在模組層級快取(收起再叫出不重算),沒算過的每筆之間讓出主執行緒 */
const previewCache = sharedPreviewCache()
let previewRun = 0
async function loadPreviews () {
  const run = ++previewRun
  for (const g of bmGroups.value) {
    if (g.collapsed) continue
    for (const it of g.items) {
      const k = previewKey(it.index!)
      if (k in previews) continue
      const hit = previewCache.peek(it.index!)
      if (hit !== undefined) { previews[k] = hit; continue }
      const text = await previewCache.ensure(it.index!)
      if (run !== previewRun) return
      previews[k] = text
      await new Promise(r => setTimeout(r, 0))
      if (run !== previewRun) return
    }
  }
}
watch(bmGroups, () => { void loadPreviews() }, { immediate: true })

function setListGame (g: RegexGame) {
  listGame.value = g
  notice.value = ''
}
function toggleFolder (folder: string, collapse: boolean) {
  setBookmarkFolderCollapsed(listGame.value, folder, collapse)
}

async function runBookmark (index: number) {
  notice.value = ''
  const b = store.ui.bookmarks[index]
  if (!b) return
  if (action.value === 'paste') {
    const o = await runRegexBookmark(index, 'menu')
    if (o.pasted) { emit('pasted'); return }
    const key = quickNoticeKey(o)
    notice.value = key ? t(key) : ''
  } else {
    const o = await copyRegexBookmark(index)
    const key = quickNoticeKey(o)
    notice.value = key ? t(key) : ''
  }
}

// ---- 速查表 ----
const canPick = computed(() => Host.canPickSheet)
const sheetBroken = shallowRef(false)
// 有匯入的用使用者的(app://sheet/ / 預覽 sheet/),否則內建那張(renderer/public/cheatsheets/)
const sheet = computed(() => cheatSheetUrl(bgImageUrl(config.cheatSheet, { electron: Host.isElectron, preview: Host.isPreview, baseURI: document.baseURI }, 'sheet'), document.baseURI))
const sheetUrl = computed(() => sheet.value.url)
watch(() => config.cheatSheet, () => { sheetBroken.value = false })
const peek = shallowRef(false)
const pinned = shallowRef(false)
const zoomShown = computed(() => !!sheetUrl.value && !sheetBroken.value && section.value === 'sheet' && toolItems.value.some(x => x.tool === 'sheet') && (peek.value || pinned.value))
watch(zoomShown, (on) => { emit('zoom', on) })
// 放大框:拖曳中 = live;存過 = 記住的(夾回畫面);沒存 = 選單旁到畫面邊(sheetZoomRect)
const zoomLive = shallowRef<SettingsWindowRect | null>(null)
const zoomRect = computed<SettingsWindowRect>(() => {
  if (zoomLive.value) return zoomLive.value
  if (config.cheatSheetZoom) return clampSettingsRect(config.cheatSheetZoom, view)
  const r = sheetZoomRect({ ...place.value, w: size.w, h: size.h }, view)
  return { x: r.left, y: r.top, w: r.w, h: r.h }
})
const zoomStyle = computed(() => {
  const r = zoomRect.value
  return { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }
})
const zoomDrag = createRectDrag((r) => {
  config.cheatSheetZoom = r
  console.log(`[menu] 速查表大小 / 位置 → ${r.w}×${r.h} @ ${r.x},${r.y}`)
}, (r) => { zoomLive.value = r })
const zoomEdges = RESIZE_EDGES
let zoomDetach: (() => void) | null = null
function beginZoomDrag (e: PointerEvent, edge: DragEdge) {
  if (!pinned.value || e.button !== 0 || zoomDrag.active) return
  e.preventDefault()
  e.stopPropagation()
  const target = e.currentTarget as HTMLElement
  try { target.setPointerCapture(e.pointerId) } catch { /* 合成事件沒有對應的指標 */ }
  zoomDrag.start(edge, zoomRect.value, e.clientX, e.clientY, { w: view.w, h: view.h })
  const onMove = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) zoomDrag.move(ev.clientX, ev.clientY) }
  const onUp = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; cleanup(); zoomDrag.end(ev.clientX, ev.clientY) }
  const onCancel = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; cleanup(); zoomDrag.cancel() }
  const onLost = () => { if (!zoomDrag.active) return; cleanup(); zoomDrag.end() }
  function cleanup () {
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
    target.removeEventListener('pointercancel', onCancel)
    target.removeEventListener('lostpointercapture', onLost)
    zoomDetach = null
    try { target.releasePointerCapture(e.pointerId) } catch { /* 指標已被釋放 */ }
  }
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
  target.addEventListener('pointercancel', onCancel)
  target.addEventListener('lostpointercapture', onLost)
  zoomDetach = () => { cleanup(); zoomDrag.cancel() }
}
function onZoomHeadDown (e: PointerEvent) {
  if (!pinned.value || isInteractiveTarget(e.target as Element | null)) return
  beginZoomDrag(e, 'move')
}
function resetZoomRect () {
  config.cheatSheetZoom = null
  console.log('[menu] 速查表大小 / 位置還原為預設')
}

async function pickSheet () {
  const name = normBgFile(await Host.sheetPick())
  if (name) {
    config.cheatSheet = name
    sheetBroken.value = false
  }
}
function removeSheet () {
  config.cheatSheet = ''
  pinned.value = false
  peek.value = false
}

function onKey (e: KeyboardEvent) {
  if (e.key === 'Escape' && pinned.value) {
    pinned.value = false
    peek.value = false
    e.preventDefault()
    e.stopPropagation()
  }
}

onMounted(() => {
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKey, true)
  if (root.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      const r = root.value?.getBoundingClientRect()
      if (r) { size.w = r.width; size.h = r.height }
    })
    ro.observe(root.value)
  }
  syncRateSubs()
  ratePoll = setInterval(() => { syncRateSubs(); rateTick.value++ }, 1000)
  // 叫出就能打字搜尋(上次的字整段選取,直接打 = 取代)
  searchEl.value?.focus()
  searchEl.value?.select?.()
  console.log(`[menu] 開啟懸浮選單(${chip.value}${queryOn.value ? ` · 搜尋「${query.value.trim()}」` : ''})`)
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKey, true)
  ro?.disconnect()
  zoomDetach?.()
  if (ratePoll) clearInterval(ratePoll)
  for (const off of rateSubs.values()) off()
  rateSubs.clear()
  emit('zoom', false)
})

</script>

<style>
.fm {
  position: absolute;
  z-index: 56; /* 設定暗幕(50)、快速面板(55)之上,框選層(60)之下 */
  width: 25em;
  /* 字級上限放寬(40 時 25em ≈ 1000 px)→ 寬高都不超過畫面 */
  max-width: min(25em, calc(100vw - 8px));
  max-height: calc(100vh - 8px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  font-size: var(--fs-md);
  color: var(--ink-0);
  background: var(--surface-1);
  border: 1px solid var(--edge-1);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-float);
  pointer-events: auto;
  user-select: none;
}
.fm.dragging { opacity: 0.92; }
.fm-fill { flex: 1; }
.fm-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.45em;
  min-height: 2.9em;
  padding: 0.3em 0.4em 0.3em 0.7em;
  border-bottom: 1px solid var(--edge-0);
  cursor: move;
  touch-action: none;
}
.fm-grip { flex: none; width: 0.9em; height: 0.9em; fill: none; stroke: var(--ink-3); stroke-width: 3; stroke-linecap: round; }
.fm-head .mark {
  flex: none;
  display: inline-block;
  width: 0.55em;
  height: 0.55em;
  background: var(--gold);
  transform: rotate(45deg);
}
.fm-title { flex: 1; min-width: 0; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fm-league {
  font: inherit;
  font-size: var(--fs-xs);
  min-width: 0;
  max-width: 10em;
  height: 2em;
  padding: 0 0.6em;
  color: var(--ink-1);
  background: var(--surface-2);
  border: 1px solid var(--edge-1);
  border-radius: 999px;
  cursor: pointer;
  text-overflow: ellipsis;
}
.fm-league:disabled { cursor: default; opacity: 0.8; }
.fm-league:focus-visible { outline: 1px solid var(--gold); outline-offset: 1px; }
.fm-rate {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  height: 2em;
  padding: 0 0.6em;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--ink-1);
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
  cursor: default;
}
.fm-rate-dot { width: 0.55em; height: 0.55em; border-radius: 50%; background: var(--ok); }
.fm-rate[data-tone="busy"] .fm-rate-dot { background: var(--warn); }
.fm-rate[data-tone="wait"] .fm-rate-dot { background: var(--bad); }
.fm-rate[data-tone="wait"] { color: var(--bad); }
.fm-x {
  font: inherit;
  flex: none;
  width: 2em;
  height: 2em;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: var(--radius-s);
  color: var(--ink-2);
  cursor: pointer;
}
.fm-x:hover { background: var(--surface-hover); color: var(--ink-0); }
.fm-x svg { width: 1em; height: 1em; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }

.fm-top {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 0.6em;
  padding: 0.75em 0.75em 0.5em;
}
.fm-search {
  display: flex;
  align-items: center;
  gap: 0.6em;
  height: 2.9em;
  padding: 0 0.75em;
  border: 1px solid var(--edge-1);
  border-radius: var(--radius-l);
  background: var(--surface-0);
  cursor: text;
}
.fm-search:focus-within { border-color: var(--gold); box-shadow: 0 0 0 0.2em var(--gold-soft); }
.fm-search svg { flex: none; width: 1.1em; height: 1.1em; fill: none; stroke: var(--ink-2); stroke-width: 2; stroke-linecap: round; }
.fm-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ink-0);
  font: inherit;
  user-select: text;
}
.fm-search input::placeholder { color: var(--ink-3); }
.fm-search input::-webkit-search-cancel-button { cursor: pointer; }
.fm-kbd {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--ink-2);
  border: 1px solid var(--edge-1);
  border-radius: var(--radius-s);
  padding: 0.05em 0.45em;
  background: var(--surface-0);
  white-space: nowrap;
}
.fm-chips { display: flex; flex-wrap: wrap; gap: 0.4em; }
.fm-chip {
  font: inherit;
  font-size: var(--fs-sm);
  height: 2em;
  padding: 0 0.85em;
  border: 1px solid var(--edge-1);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}
.fm-chip:hover { color: var(--ink-0); }
.fm-chip.on { border-color: var(--gold); color: var(--ink-0); background: var(--gold-soft); }
.fm-chip:focus-visible { outline: 1px solid var(--gold); outline-offset: 1px; }

.fm-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 0 0.5em 0.5em;
}
.fm-group { display: flex; flex-direction: column; }
.fm-grp {
  display: flex;
  align-items: center;
  gap: 0.6em;
  padding: 0.75em 0.45em 0.3em;
  font-size: var(--fs-xs);
  font-weight: 700;
  color: var(--ink-2);
  letter-spacing: 0.04em;
}
.fm-row {
  font: inherit;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 0.75em;
  min-height: 3.3em;
  padding: 0.35em 0.75em;
  border: 0;
  border-radius: var(--radius-l);
  background: transparent;
  color: var(--ink-0);
  text-align: left;
}
button.fm-row { cursor: pointer; }
button.fm-row:hover:not(:disabled), .fm-row.sel { background: var(--surface-hover); }
.fm-row.sel { box-shadow: inset 0 0 0 1px var(--gold); }
.fm-row:disabled { opacity: 0.6; cursor: progress; }
.fm-info { cursor: default; }
.fm-info.off { opacity: 0.5; }
.fm-ic {
  flex: none;
  width: 2.3em;
  height: 2.3em;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-m);
  background: var(--surface-2);
  color: var(--ink-1);
}
.fm-ic img { width: 1.8em; height: 1.8em; }
.fm-ic svg, .fm-tool svg { width: 1.2em; height: 1.2em; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.fm-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.15em; }
.fm-rate-line { display: flex; align-items: center; gap: 0.3em; white-space: nowrap; }
.fm-rate-line b { font-family: var(--font-mono); }
.fm-cur { width: 1.4em; height: 1.4em; }
.fm-sub, .fm-q {
  font-size: var(--fs-xs);
  color: var(--ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fm-q { font-family: var(--font-mono); }
.fm-delta[data-tone="up"] { color: var(--ok); }
.fm-delta[data-tone="down"] { color: var(--bad); }
.fm-spark { flex: none; width: 4.9em; height: 1.7em; }
.fm-value { flex: none; font-weight: 700; color: var(--gold); font-family: var(--font-mono); }
.fm-ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 自動辨識開關 */
.fm-toggle-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45em;
  padding: 0 0.15em;
}
.fm-sw {
  font: inherit;
  display: flex;
  align-items: center;
  gap: 0.6em;
  min-width: 0;
  min-height: 3.3em;
  padding: 0 0.75em;
  color: var(--ink-0);
  background: var(--surface-2);
  border: 1px solid var(--edge-0);
  border-radius: var(--radius-l);
  cursor: pointer;
  text-align: left;
}
.fm-sw:hover { background: var(--surface-hover); }
.fm-sw.sel { box-shadow: inset 0 0 0 1px var(--gold); }
.fm-sw:focus-visible { outline: 1px solid var(--gold); outline-offset: 1px; }
.fm-sw-track {
  position: relative;
  flex: none;
  width: 2.3em;
  height: 1.4em;
  border-radius: 999px;
  background: var(--edge-2);
}
.fm-sw-knob {
  position: absolute;
  top: 50%;
  left: 0.15em;
  width: 1.1em;
  height: 1.1em;
  border-radius: 50%;
  background: var(--surface-0);
  transform: translateY(-50%);
}
.fm-sw.on .fm-sw-track { background: var(--gold); }
.fm-sw.on .fm-sw-knob { left: calc(100% - 1.25em); }
.fm-sw-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fm-sw-state { flex: none; color: var(--ink-3); font-size: var(--fs-xs); }
.fm-sw.on .fm-sw-state { color: var(--gold); font-weight: 700; }

/* 正則書籤 */
.fm-seg { display: inline-flex; border: 1px solid var(--edge-1); border-radius: var(--radius-m); overflow: hidden; }
.fm-seg button {
  font: inherit;
  font-weight: 700;
  height: 1.7em;
  padding: 0 0.75em;
  border: 0;
  background: var(--surface-2);
  color: var(--ink-2);
  cursor: pointer;
}
.fm-seg button.on { background: var(--gold); color: var(--surface-0-c); }
.fm-link {
  font: inherit;
  font-weight: 400;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--ink-1);
  cursor: pointer;
  white-space: nowrap;
}
.fm-link:hover { color: var(--ink-0); text-decoration: underline; }
.fm-hint {
  margin: 0;
  padding: 0 0.45em 0.25em;
  color: var(--ink-3);
  font-size: var(--fs-xs);
}
.fm-folder {
  font: inherit;
  display: flex;
  align-items: center;
  gap: 0.45em;
  min-height: 1.9em;
  padding: 0 0.75em;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: var(--fs-xs);
  text-align: left;
  cursor: pointer;
}
.fm-folder:hover { color: var(--ink-0); }
.fm-caret { width: 0.8em; color: var(--ink-3); }
.fm-folder-name { flex: 1; }
.fm-count { color: var(--ink-3); }
.fm-empty, .fm-notice {
  margin: 0;
  padding: 0.4em 0.75em;
  font-size: var(--fs-sm);
  color: var(--ink-2);
}
.fm-notice { flex: none; border-top: 1px solid var(--edge-0); color: var(--ok); }

/* 工具 */
.fm-tools { display: flex; gap: 0.45em; padding: 0 0.15em; }
.fm-tool {
  font: inherit;
  font-size: var(--fs-sm);
  flex: 1;
  min-width: 0;
  min-height: 3.3em;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45em;
  padding: 0 0.4em;
  border: 1px solid var(--edge-0);
  border-radius: var(--radius-l);
  background: var(--surface-2);
  color: var(--ink-1);
  cursor: pointer;
}
.fm-tool:hover { background: var(--surface-hover); color: var(--ink-0); }
.fm-tool.on { color: var(--gold); border-color: color-mix(in srgb, var(--gold) 60%, transparent); background: var(--gold-soft); }
.fm-tool.sel { box-shadow: inset 0 0 0 1px var(--gold); }
.fm-tool span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.fm-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 1em;
  min-height: 2.7em;
  padding: 0 1em;
  border-top: 1px solid var(--edge-0);
  background: var(--surface-0);
  font-size: var(--fs-xs);
  color: var(--ink-2);
  white-space: nowrap;
}

/* 速查表 */
.fm-sheet { display: flex; flex-direction: column; gap: 0.45em; padding: 0.6em 0.15em 0; }
.fm-sheet .fm-hint { padding: 0; }
.fm-thumb {
  padding: 0;
  height: 9.5em;
  border: 1px solid var(--edge-1);
  border-radius: var(--radius-m);
  background: var(--surface-0);
  overflow: hidden;
  cursor: zoom-in;
}
.fm-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.fm-sheet-row { display: flex; align-items: center; gap: 0.45em; }
.fm-sheet-name {
  flex: 1;
  min-width: 0;
  color: var(--ink-3);
  font-size: var(--fs-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fm-sheet-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5em;
  padding: 1.1em 0.7em;
  border: 1px dashed var(--edge-2);
  border-radius: var(--radius-m);
  text-align: center;
  color: var(--ink-1);
}
.fm-zoom {
  position: absolute;
  z-index: 57;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: var(--surface-0);
  border: 1px solid var(--edge-2);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-float);
  overflow: hidden;
  pointer-events: none; /* hover 暫時放大:不擋遊戲 */
}
.fm-zoom.pinned { pointer-events: auto; }
.fm-zoom-head {
  display: flex;
  align-items: center;
  gap: 0.6em;
  padding: 0.35em 0.35em 0.35em 0.8em;
  border-bottom: 1px solid var(--edge-0);
  background: var(--surface-1);
  font-size: var(--fs-md);
}
.fm-zoom-head.movable { cursor: move; touch-action: none; user-select: none; }
.fm-zoom.dragging { opacity: 0.94; }
.fm-zoom-title { font-weight: 600; }
/* 調整大小把手(只在釘住時;同設定視窗 .sw-rz) */
.fm-rz { position: absolute; z-index: 2; touch-action: none; }
.fm-rz.rz-n { top: 0; left: 12px; right: 12px; height: 6px; }
.fm-rz.rz-s { bottom: 0; left: 12px; right: 12px; height: 6px; }
.fm-rz.rz-w { left: 0; top: 12px; bottom: 12px; width: 6px; }
.fm-rz.rz-e { right: 0; top: 12px; bottom: 12px; width: 6px; }
.fm-rz.rz-nw { top: 0; left: 0; width: 12px; height: 12px; }
.fm-rz.rz-ne { top: 0; right: 0; width: 12px; height: 12px; }
.fm-rz.rz-sw { bottom: 0; left: 0; width: 12px; height: 12px; }
.fm-rz.rz-se { bottom: 0; right: 0; width: 12px; height: 12px; }
.fm-zoom-head .fm-hint { flex: 1; text-align: right; padding: 0; }
.fm-zoom-img { flex: 1; min-height: 0; width: 100%; object-fit: contain; }
</style>
