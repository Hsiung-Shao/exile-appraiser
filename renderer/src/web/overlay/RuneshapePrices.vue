<!--
  exile-appraiser(WP-R2):PoE2 符文塑形面板自動查價的價格徽章層(只在 overlay 掛;與 OcrBadges 同級)。
  - 收 main 的 `runeshape-scan-result`(掃描迴圈 main/src/ocr/runeshape-scan.ts):`rows` → `@poe2-entry` 的 `matchRunesRows`
    (列格式 + 精確 / 模糊比對 + 類別優先序,docs/runeshape.md)→ 每列右側一枚徽章(面板外的列、「未發現」列不畫);
    空結果(面板關了 / 停用 / 暫停)→ 清掉,並清空尚未送出的市集查詢。
    模糊命中標「≈」;配方泛稱 →「無固定價格」;對不上 / 重名 →「?」。
  - 價格:`usePoeninja().priceOf(refName, level)`(poe.ninja,PoE2 exchange);收到列時 `queuePricesFetch()` 表示「有人在查價」。
    預設崇高石計價,≥ 1 神聖石改神聖石;數量 > 1 顯示「總價(單價 each)」;依總價(崇高石)三段顏色(設定 `runeshapeThresholds`)。
  - 自動查市集(docs/runeshape.md「自動查市集」):poe.ninja 沒有價格且可查的列(技能 / 輔助寶石、ninja 沒收錄的等級、台服全部)
    自動排進 `@poe2-entry` `createRuneTradeQueue`(單一佇列、同時一筆、30 分鐘快取;送出前限流預估要等就延後;
    查價面板 / 設定開著暫停(`runeshapeTradeHold`,App.vue 寫);一般查價收到 429 → 整個佇列暫停到期滿)。
    徽章:`市 …`(排隊中)→ `市 查詢中` → `市 80 崇高`(筆數 < 3 加「少」),後接關鍵篩選短字(`· L20` / `· 等級不限`);完整篩選寫進 log。
  - 台服:poe.ninja 沒有台服價格 → 全部走市集查詢(原幣顯示)+ 一次提示。
  - 整層 `pointer-events: none`(徽章不可點)。不送任何輸入。
  - 效能修正第 6 步:事件的列(+ client、遊戲、資料集世代)與目前畫著的相同 → 不重新比對 / 排版 / 印 log(`scan-dedupe.ts`;
    耗時紀錄與「有人在查價」照舊);每列的市集查詢計畫每次結果只算一次(`plans` computed)。
  - 第 11 步:徽章外觀(`config.ocrBadgeStyle`,與褻瀆徽章共用;`badge-style.ts`):根元素設 CSS 變數(字體 / 字級 / 粗體 /
    三段價格色 / 外框陰影),樣式寫 `var(--badge-x, 原值)`,預設不輸出變數 = 外觀不變。市集徽章(冷色左框)原本不吃三段色;第 20 步起已換算成崇高石的「有價格」市集徽章也依 主價 × 數量 分段(`mt-*`,見 runeshape-view.ts `runeTradeTier`)。
  - 第 18 步:main 的擷取會截到這一層(徽章 / 提示可能落在符文掃描區:手動框或自動定位外擴框)。DOM 更新後、paint 前把可見元素外框送 main 遮掉
    (`scan-mask.ts`);每個掃描事件處理完都帶它的 seq(ack)。
  - code review 第 C 批:掃描層接線改用共用的 `useScanLayer.ts`(與褻瀆層同一份):處理丟例外也 ack、遮罩追外觀 / 全域字級 /
    介面語言 + 每個子元素的 ResizeObserver(市集徽章文字、提示換語言寬度會變)。
-->
<template>
  <div v-if="active" ref="layer" class="rs-layer pob-dark" data-runeshape-layer :data-runeshape-state="state" :style="styleVars">
    <template v-if="state === 'rows'">
      <div v-for="b in badges" :key="b.key" class="rs-badge"
        :class="[`tier-${b.tier}`, `kind-${b.kind}`, b.noPrice ? `no-price-${b.noPrice}` : '', { market: !!b.tradeKey, [`trade-${marketOf(b)?.status}`]: !!b.tradeKey, [`mt-${marketOf(b)?.tier}`]: !!marketOf(b)?.tier }]"
        data-runeshape="badge" :data-kind="b.kind" :data-tier="b.tier" :data-ref="b.refName" :data-no-price="b.noPrice"
        :data-approx="b.approx ? '1' : undefined" :data-trade="b.tradeKey ? (marketOf(b)?.status ?? 'queued') : undefined"
        :data-trade-text="b.tradeKey ? marketOf(b)?.text : undefined" :data-market-tier="marketOf(b)?.tier"
        :style="{ left: `${b.left}px`, top: `${b.top}px` }"
        :title="badgeTitle(b)">
        <template v-if="b.tradeKey && marketOf(b)">
          <span v-if="b.approx" class="rs-approx" :title="t('ppz.runeshape.approx')">≈</span>
          <span class="rs-mkt">{{ t('ppz.runeshape.trade.market_short') }}</span>
          <template v-if="marketOf(b)!.status === 'price'">
            <span class="rs-total">{{ marketOf(b)!.value }}<span class="rs-unit">{{ marketOf(b)!.unit }}</span></span>
            <span v-if="marketOf(b)!.few" class="rs-few" :title="t('ppz.runeshape.trade.few')">{{ t('ppz.runeshape.trade.few_short') }}</span>
          </template>
          <span v-else class="rs-mkt-state">{{ marketWord(marketOf(b)!.status) }}</span>
          <span v-if="marketOf(b)!.short" class="rs-short">· {{ marketOf(b)!.short }}</span>
        </template>
        <template v-else-if="b.kind === 'price'">
          <span v-if="b.approx" class="rs-approx" :title="t('ppz.runeshape.approx')">≈</span>
          <span class="rs-total">{{ b.total!.value }}<span class="rs-unit">{{ unitLabel(b.total!.unit) }}</span></span>
          <span v-if="b.each" class="rs-each">{{ t('ppz.runeshape.each', { qty: b.quantity, value: b.each.value, unit: unitLabel(b.each.unit) }) }}</span>
          <span v-if="b.lowConfidence" class="rs-lc" :title="t('ppz.runeshape.low_confidence')">?</span>
        </template>
        <template v-else-if="b.kind === 'loading'">…</template>
        <template v-else-if="b.kind === 'no-price'"><span v-if="b.approx" class="rs-approx" :title="t('ppz.runeshape.approx')">≈</span>{{ b.noPrice === 'recipe' ? t('ppz.runeshape.no_fixed_price') : t('ppz.runeshape.no_price') }}</template>
        <template v-else>?</template>
      </div>
    </template>
    <div v-if="toast" class="rs-toast" :class="toast.kind" data-runeshape="toast" :data-toast="toast.code">{{ toast.text }}</div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, shallowRef, triggerRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RuneshapeScanEvent } from '@ipc/types'
import * as Poe2 from '@poe2-entry'
import { AppConfig } from '../Config'
import { Host } from '../background/IPC'
import { usePoeninja } from '../background/Prices'
import { useLeagues } from '../background/Leagues'
import { loadedGame } from '../games/active'
import {
  formatRuneTrade, layoutRunePrices, recordScanTimings, runeTradeBadge, runeTradeTier, runeTradeToExalted, runeshapeTradeHold,
  type MatchedRow, type PriceUnit, type RuneBadgeView, type RuneTradeBadge, type RuneTradeBadgeStatus
} from './runeshape-view'
import { dataGeneration, scanResultKey } from './scan-dedupe'
import { badgeStyleVars } from './badge-style'
import { useScanLayer } from './useScanLayer'

const TOAST_MS = 2_500

type State = 'idle' | 'rows'

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
    /** 自動查市集的狀態(鍵 = 查詢計畫 key;同一組篩選跨掃描共用;佇列 onChange 寫) */
    const trades = shallowRef<Record<string, Poe2.Poe2RuneTradeEntry>>({})
    let toastTimer: ReturnType<typeof setTimeout> | null = null
    /** 台服提示只在第一次有列時顯示一次(之後每秒一次的掃描不重複跳) */
    let twNoticeShown = false

    // 佇列自己打的請求用原始 http(不含 withRetryAfter 的等待重試):收到 429 → 整個佇列暫停,不在背景睡著等
    const queue = Poe2.createRuneTradeQueue({
      ctx: () => ({
        http: Poe2.withRuneTrade429(async (url, init) => await Host.proxy(url, init)),
        realm: config.realm,
        latencySeconds: config.priceCheck.apiLatencySeconds,
        accountName: config.accountName
      }),
      held: () => runeshapeTradeHold.value,
      onChange: (key, e) => {
        // 只更新變動的鍵,再 triggerRef 通知(讀取端只有 computed 讀 trades.value[key],與換新物件等價)
        if (e) trades.value[key] = e
        else delete trades.value[key]
        triggerRef(trades)
      }
    })

    function showToast (code: string, text: string, kind = '', ms = TOAST_MS) {
      if (toastTimer) clearTimeout(toastTimer)
      toast.value = { code, text, kind }
      toastTimer = ms > 0 ? setTimeout(() => { toast.value = null }, ms) : null
    }

    function clear (reason: string) {
      // 面板消失:尚未送出的市集查詢不再需要(快取保留)
      queue.clearPending()
      gate.reset()
      if (state.value === 'idle') return
      state.value = 'idle'
      rows.value = []
      console.log(`[runeshape] 清除徽章(${reason})`)
    }

    function handleEvent (e: RuneshapeScanEvent) {
      recordScanTimings(e)
      if (e.reason === 'user-paused') { clear('暫停'); showToast('paused', t('ppz.runeshape.paused')); return }
      if (e.reason === 'user-resumed') { showToast('resumed', t('ppz.runeshape.resumed')); return }
      if (!e.rows.length) { clear(e.reason); return }
      if (loadedGame.value !== 'poe2') { resend.missed(); return }
      const key = scanResultKey(e.rows, e.client, `${loadedGame.value}|${dataGeneration.value}`)
      if (gate.repeat(key, state.value === 'rows')) {
        // 同一份列:徽章不變,只維持「有人在查價」(與原本每個事件都呼叫相同)
        if (config.realm !== 'tw') ninja.queuePricesFetch()
        return
      }
      gate.remember(key)
      rows.value = Poe2.matchRunesRows(e.rows)
      client.value = e.client
      viewport.value = { w: window.innerWidth, h: window.innerHeight }
      state.value = 'rows'
      if (config.realm === 'tw') {
        // 台服沒有 poe.ninja:徽章照畫,全部自動查台服交易站(原幣)
        if (!twNoticeShown) {
          twNoticeShown = true
          showToast('tw', t('ppz.runeshape.tw_no_source'), 'warn', 6_000)
        }
      } else {
        ninja.queuePricesFetch()
      }
      const matched = rows.value.filter(r => r.refName).length
      console.log(`[runeshape] ${e.rows.length} 列(對上 ${matched}):` + rows.value.map(r => r.undiscovered ? '(未發現)' : (r.refName ?? `?${r.text.replace(/\s+/g, '')}`)).join(' | ').slice(0, 300))
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
    /** 每列的查詢計畫(依賴:列、聯盟 / 區服 / 語言);排版、排隊、市集徽章共用,每次結果每列只算一次 */
    const plans = computed(() => {
      const m = new Map<MatchedRow, ReturnType<typeof planOf>>()
      for (const r of rows.value) m.set(r, planOf(r))
      return m
    })
    const planFor = (r: MatchedRow | undefined) => (r ? plans.value.get(r) ?? null : null)

    const badges = computed(() => {
      // 依賴:價格表(snapshot)、門檻、列、視窗大小、聯盟 / 區服(查詢計畫)
      void ninja.snapshot.value
      return layoutRunePrices(rows.value, ninja.priceOf, client.value, viewport.value, config.runeshapeThresholds, (r) => planFor(r)?.key)
    })

    // 無 ninja 價的可查列 → 由上而下排進佇列(同一組篩選已排 / 查過不重排)
    watch(badges, (bs) => {
      for (const b of bs) {
        if (!b.tradeKey) continue
        const row = rows.value[b.rowIndex]
        const plan = planFor(row)
        if (plan && queue.enqueue(plan)) console.log(`[runeshape] 市集排入 ${row.refName}(${row.name ?? ''})`)
      }
    })

    const rates = computed(() => ({ exalted: ninja.exaltedRate.value, divine: ninja.xchgRate.value }))
    /** 每枚徽章的市集顯示(沒有 tradeKey = null) */
    const markets = computed(() => {
      const out: Record<string, RuneTradeBadge> = {}
      for (const b of badges.value) {
        if (!b.tradeKey) continue
        const e = trades.value[b.tradeKey]
        const plan = e?.plan ?? planFor(rows.value[b.rowIndex])
        // 國際服:能換算就換成崇高石;台服沒有 poe.ninja 匯率 → 原幣
        const display = e?.state === 'done'
          ? formatRuneTrade(Poe2.summarizeRuneTrade(e.raw.listings, config.realm === 'intl' ? runeTradeToExalted(rates.value) : undefined), rates.value)
          : undefined
        const badge = runeTradeBadge(e, display, plan?.filters ?? [], t)
        // 第 20 步:市集價依崇高石等值 × 數量套三段色(原幣 / 非價格狀態 = 不分段)
        if (badge.status === 'price') badge.tier = runeTradeTier(display, b.quantity, config.runeshapeThresholds)
        out[b.key] = badge
      }
      return out
    })
    const marketOf = (b: RuneBadgeView): RuneTradeBadge | undefined => markets.value[b.key]
    const marketWord = (s: RuneTradeBadgeStatus) =>
      s === 'empty' ? t('ppz.runeshape.trade.empty_short') : s === 'failed' ? t('ppz.runeshape.trade.failed_short') : s === 'loading' ? t('ppz.runeshape.trade.loading') : '…'

    const styleVars = computed(() => badgeStyleVars(config.ocrBadgeStyle, 'rune'))
    /**
     * 掃描層共用接線(code review 第 C 批,useScanLayer.ts):遮罩回報 + ack(第 18 步)、與目前畫著的列相同的事件不重新比對(gate)、
     * 收到 rows 時資料沒載好 → 資料載好時請 main 重送(第 B 批,resend)。
     * 遮罩在畫面變了(狀態 / 徽章 / 市集文字 / 提示 / 外觀 / 全域字級 / 介面語言)或任何子元素尺寸變了時,於 paint 前重報。
     */
    const { layer, gate, resend } = useScanLayer<RuneshapeScanEvent>({
      source: 'rune',
      subscribe: cb => Host.onRuneshapeScanResult(cb),
      handleEvent,
      drawn: [state, badges, markets, toast, styleVars],
      showing: () => state.value !== 'idle'
    })

    // 查價面板 / 設定關掉 → 佇列立刻再試
    watch(runeshapeTradeHold, (h) => { if (!h) queue.kick() })
    // 一般查價收到 429(Retry-After 等待)→ 整個佇列暫停到期滿
    watch(() => Host.rateLimitWait.value, (w) => { if (w.seconds > 0) queue.pauseFor(w.seconds, '一般查價收到 429') })
    // 換區 / 聯盟 → 舊篩選的排隊項目不再需要
    watch(() => [config.realm, leagues.selected.value?.id], () => { queue.clearPending() })

    const unitLabel = (u: PriceUnit) => t(`ppz.runeshape.unit_${u}`)
    /** tooltip(平常點擊穿透,只在瀏覽器預覽有用):對不上 → OCR 原文;配方泛稱 → 英文名 + 為什麼沒有價格;其他 → 英文名 */
    const badgeTitle = (b: RuneBadgeView) =>
      b.kind === 'unmatched'
        ? t('ppz.runeshape.unmatched_title', { text: b.raw })
        : b.noPrice === 'recipe' ? t('ppz.runeshape.recipe_title', { name: b.refName }) : b.refName

    const onResize = () => { viewport.value = { w: window.innerWidth, h: window.innerHeight } }
    // 字型載入完成 → 徽章寬度可能變了:useScanLayer 重量一次(相同就不送)
    onMounted(() => { window.addEventListener('resize', onResize) })
    onUnmounted(() => {
      window.removeEventListener('resize', onResize)
      if (toastTimer) clearTimeout(toastTimer)
      queue.dispose()
    })

    return {
      t,
      layer,
      state,
      badges,
      toast,
      unitLabel,
      badgeTitle,
      marketOf,
      marketWord,
      styleVars,
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
  /* 第 11 步徽章外觀:變數沒設 = 原值(font-weight / text-shadow 沒設時 var() 無效 → 照舊繼承) */
  font-family: var(--badge-font, var(--font-ui));
  font-size: var(--badge-fs, var(--fs-sm));
  font-weight: var(--badge-weight);
  text-shadow: var(--badge-halo);
  line-height: 1.4;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.rs-badge .rs-total { font-weight: var(--badge-weight-strong, 600); }
.rs-badge .rs-unit { margin-left: 0.2em; font-weight: var(--badge-weight, 400); font-size: var(--badge-fs-xs, var(--fs-xs)); color: var(--ink-1); }
.rs-badge .rs-each { font-size: var(--badge-fs-xs, var(--fs-xs)); color: var(--ink-2); }
.rs-badge .rs-lc { font-size: var(--badge-fs-xs, var(--fs-xs)); color: var(--warn); }
.rs-badge .rs-approx { margin-right: -0.25em; color: var(--warn); font-weight: var(--badge-weight-strong, 600); }
/* 三段顏色:低 = 暗、中 = 一般、高 = 金 */
.rs-badge.tier-low { color: var(--ink-2); border-left-color: var(--ink-4); background: color-mix(in srgb, var(--surface-1-c) 80%, transparent); }
.rs-badge.tier-mid { border-left-color: var(--accent); }
.rs-badge.tier-high { color: var(--gold); border-left-color: var(--gold); box-shadow: var(--shadow-float), 0 0 0 1px color-mix(in srgb, var(--gold) 45%, transparent); }
.rs-badge.tier-high .rs-unit { color: var(--gold); }
/* 第 11 步:有價格的徽章三段色各自可設(`--badge-low/mid/high`,字色 + 左條);沒設 = 上面的原值。
   只套 kind-price:對不上「?」/ 無價格 / 載入中 / 市集徽章也帶 tier class,但不是價格分段,維持原樣 */
.rs-badge.kind-price.tier-low { color: var(--badge-low, var(--ink-2)); border-left-color: var(--badge-low, var(--ink-4)); }
.rs-badge.kind-price.tier-mid { color: var(--badge-mid, var(--ink-0)); border-left-color: var(--badge-mid, var(--accent)); }
.rs-badge.kind-price.tier-high { color: var(--badge-high, var(--gold)); border-left-color: var(--badge-high, var(--gold)); box-shadow: var(--shadow-float), 0 0 0 1px color-mix(in srgb, var(--badge-high, var(--gold)) 45%, transparent); }
.rs-badge.kind-price.tier-high .rs-unit { color: var(--badge-high, var(--gold)); }
.rs-badge.kind-unmatched, .rs-badge.kind-no-price, .rs-badge.kind-loading { font-size: var(--badge-fs-xs, var(--fs-xs)); color: var(--ink-2); }
/* 「無固定價格」(配方泛稱,本來就沒有單一價格)比「無價格」(有具體物品但價格表沒有)更淡、左框虛線,一眼分得出 */
.rs-badge.no-price-recipe { color: var(--ink-3); border-left-style: dashed; border-left-color: var(--ink-3); font-style: italic; }
/* 交易站市價:冷色左框 + 「市」字,與 poe.ninja 參考價區分 */
.rs-badge.market {
  font-size: var(--badge-fs, var(--fs-sm));
  color: var(--ink-0);
  border-left-color: var(--c-cold);
  background: color-mix(in srgb, var(--surface-1-c) 94%, transparent);
}
/* 排隊中 / 查詢中 / 沒有掛單 / 失敗:淡一點 */
.rs-badge.market.trade-queued, .rs-badge.market.trade-loading, .rs-badge.market.trade-empty, .rs-badge.market.trade-failed { color: var(--ink-2); font-size: var(--badge-fs-xs, var(--fs-xs)); }
/* 第 20 步:市集價已換算成崇高石 → 依 主價 × 數量 套同一組三段色(含 `--badge-low/mid/high`);左條 / 字色隨段,「市」小標仍是冷色 */
.rs-badge.market.mt-low { color: var(--badge-low, var(--ink-2)); border-left-color: var(--badge-low, var(--ink-4)); }
.rs-badge.market.mt-mid { color: var(--badge-mid, var(--ink-0)); border-left-color: var(--badge-mid, var(--accent)); }
.rs-badge.market.mt-high { color: var(--badge-high, var(--gold)); border-left-color: var(--badge-high, var(--gold)); box-shadow: var(--shadow-float), 0 0 0 1px color-mix(in srgb, var(--badge-high, var(--gold)) 45%, transparent); }
.rs-badge.market.mt-high .rs-unit { color: var(--badge-high, var(--gold)); }
.rs-badge.market.trade-loading .rs-mkt-state { animation: rs-pulse 1.2s ease-in-out infinite; }
@keyframes rs-pulse { 50% { opacity: 0.45; } }
.rs-badge .rs-mkt {
  padding: 0 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--c-cold) 28%, transparent);
  color: var(--c-cold);
  font-size: var(--badge-fs-xs, var(--fs-xs));
  font-weight: 600;
}
.rs-badge .rs-few {
  padding: 0 3px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--warn) 22%, transparent);
  color: var(--warn);
  font-size: var(--badge-fs-xs, var(--fs-xs));
  font-weight: 600;
}
.rs-badge .rs-short { font-size: var(--badge-fs-xs, var(--fs-xs)); color: var(--ink-2); }
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
