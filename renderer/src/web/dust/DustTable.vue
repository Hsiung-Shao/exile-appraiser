<!--
  拆粉排行表(WP-B):表頭可點排序 + 虛擬捲動(做法同 regex/RegexList.vue:列高依字級算成整數 px、每列釘死,
  只畫可見範圍 ± OVERSCAN)。每列兩行(設定視窗窄版 / 上方分頁版面也要放得下):
    第一行 ★ 名稱(介面語言)| dust | 價格 | 效率(粗體,依選項指標)| 動作
    第二行 另一語言名稱 · 基底 · gold · 格數 · 催化劑註記 · 低信心 ⚠
  表格寬 ≥ 600px(設定視窗右側內容區,container query)時數值欄與間距放寬,名稱欄吃掉其餘寬度。
  動作:交易站 ↗(目前區服的 /trade/search,`?q=` 帶 name/type/ilvl/腐化/掛單時間;走 ../trade-site.ts 的 openTradeSite,
  與查價「交易」鈕同一條路 = 系統預設瀏覽器)、poe.ninja ↗(Host.openExternal)、隱藏 / 取消隱藏。
-->
<template>
  <section class="dust-table" data-dust="table">
    <div class="dt-head" role="row">
      <span />
      <span class="dt-name-h">
        <button class="dt-sort" :class="sortClass('name')" data-sort="name" @click="setSort('name')">{{ t('ppz.dust.col_name') }}</button>
        <button class="dt-sort" :class="sortClass('gold')" data-sort="gold" @click="setSort('gold')">{{ t('ppz.dust.col_gold') }}</button>
      </span>
      <button class="dt-sort num-h" :class="sortClass('dust')" data-sort="dust" @click="setSort('dust')">{{ t('ppz.dust.col_dust') }}</button>
      <button class="dt-sort num-h" :class="sortClass('price')" data-sort="price" @click="setSort('price')">{{ t('ppz.dust.col_price') }}</button>
      <button class="dt-sort num-h" :class="sortClass('metric')" data-sort="metric" :title="t(`ppz.dust.metric_${metricId}_tip`)"
        @click="setSort('metric')">{{ t(`ppz.dust.metric_${metricId}`) }}</button>
      <span class="dt-act-h">{{ t('ppz.dust.col_actions') }}</span>
    </div>

    <div ref="scroller" class="dt-rows" data-dust="rows" :data-count="rows.length" :data-last-trade-url="lastTradeUrl" @scroll="onScroll">
      <div v-if="!rows.length" class="dt-empty">{{ t('ppz.dust.empty') }}</div>
      <div class="dt-spacer" :style="{ height: `${rows.length * rowH}px` }">
        <div v-for="w in windowRows" :key="w.r.key" class="dt-row" role="row"
          :class="{ marked: markedSet.has(w.r.key), hiddenrow: hiddenSet.has(w.r.key), noprice: w.r.noPrice }"
          :style="{ top: `${w.pos * rowH}px`, height: `${rowH}px` }"
          :data-key="w.r.key" :data-rank="w.pos + 1">
          <button class="dt-star" :class="{ on: markedSet.has(w.r.key) }" data-action="mark"
            :title="markedSet.has(w.r.key) ? t('ppz.dust.unmark') : t('ppz.dust.mark')"
            :aria-pressed="markedSet.has(w.r.key)" @click="toggleMark(w.r, 'marked')">{{ markedSet.has(w.r.key) ? '★' : '☆' }}</button>
          <span class="dt-name">
            <span class="dt-main" :title="mainName(w.r)">{{ mainName(w.r) }}</span>
            <span class="dt-sub">
              <span class="dt-other">{{ subLine(w.r) }}</span>
              <span v-if="w.r.goldFee !== undefined" class="dt-tag" data-field="gold">{{ t('ppz.dust.gold_n', { n: fmtInt(w.r.goldFee) }) }}</span>
              <span v-if="w.r.catalyst.used" class="dt-tag cat" data-field="catalyst"
                :title="t('ppz.dust.catalyst_used_tip', { name: w.r.catalyst.name, unit: fmtNum(w.r.catalyst.unitChaos ?? 0), cost: fmtNum(w.r.catalyst.costChaos) })">
                {{ t('ppz.dust.catalyst_used') }}</span>
              <span v-else-if="w.r.catalyst.reason === 'q0-better'" class="dt-tag dim" data-field="catalyst"
                :title="t('ppz.dust.catalyst_skip_tip', { name: w.r.catalyst.name, unit: fmtNum(w.r.catalyst.unitChaos ?? 0) })">{{ t('ppz.dust.catalyst_skip') }}</span>
              <span v-if="w.r.inherentInfluences" class="dt-tag" data-field="inherent-influence"
                :title="t('ppz.dust.inherent_inf_tip', { n: w.r.inherentInfluences })">{{ t('ppz.dust.inherent_inf', { n: w.r.inherentInfluences }) }}</span>
              <span v-if="w.r.lowConfidence" class="dt-tag warn" data-field="low-confidence"
                :title="t('ppz.dust.low_conf_tip', { n: w.r.price?.n ?? 0 })">⚠ {{ t('ppz.dust.low_conf', { n: w.r.price?.n ?? 0 }) }}</span>
            </span>
          </span>
          <span class="dt-num num" data-field="dust" :title="w.r.quality ? t('ppz.dust.dust_q_tip', { q: w.r.quality }) : undefined">
            {{ fmtInt(w.r.dust) }}<sup v-if="w.r.quality" class="dt-q">q{{ w.r.quality }}</sup>
          </span>
          <span class="dt-num num" data-field="price">
            <template v-if="w.r.price">{{ priceText(w.r.price.c) }}</template>
            <span v-else class="dim">{{ t('ppz.dust.no_price') }}</span>
          </span>
          <span class="dt-num num dt-eff" data-field="eff">{{ w.r.metricValue !== undefined ? fmtEff(w.r.metricValue) : '—' }}</span>
          <span class="dt-act">
            <button class="btn ghost sm" data-action="trade" :title="t('ppz.dust.trade_tip')" @click="openTrade(w.r)">{{ t('ppz.dust.trade') }} ↗</button>
            <button class="btn ghost sm" data-action="ninja" :disabled="!hasNinja(w.r)" :title="t('ppz.dust.ninja_tip')"
              @click="openNinja(w.r)">ninja ↗</button>
            <button class="btn ghost sm" data-action="hide" :title="hiddenSet.has(w.r.key) ? t('ppz.dust.unhide') : t('ppz.dust.hide')"
              @click="toggleMark(w.r, 'hidden')">{{ hiddenSet.has(w.r.key) ? '◉' : '⊘' }}</button>
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, ref, shallowRef, watch, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RankedDust } from '@exile-appraiser/core/dust'
import { AppConfig } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import { displayRounding, usePoeninja } from '@/web/background/Prices'
import { openTradeSite } from '@/web/trade-site'
import { rafThrottle, windowEndIdx, windowStartIdx } from '../virtual-window'
import { useDustStore, type SortKey } from './store'

const OVERSCAN = 6

export default defineComponent({
  props: {
    rows: { type: Array as PropType<RankedDust[]>, required: true }
  },
  setup (props) {
    const { t } = useI18n()
    const store = useDustStore()
    const ninja = usePoeninja()
    const config = AppConfig()
    const scroller = ref<HTMLElement | null>(null)
    const scrollTop = shallowRef(0)
    const viewH = shallowRef(360)

    const uiEn = computed(() => config.uiLanguage === 'en')
    const locale = computed(() => uiEn.value ? 'en-US' : 'zh-TW')

    // 兩行:字級 × 1.45 各一行 + 上下 padding,釘死整數 px
    const rowH = computed(() => {
      const fs = config.fsBase || 13
      return Math.ceil(fs * 1.45) + Math.ceil((fs - 2) * 1.45) + 10
    })

    // 可視區間用整數索引:windowRows 只依賴 startIdx / endIdx,不直接依賴每像素都變的 scrollTop
    const startIdx = computed(() => windowStartIdx(scrollTop.value, rowH.value, OVERSCAN))
    const endIdx = computed(() => windowEndIdx(scrollTop.value, viewH.value, rowH.value, OVERSCAN, props.rows.length))
    const windowRows = computed(() => {
      const list = props.rows
      const out: Array<{ pos: number, r: RankedDust }> = []
      for (let pos = startIdx.value, end = endIdx.value; pos < end; pos++) out.push({ pos, r: list[pos] })
      return out
    })

    function measure () {
      const el = scroller.value
      if (!el) return
      viewH.value = el.clientHeight || 360
      scrollTop.value = el.scrollTop
    }
    // scroll 事件每幀最多處理一次(最後位置照樣處理到)
    const onScroll = rafThrottle(measure)
    let ro: ResizeObserver | null = null
    watch(scroller, (el) => {
      ro?.disconnect()
      if (!el) return
      ro = new ResizeObserver(measure)
      ro.observe(el)
      measure()
    })
    // 排序 / 篩選變了:回頂端
    watch(() => [store.sortKey.value, store.sortDesc.value, store.ui.options.metric, store.search.value], () => {
      if (scroller.value) scroller.value.scrollTop = 0
      scrollTop.value = 0
    })
    onBeforeUnmount(() => { ro?.disconnect(); onScroll.cancel() })

    // 依 locale 快取的 Intl.NumberFormat(輸出與 Number.prototype.toLocaleString(locale, options) 相同)
    const nfCache = new Map<string, Intl.NumberFormat>()
    function nf (loc: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
      const key = `${loc}|${options ? JSON.stringify(options) : ''}`
      let f = nfCache.get(key)
      if (!f) nfCache.set(key, f = new Intl.NumberFormat(loc, options))
      return f
    }
    function fmtInt (n: number): string {
      return nf(locale.value).format(Math.round(n))
    }
    function fmtNum (n: number): string {
      return displayRounding(n)
    }
    function fmtEff (n: number): string {
      if (n >= 100) return nf(locale.value).format(Math.round(n))
      if (n >= 1) return nf(locale.value, { maximumFractionDigits: 1 }).format(n)
      return nf(locale.value, { maximumSignificantDigits: 2 }).format(n)
    }
    function priceText (chaos: number): string {
      const v = ninja.autoCurrency(chaos)
      return v.currency === 'div'
        ? t('ppz.dust.price_div', { n: displayRounding(v.min, true) })
        : t('ppz.dust.price_chaos', { n: displayRounding(v.min) })
    }
    function mainName (r: RankedDust): string {
      return uiEn.value ? r.item.name : (r.item.nameZh ?? r.item.name)
    }
    function subLine (r: RankedDust): string {
      const other = uiEn.value ? r.item.nameZh : r.item.name
      const base = uiEn.value ? r.item.baseType : (r.item.baseZh ?? r.item.baseType)
      return other && other !== mainName(r) ? `${other} · ${base}` : base
    }
    function sortClass (key: SortKey) {
      return { on: store.sortKey.value === key, desc: store.sortKey.value === key && store.sortDesc.value, asc: store.sortKey.value === key && !store.sortDesc.value }
    }
    function openTrade (r: RankedDust) {
      const url = store.tradeUrl(r)
      store.lastTradeUrl.value = url
      console.log(`[dust] 交易站 ${url}`)
      // 與查價「交易」鈕同一條路(系統預設瀏覽器,使用者已登入);以前走 inject('builtin-browser') = Host.openCaptcha,
      // 會開一個沒有登入狀態的 Electron 視窗
      openTradeSite(url)
    }
    function openNinja (r: RankedDust) {
      const url = store.ninjaUrl(r)
      if (url) void Host.openExternal(url)
    }

    return {
      t,
      scroller,
      rowH,
      windowRows,
      onScroll,
      markedSet: store.markedSet,
      hiddenSet: store.hiddenSet,
      lastTradeUrl: store.lastTradeUrl,
      metricId: computed(() => store.ui.options.metric.replace(/\//g, '_')),
      setSort: store.setSort,
      sortClass,
      toggleMark: store.toggleMark,
      hasNinja: store.hasNinja,
      fmtInt,
      fmtNum,
      fmtEff,
      priceText,
      mainName,
      subLine,
      openTrade,
      openNinja
    }
  }
})
</script>

<style>
.dust-table {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  border: 1px solid var(--edge-0);
  border-radius: var(--radius-m);
  background: var(--surface-1);
  overflow: hidden;
  container-type: inline-size;
  container-name: dust-table;
}
.dust-table .dt-head,
.dust-table .dt-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 6.6em 4.6em 4.4em auto;
  align-items: center;
  column-gap: 6px;
  padding: 0 6px;
}
.dust-table .dt-head {
  flex-shrink: 0;
  min-height: 26px;
  border-bottom: 1px solid var(--edge-0);
  background: var(--surface-2);
  font-size: var(--fs-2xs);
  color: var(--ink-2);
}
.dust-table .dt-sort {
  appearance: none;
  border: 0;
  background: none;
  padding: 2px 0;
  color: var(--ink-2);
  font-size: var(--fs-2xs);
  letter-spacing: 0.04em;
  white-space: nowrap;
  cursor: pointer;
}
.dust-table .dt-sort:hover { color: var(--ink-0); }
.dust-table .dt-sort.on { color: var(--gold); }
.dust-table .dt-sort.on.desc::after { content: ' ▾'; }
.dust-table .dt-sort.on.asc::after { content: ' ▴'; }
.dust-table .num-h { text-align: right; }
.dust-table .dt-name-h { display: flex; gap: 10px; }
.dust-table .dt-act-h { text-align: right; padding-right: 4px; }
.dust-table .dt-rows {
  position: relative;
  flex: 1;
  min-height: 80px;
  overflow-y: auto;
}
.dust-table .dt-spacer { position: relative; }
.dust-table .dt-empty {
  padding: 16px;
  color: var(--ink-3);
  font-size: var(--fs-sm);
}
.dust-table .dt-row {
  position: absolute;
  left: 0;
  right: 0;
  box-sizing: border-box;
  border-bottom: 1px solid var(--edge-0);
}
.dust-table .dt-row:hover { background: var(--surface-hover); }
.dust-table .dt-row.marked { background: var(--gold-soft); }
.dust-table .dt-row.hiddenrow { opacity: var(--dim-opacity); }
.dust-table .dt-star {
  appearance: none;
  border: 0;
  background: none;
  padding: 0;
  color: var(--ink-3);
  font-size: var(--fs-md);
  line-height: 1;
  cursor: pointer;
}
.dust-table .dt-star.on,
.dust-table .dt-star:hover { color: var(--gold); }
.dust-table .dt-name {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.45;
}
.dust-table .dt-main {
  color: var(--ink-0);
  font-size: var(--fs-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dust-table .dt-sub {
  display: flex;
  gap: 5px;
  min-width: 0;
  font-size: var(--fs-2xs);
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
}
.dust-table .dt-other {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 2em;
}
.dust-table .dt-tag { flex-shrink: 0; color: var(--ink-2); }
.dust-table .dt-tag.cat { color: var(--gold); }
.dust-table .dt-tag.warn { color: var(--warn); }
.dust-table .dt-num {
  text-align: right;
  font-size: var(--fs-xs);
  color: var(--ink-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dust-table .dt-q {
  margin-left: 1px;
  font-size: 0.7em;
  color: var(--gold);
}
.dust-table .dt-eff {
  font-weight: 700;
  color: var(--ink-0);
}
.dust-table .dt-row.noprice .dt-eff { color: var(--ink-3); font-weight: 400; }
.dust-table .dt-act {
  display: flex;
  justify-content: flex-end;
  gap: 1px;
}
.dust-table .dt-act .btn {
  padding: 0 4px;
}
/* 寬(設定視窗右側內容區):數值欄與間距放寬,名稱欄吃掉其餘寬度 */
@container dust-table (min-width: 600px) {
  .dust-table .dt-head,
  .dust-table .dt-row {
    grid-template-columns: 20px minmax(0, 1fr) 7em 5em 5em auto;
    column-gap: 10px;
    padding: 0 10px;
  }
  .dust-table .dt-sub { gap: 8px; }
  .dust-table .dt-act { gap: 2px; }
  .dust-table .dt-act .btn { padding: 0 6px; }
}
/* 窄(window 模式預設 480px 寬的設定視窗):數值欄與間距收緊,把寬度讓給名稱 */
@container dust-table (max-width: 479px) {
  .dust-table .dt-head,
  .dust-table .dt-row {
    grid-template-columns: 16px minmax(0, 1fr) 5.6em 3.9em 3.9em auto;
    column-gap: 4px;
    padding: 0 4px;
  }
  .dust-table .dt-act .btn { padding: 0 3px; }
}
</style>
