<!--
  exile-appraiser(WP-R2):PoE2 符文塑形面板自動查價的價格徽章層(只在 overlay 掛;與 OcrBadges 同級)。
  - 收 main 的 `runeshape-scan-result`(掃描迴圈 main/src/ocr/runeshape-scan.ts):`rows` → `@poe2-entry` 的 `matchRunesRows`
    (列格式 + 精確 / 模糊比對 + 類別優先序,docs/runeshape.md)→ 每列右側一枚徽章(面板外的列不畫);空結果(面板關了 / 停用 / 暫停)→ 清掉。
    模糊命中標「≈」;技能 / 輔助寶石 poe.ninja 沒有價格 →「無價格」;對不上 / 重名 →「?」。
  - 價格:`usePoeninja().priceOf(refName, level)`(poe.ninja,PoE2 exchange);收到列時 `queuePricesFetch()` 表示「有人在查價」。
    預設崇高石計價,≥ 1 神聖石改神聖石;數量 > 1 顯示「總價(單價 each)」;依總價(崇高石)三段顏色(設定 `runeshapeThresholds`)。
  - 台服:poe.ninja 沒有台服價格 → 徽章「無價格」+ 一次提示(可用下面的點選查交易站,原幣顯示)。
  - 平常 `pointer-events: none`;按住 Alt 時隨 App.vue 根元素 `hideUI` 隱藏。不送任何輸入。
  - 點選查交易站(docs/runeshape.md「點選查交易站」):overlayKey 叫出 overlay 且畫面上有徽章 → App.vue 設 `runeshapeClickMode`
    → 本層 `pointer-events: auto`、頂部提示;無 ninja 價且可查的徽章(`tradeKey`)顯示「查市集」,點下 → `@poe2-entry` `runeTradeStore.lookup`
    (帶與產物相符的篩選)→ 徽章「市 X」+ 旁邊卡片(使用的篩選、筆數、中位數 / 最低 / 最高、查詢時間、在交易站開啟)。
    Esc / 點空白處 → `Host.focusGame()`(overlay 失焦 → App.vue 關掉可點模式)。
-->
<template>
  <div v-if="active" ref="layerEl" class="rs-layer pob-dark" :class="{ interactive: clickMode }" data-runeshape-layer :data-runeshape-state="state"
    :data-click-mode="clickMode ? '1' : undefined" @click.self="onBackdropClick">
    <div v-if="clickMode" class="rs-hint" data-runeshape="click-hint" @click.stop>{{ t('ppz.runeshape.trade.hint') }}</div>
    <template v-if="state === 'rows'">
      <div v-for="b in badges" :key="b.key" class="rs-badge"
        :class="[`tier-${b.tier}`, `kind-${b.kind}`, b.noPrice ? `no-price-${b.noPrice}` : '', {
          clickable: clickMode && !!b.tradeKey, market: marketDisplay(b)?.headline != null, selected: clickMode && !!b.tradeKey && b.tradeKey === cardKey
        }]"
        data-runeshape="badge" :data-kind="b.kind" :data-tier="b.tier" :data-ref="b.refName" :data-no-price="b.noPrice"
        :data-approx="b.approx ? '1' : undefined" :data-trade="b.tradeKey ? (trades[b.tradeKey]?.state ?? 'idle') : undefined"
        :style="{ left: `${b.left}px`, top: `${b.top}px` }"
        :title="badgeTitle(b)"
        @click.stop="onBadgeClick(b)">
        <template v-if="b.tradeKey && trades[b.tradeKey]?.state === 'loading'">
          <span class="rs-mkt">{{ t('ppz.runeshape.trade.market_short') }}</span>{{ t('ppz.runeshape.trade.loading') }}
        </template>
        <template v-else-if="marketDisplay(b)?.headline != null">
          <span class="rs-mkt">{{ t('ppz.runeshape.trade.market_short') }}</span>
          <span class="rs-total">{{ marketDisplay(b)!.headline }}<span class="rs-unit">{{ unitText(marketDisplay(b)!) }}</span></span>
          <span v-if="!marketDisplay(b)!.isMedian" class="rs-lc" :title="t('ppz.runeshape.trade.few')">?</span>
        </template>
        <template v-else-if="b.kind === 'price'">
          <span v-if="b.approx" class="rs-approx" :title="t('ppz.runeshape.approx')">≈</span>
          <span class="rs-total">{{ b.total!.value }}<span class="rs-unit">{{ unitLabel(b.total!.unit) }}</span></span>
          <span v-if="b.each" class="rs-each">{{ t('ppz.runeshape.each', { qty: b.quantity, value: b.each.value, unit: unitLabel(b.each.unit) }) }}</span>
          <span v-if="b.lowConfidence" class="rs-lc" :title="t('ppz.runeshape.low_confidence')">?</span>
        </template>
        <template v-else-if="b.kind === 'loading'">…</template>
        <template v-else-if="b.kind === 'no-price'"><span v-if="b.approx" class="rs-approx" :title="t('ppz.runeshape.approx')">≈</span>{{ b.noPrice === 'recipe' ? t('ppz.runeshape.no_fixed_price') : t('ppz.runeshape.no_price') }}<span v-if="clickMode && b.tradeKey" class="rs-query">{{ trades[b.tradeKey]?.state === 'error' ? t('ppz.runeshape.trade.retry_short') : t('ppz.runeshape.trade.query_short') }}</span></template>
        <template v-else>?</template>
      </div>

      <div v-if="clickMode && card" class="rs-card" data-runeshape="trade-card" :data-trade="card.entry.state" :style="card.style" @click.stop>
        <header class="rs-card-head">
          <span class="rs-card-title">{{ card.title }}</span>
          <span v-if="card.sub" class="rs-card-sub">{{ card.sub }}</span>
          <span class="grow" />
          <button class="btn ghost sm icon-btn" :title="t('ppz.close')" :aria-label="t('ppz.close')" data-action="trade-card-close" @click="cardKey = null">✕</button>
        </header>

        <div v-if="card.entry.state === 'loading'" class="rs-card-status pulse" data-trade-status="loading">{{ t('ppz.runeshape.trade.loading_long') }}</div>
        <div v-else-if="card.entry.state === 'error'" class="rs-card-status bad" data-trade-status="error">{{ errorText(card.entry) }}</div>
        <template v-else-if="card.entry.state === 'done'">
          <div v-if="card.display?.headline != null" class="rs-card-price" data-trade-status="done">
            <span class="rs-card-label">{{ card.display.isMedian ? t('ppz.runeshape.trade.median') : t('ppz.runeshape.trade.lowest') }}</span>
            <span class="rs-card-value" data-trade-value>{{ card.display.headline }} {{ unitText(card.display) }}</span>
            <span v-if="!card.display.isMedian" class="rs-card-few">{{ t('ppz.runeshape.trade.few') }}</span>
          </div>
          <div v-else class="rs-card-status" data-trade-status="empty">{{ t('ppz.runeshape.trade.empty') }}</div>
          <div v-if="card.display?.min != null" class="rs-card-line">
            {{ t('ppz.runeshape.trade.range', { min: `${card.display.min.value} ${unitText(card.display.min)}`, max: `${card.display.max!.value} ${unitText(card.display.max!)}` }) }}
          </div>
          <div class="rs-card-line" data-trade-count>{{ t('ppz.runeshape.trade.count', { n: card.summary!.count, total: card.entry.raw.total }) }}</div>
          <div v-if="card.summary!.skipped" class="rs-card-line dim">{{ t('ppz.runeshape.trade.skipped', { n: card.summary!.skipped }) }}</div>
          <div v-if="!card.summary!.converted && card.summary!.count" class="rs-card-line dim" data-trade-raw-currency>{{ t('ppz.runeshape.trade.raw_currency') }}</div>
          <div v-if="card.entry.plan.levelAny" class="rs-card-line warn" data-trade-level-any>{{ t('ppz.runeshape.trade.level_any_note') }}</div>
          <div class="rs-card-line dim" data-trade-time>{{ t('ppz.runeshape.trade.time', { time: card.time }) }}<template v-if="card.entry.cached"> · {{ t('ppz.runeshape.trade.cached') }}</template></div>
        </template>

        <div class="rs-card-filters-title">{{ t('ppz.runeshape.trade.filters') }}</div>
        <dl class="rs-card-filters" data-trade-filters>
          <template v-for="f in card.filters" :key="f.id">
            <dt :data-filter="f.id">{{ f.label }}</dt>
            <dd :data-filter-value="f.id">{{ f.value }}</dd>
          </template>
        </dl>
        <div class="rs-card-actions">
          <button class="btn sm primary" data-action="trade-open" @click="openSite(card.url)">{{ t('ppz.runeshape.trade.open') }} ↗</button>
        </div>
      </div>
    </template>
    <div v-if="toast" class="rs-toast" :class="toast.kind" data-runeshape="toast" :data-toast="toast.code">{{ toast.text }}</div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RuneshapeScanEvent } from '@ipc/types'
import * as Poe2 from '@poe2-entry'
import { AppConfig } from '../Config'
import { Host } from '../background/IPC'
import { usePoeninja } from '../background/Prices'
import { useLeagues } from '../background/Leagues'
import { loadedGame } from '../games/active'
import { openTradeSite } from '../trade-site'
import {
  formatRuneTrade, layoutRunePrices, placeTradeCard, recordScanTimings, runeTradeFilterLines, runeTradeToExalted, runeshapeBadgesShown, runeshapeClickMode,
  tradeCurrencyUnit, type MatchedRow, type PriceUnit, type RuneBadgeView, type RuneTradeDisplay
} from './runeshape-view'

const TOAST_MS = 2_500
/** 卡片估計大小(夾進視窗用) */
const CARD_W = 340
const CARD_H = 330

type State = 'idle' | 'rows'

type TradeEntry =
  | { state: 'loading', plan: Poe2.Poe2RuneTradePlan }
  | { state: 'done', plan: Poe2.Poe2RuneTradePlan, raw: Poe2.Poe2RuneTradeRaw, cached: boolean }
  | { state: 'error', plan: Poe2.Poe2RuneTradePlan, code: 'busy' | 'rate-limited' | 'failed', seconds?: number, message?: string }

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    const ninja = usePoeninja()
    const leagues = useLeagues()
    const state = shallowRef<State>('idle')
    const rows = shallowRef<MatchedRow[]>([])
    const client = shallowRef({ w: 0, h: 0 })
    const viewport = shallowRef({ w: window.innerWidth, h: window.innerHeight })
    const toast = shallowRef<{ code: string, text: string, kind: string } | null>(null)
    /** 點選查交易站的結果(鍵 = 查詢計畫 key;同一組篩選跨掃描共用) */
    const trades = shallowRef<Record<string, TradeEntry>>({})
    const cardKey = shallowRef<string | null>(null)
    let toastTimer: ReturnType<typeof setTimeout> | null = null
    /** 台服提示只在第一次有列時顯示一次(之後每秒一次的掃描不重複跳) */
    let twNoticeShown = false

    function showToast (code: string, text: string, kind = '', ms = TOAST_MS) {
      if (toastTimer) clearTimeout(toastTimer)
      toast.value = { code, text, kind }
      toastTimer = ms > 0 ? setTimeout(() => { toast.value = null }, ms) : null
    }

    function clear (reason: string) {
      if (state.value === 'idle') return
      state.value = 'idle'
      rows.value = []
      console.log(`[runeshape] 清除徽章(${reason})`)
    }

    function onEvent (e: RuneshapeScanEvent) {
      recordScanTimings(e)
      if (e.reason === 'user-paused') { clear('暫停'); showToast('paused', t('ppz.runeshape.paused')); return }
      if (e.reason === 'user-resumed') { showToast('resumed', t('ppz.runeshape.resumed')); return }
      if (!e.rows.length) { clear(e.reason); return }
      if (loadedGame.value !== 'poe2') return
      rows.value = Poe2.matchRunesRows(e.rows)
      client.value = e.client
      viewport.value = { w: window.innerWidth, h: window.innerHeight }
      state.value = 'rows'
      if (config.realm === 'tw') {
        // 台服沒有 poe.ninja:徽章照畫(無價格),可點選查台服交易站(原幣)
        if (!twNoticeShown) {
          twNoticeShown = true
          showToast('tw', t('ppz.runeshape.tw_no_source'), 'warn', 6_000)
        }
      } else {
        ninja.queuePricesFetch()
      }
      const matched = rows.value.filter(r => r.refName).length
      console.log(`[runeshape] ${e.rows.length} 列(對上 ${matched}):` + rows.value.map(r => r.refName ?? `?${r.text.replace(/\s+/g, '')}`).join(' | ').slice(0, 300))
    }

    const tradeOpts = () => {
      const league = leagues.selected.value?.id
      return league ? { realm: config.realm, language: config.language, league } : null
    }
    function planOf (r: MatchedRow) {
      const opts = tradeOpts()
      if (!opts || !r.kind) return null
      const p = Poe2.planRuneTradeQuery({ ...r, kind: r.kind }, opts)
      return p.ok ? p.plan : null
    }

    const badges = computed(() => {
      // 依賴:價格表(snapshot)、門檻、列、視窗大小、聯盟 / 區服(查詢計畫)
      void ninja.snapshot.value
      return layoutRunePrices(rows.value, ninja.priceOf, client.value, viewport.value, config.runeshapeThresholds, (r) => planOf(r)?.key)
    })
    watch(() => state.value === 'rows' && badges.value.length > 0, (v) => { runeshapeBadgesShown.value = v }, { immediate: true })

    const rates = computed(() => ({ exalted: ninja.exaltedRate.value, divine: ninja.xchgRate.value }))
    function summaryOf (raw: Poe2.Poe2RuneTradeRaw) {
      // 國際服:能換算就換成崇高石;台服沒有 poe.ninja 匯率 → 原幣
      return Poe2.summarizeRuneTrade(raw.listings, config.realm === 'intl' ? runeTradeToExalted(rates.value) : undefined)
    }
    function marketDisplay (b: RuneBadgeView): RuneTradeDisplay | null {
      const e = b.tradeKey ? trades.value[b.tradeKey] : undefined
      if (e?.state !== 'done') return null
      return formatRuneTrade(summaryOf(e.raw), rates.value)
    }

    function setTrade (key: string, e: TradeEntry) {
      trades.value = { ...trades.value, [key]: e }
    }

    async function onBadgeClick (b: RuneBadgeView) {
      if (!runeshapeClickMode.value || !b.tradeKey) return
      const row = rows.value[b.rowIndex]
      const plan = row ? planOf(row) : null
      if (!plan) return
      cardKey.value = plan.key
      const cur = trades.value[plan.key]
      if (cur?.state === 'loading') return
      // 已有結果且在快取期間內 → 只開卡片,不重查
      const hit = Poe2.runeTradeStore.cached(plan.key)
      if (cur?.state === 'done' && hit) return
      setTrade(plan.key, { state: 'loading', plan })
      console.log(`[runeshape] 查交易站 ${plan.mode} ${row.refName} filters=${JSON.stringify(plan.filters)}`)
      const out = await Poe2.runeTradeStore.lookup(plan)
      if (out.ok) {
        setTrade(plan.key, { state: 'done', plan, raw: out.raw, cached: out.cached })
        console.log(`[runeshape] 交易站 ${row.refName}:${out.raw.listings.length} 筆 / 共 ${out.raw.total}${out.cached ? '(快取)' : ''}`)
      } else {
        setTrade(plan.key, out.error === 'rate-limited'
          ? { state: 'error', plan, code: 'rate-limited', seconds: out.seconds }
          : out.error === 'failed' ? { state: 'error', plan, code: 'failed', message: out.message } : { state: 'error', plan, code: 'busy' })
        console.warn(`[runeshape] 交易站查詢失敗 ${row.refName}:${JSON.stringify(out)}`)
      }
    }

    /** 徽章欄最右緣(CSS px;畫完後量 DOM) */
    const layerEl = shallowRef<HTMLElement | null>(null)
    const badgeColumnRight = shallowRef(0)
    watch([badges, cardKey, runeshapeClickMode, trades], () => {
      const els = layerEl.value?.querySelectorAll<HTMLElement>('[data-runeshape="badge"]') ?? []
      let right = 0
      els.forEach((el) => { right = Math.max(right, el.getBoundingClientRect().right) })
      badgeColumnRight.value = Math.round(right)
    }, { flush: 'post' })

    const card = computed(() => {
      const key = cardKey.value
      if (!key) return null
      const entry = trades.value[key]
      const b = badges.value.find(x => x.tradeKey === key)
      if (!entry || !b) return null
      const row = rows.value[b.rowIndex]
      const summary = entry.state === 'done' ? summaryOf(entry.raw) : undefined
      // 放在徽章欄右側(不蓋住其他列的徽章);右邊放不下 → 面板左側
      const sx = client.value.w > 0 ? viewport.value.w / client.value.w : 1
      const { left, top } = placeTradeCard(
        { top: b.top, rowLeft: row ? row.x * sx : b.left, columnRight: Math.max(badgeColumnRight.value, b.left) },
        viewport.value, { w: CARD_W, h: CARD_H })
      return {
        entry,
        summary,
        display: summary ? formatRuneTrade(summary, rates.value) : undefined,
        title: row?.name ?? b.refName ?? '',
        sub: row?.name && row.name !== b.refName ? b.refName : undefined,
        filters: runeTradeFilterLines(entry.plan.filters, t),
        time: entry.state === 'done' ? new Date(entry.raw.at).toLocaleTimeString() : '',
        url: entry.state === 'done' ? entry.raw.webUrl : entry.plan.webUrl,
        style: { left: `${left}px`, top: `${top}px`, width: `${CARD_W}px` }
      }
    })

    function errorText (e: TradeEntry): string {
      if (e.state !== 'error') return ''
      if (e.code === 'rate-limited') return t('ppz.runeshape.trade.err_rate', { s: e.seconds ?? 0 })
      if (e.code === 'busy') return t('ppz.runeshape.trade.err_busy')
      return t('ppz.runeshape.trade.err_failed', { error: e.message ?? '' })
    }

    function exitClickMode (reason: string) {
      if (!runeshapeClickMode.value) return
      console.log(`[runeshape] 結束徽章可點模式(${reason})`)
      runeshapeClickMode.value = false
      Host.focusGame()
    }
    function onBackdropClick () {
      if (runeshapeClickMode.value) exitClickMode('點空白處')
    }
    function onKey (e: KeyboardEvent) {
      // overlay 模式的 Esc 通常先被 main 攔下(→ 焦點回遊戲 → App.vue 關掉可點模式);renderer 收得到時自己處理
      if (e.key !== 'Escape' || !runeshapeClickMode.value || e.defaultPrevented) return
      e.preventDefault()
      exitClickMode('Esc')
    }
    watch(runeshapeClickMode, (on) => {
      if (on) console.log(`[runeshape] 進入徽章可點模式(可查 ${badges.value.filter(b => b.tradeKey).length} 列)`)
      else cardKey.value = null
    })
    // 徽章沒了(面板關了 / 停用)→ 可點模式也沒意義
    watch(() => state.value, (s) => { if (s === 'idle') exitClickMode('徽章清除') })
    // 換區 / 聯盟 → 舊結果不適用
    watch(() => [config.realm, leagues.selected.value?.id], () => { trades.value = {}; cardKey.value = null })

    const unitLabel = (u: PriceUnit) => t(`ppz.runeshape.unit_${u}`)
    const unitText = (d: { unit: string, known: boolean }) => d.known ? unitLabel(d.unit as PriceUnit) : (tradeCurrencyUnit(d.unit) ? unitLabel(tradeCurrencyUnit(d.unit)!) : d.unit)
    /** tooltip:對不上 → OCR 原文;配方泛稱 → 英文名 + 為什麼沒有價格;其他 → 英文名 */
    const badgeTitle = (b: RuneBadgeView) =>
      b.kind === 'unmatched'
        ? t('ppz.runeshape.unmatched_title', { text: b.raw })
        : b.noPrice === 'recipe' ? t('ppz.runeshape.recipe_title', { name: b.refName }) : b.refName

    const onResize = () => { viewport.value = { w: window.innerWidth, h: window.innerHeight } }
    const unsub: Array<() => void> = []
    onMounted(() => {
      unsub.push(Host.onRuneshapeScanResult(onEvent))
      window.addEventListener('resize', onResize)
      window.addEventListener('keydown', onKey)
    })
    onUnmounted(() => {
      unsub.forEach(fn => fn())
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
      if (toastTimer) clearTimeout(toastTimer)
      runeshapeBadgesShown.value = false
    })

    return {
      t,
      state,
      badges,
      toast,
      trades,
      cardKey,
      card,
      layerEl,
      clickMode: runeshapeClickMode,
      unitLabel,
      unitText,
      badgeTitle,
      marketDisplay,
      errorText,
      onBadgeClick,
      onBackdropClick,
      openSite: (url: string) => openTradeSite(url),
      active: computed(() => state.value !== 'idle' || toast.value != null)
    }
  }
})
</script>

<style>
.rs-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 39;
  font-family: var(--font-ui);
}
/* 徽章可點模式:整層接住點擊(點空白處 = 回遊戲) */
.rs-layer.interactive { pointer-events: auto; }
.rs-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 14px;
  border-radius: 6px;
  border-left: 3px solid var(--c-cold);
  background: color-mix(in srgb, var(--surface-1-c) 95%, transparent);
  box-shadow: var(--shadow-float);
  color: var(--ink-0);
  font-size: var(--fs-sm);
  white-space: nowrap;
}
.rs-badge {
  position: absolute;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: baseline;
  gap: 0.45em;
  padding: 1px 7px;
  border-radius: 5px;
  border-left: 3px solid var(--ink-2);
  background: color-mix(in srgb, var(--surface-1-c) 92%, transparent);
  box-shadow: var(--shadow-float);
  color: var(--ink-0);
  font-size: var(--fs-sm);
  line-height: 1.4;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.rs-badge .rs-total { font-weight: 600; }
.rs-badge .rs-unit { margin-left: 0.2em; font-weight: 400; font-size: var(--fs-xs); color: var(--ink-1); }
.rs-badge .rs-each { font-size: var(--fs-xs); color: var(--ink-2); }
.rs-badge .rs-lc { font-size: var(--fs-xs); color: var(--warn); }
.rs-badge .rs-approx { margin-right: -0.25em; color: var(--warn); font-weight: 600; }
/* 三段顏色:低 = 暗、中 = 一般、高 = 金 */
.rs-badge.tier-low { color: var(--ink-2); border-left-color: var(--ink-4); background: color-mix(in srgb, var(--surface-1-c) 80%, transparent); }
.rs-badge.tier-mid { border-left-color: var(--accent); }
.rs-badge.tier-high { color: var(--gold); border-left-color: var(--gold); box-shadow: var(--shadow-float), 0 0 0 1px color-mix(in srgb, var(--gold) 45%, transparent); }
.rs-badge.tier-high .rs-unit { color: var(--gold); }
.rs-badge.kind-unmatched, .rs-badge.kind-no-price, .rs-badge.kind-loading { font-size: var(--fs-xs); color: var(--ink-2); }
/* 「無固定價格」(配方泛稱,本來就沒有單一價格)比「無價格」(有具體物品但價格表沒有)更淡、左框虛線,一眼分得出 */
.rs-badge.no-price-recipe { color: var(--ink-3); border-left-style: dashed; border-left-color: var(--ink-3); font-style: italic; }
/* 交易站市價:冷色左框 + 「市」字,與 poe.ninja 參考價區分 */
.rs-badge.market, .rs-badge[data-trade="loading"] {
  font-size: var(--fs-sm);
  color: var(--ink-0);
  border-left-color: var(--c-cold);
  background: color-mix(in srgb, var(--surface-1-c) 94%, transparent);
}
.rs-badge .rs-mkt {
  padding: 0 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--c-cold) 28%, transparent);
  color: var(--c-cold);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.rs-badge .rs-query {
  margin-left: 0.5em;
  padding: 0 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--c-cold) 22%, transparent);
  color: var(--c-cold);
  font-weight: 600;
}
.rs-badge.clickable { cursor: pointer; outline: 1px dashed color-mix(in srgb, var(--c-cold) 70%, transparent); outline-offset: 1px; }
.rs-badge.clickable:hover { background: color-mix(in srgb, var(--surface-2-c) 96%, transparent); }
.rs-badge.selected { outline-style: solid; outline-color: var(--c-cold); }
.rs-card {
  position: absolute;
  max-height: 80vh;
  overflow: auto;
  padding: 8px 10px 10px;
  border-radius: 6px;
  border-left: 3px solid var(--c-cold);
  background: color-mix(in srgb, var(--surface-1-c) 97%, transparent);
  box-shadow: var(--shadow-float);
  color: var(--ink-0);
  font-size: var(--fs-sm);
  line-height: 1.45;
  z-index: 1;
}
.rs-card-head { display: flex; align-items: baseline; gap: 0.5em; margin-bottom: 4px; }
.rs-card-head .grow { flex: 1; }
.rs-card-title { font-weight: 600; font-size: var(--fs-md); }
.rs-card-sub { color: var(--ink-2); font-size: var(--fs-xs); }
.rs-card-status { color: var(--ink-1); padding: 2px 0; }
.rs-card-status.bad { color: var(--bad); }
.rs-card-price { display: flex; align-items: baseline; gap: 0.5em; }
.rs-card-label { color: var(--ink-2); font-size: var(--fs-xs); }
.rs-card-value { font-size: var(--fs-lg); font-weight: 600; font-variant-numeric: tabular-nums; }
.rs-card-few { color: var(--warn); font-size: var(--fs-xs); }
.rs-card-line { font-size: var(--fs-xs); color: var(--ink-1); }
.rs-card-line.dim { color: var(--ink-2); }
.rs-card-line.warn { color: var(--warn); }
.rs-card-filters-title { margin-top: 6px; font-size: var(--fs-xs); color: var(--ink-2); border-top: 1px solid var(--edge-1); padding-top: 5px; }
.rs-card-filters { display: grid; grid-template-columns: max-content 1fr; gap: 1px 10px; margin: 2px 0 0; font-size: var(--fs-xs); }
.rs-card-filters dt { color: var(--ink-2); }
.rs-card-filters dd { margin: 0; color: var(--ink-0); overflow-wrap: anywhere; }
.rs-card-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
.rs-toast {
  position: absolute;
  top: 10%;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 6px;
  border-left: 3px solid var(--gold);
  background: color-mix(in srgb, var(--surface-1-c) 94%, transparent);
  box-shadow: var(--shadow-float);
  color: var(--ink-0);
  font-size: var(--fs-sm);
  max-width: min(46em, 90vw);
  text-align: center;
}
.rs-toast.warn { border-left-color: var(--warn); }
</style>
