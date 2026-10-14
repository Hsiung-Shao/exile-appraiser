<!--
  PoE1 倉庫價格疊層(Stash-Ninja 式,參考 Exile-UI,MIT;只在 overlay 掛,與符文塑形徽章層同級、呈現照符文徽章)。
  - 收 main 的 `stash-scan-result`(main/src/ocr/stash-scan.ts:OCR 碎片頁子頁按鈕列 → 目前子頁 + 資料夾偏移):
    `show` → 固定版面(stash-data.ts)每格一枚徽章(stash-view.ts `layoutStashBadges`);`hide` → 清掉。
  - 徽章 = 名稱(辨識檢視,設定 `stashShowNames`)+ poe.ninja 單價(混沌石,≥ 1 神聖石改神聖石;三段顏色 `stashThresholds`,
    外觀變數 `config.ocrBadgeStyle` 與符文共用)。台服沒有 poe.ninja → 只顯示名稱,並提示一次。
  - 游標停在某格(main `stash-cursor`)→ 只留那一格、放大加全名,不蓋住遊戲說明框。
  - 整層 `pointer-events: none`。不送任何輸入。物品名稱只讀 repo 資料(版面上的 refName → cmn-Hant items.ndjson)。
  - 2026-10-15 倉庫價值:`show` 帶每格數量(main 讀格子左上角的堆疊數量)→ 徽章改顯示小計(單價 × 數量;三段色 / C・D 依小計),
    數量讀不到只顯示單價 +「?」;空格不畫;停格時明細卡(單價 / 數量 / 小計);倉庫面板底部「本頁價值」卡(總計 C、≈ D、已讀 / 未讀格數)
    並寫進共用狀態 `stash-value.ts`(懸浮選單讀)。`peek` → 格子徽章暫時收起(main 用乾淨畫面重讀被徽章蓋住的數字)。
    沒算進總價的格(數量讀不到 / 有數量但沒價格)徽章左側加警示色標記「?」/「無價」+ 虛線框,停格明細卡寫原因;
    本頁價值卡另有「數量以畫面辨識,可能讀錯」說明與未計入格數(使用者 2026-10-15 要求)。
  - 擷取遮罩:main 讀格子數量時會截到這一層 → 走共用掃描層 `useScanLayer`(source `stash`):DOM 更新後回報徽章外框,
    每個事件處理完帶 seq(ack),main 等 ack 才擷取下一張;蓋到數字的格 main 不讀(沿用舊值)。
-->
<template>
  <div v-if="active" ref="layer" class="st-layer pob-dark" data-stash-layer :data-stash-subtab="shown?.subtab" :data-stash-peek="peek ? 'true' : undefined" :style="styleVars">
    <div v-for="b in badges" :key="b.key" class="rs-badge st-badge"
      :class="[b.tier ? `ptier-${b.tier}` : '', `st-${b.status}`, { hovered: b.hovered, 'st-unknown': b.qtyUnknown, 'st-flagged': !!b.mark, 'st-detail': b.hovered && b.qty !== undefined }]"
      data-stash="badge" :data-ref="b.refName" :data-status="b.status" :data-qty="b.qty === undefined ? undefined : String(b.qty)"
      :style="{ left: `${b.left}px`, top: `${b.top}px`, maxWidth: b.hovered ? undefined : `${Math.max(b.width, 28)}px` }"
      :title="b.refName">
      <template v-if="b.hovered && b.qty !== undefined">
        <span class="st-name">{{ b.name }}</span>
        <span class="st-row" data-stash="unit-price"><span>{{ t('ppz.stash.qty_unit_price') }}</span><span class="num">{{ priceText(b.unitPrice, b.status) }}</span></span>
        <span class="st-row" data-stash="qty"><span>{{ t('ppz.stash.qty_count') }}</span><span class="num">{{ b.qty === null ? '?' : `× ${b.qty}` }}</span></span>
        <span class="st-row st-sub" data-stash="subtotal"><span>{{ t('ppz.stash.qty_subtotal') }}</span><span class="num">{{ b.subtotal ? priceText(b.subtotal, b.status) : '—' }}</span></span>
        <span v-if="b.mark" class="st-note" data-stash="note">{{ b.mark === 'qty-unknown' ? t('ppz.stash.qty_unknown') : t('ppz.stash.no_price_excluded') }}</span>
      </template>
      <template v-else>
        <span v-if="showNames || b.hovered" class="st-name">{{ b.name }}</span>
        <span v-if="b.price" class="rs-total"><span v-if="b.mark" class="st-mark" data-stash="mark" :data-mark="b.mark" :title="markTitle(b.mark)">{{ markText(b.mark) }}</span>{{ b.price.value }}<span class="rs-unit">{{ unitLabel(b.price.unit) }}</span><span v-if="!b.mark && b.lowConfidence" class="rs-lc" :title="t('ppz.runeshape.low_confidence')">?</span></span>
        <span v-else-if="b.mark" class="st-mark" data-stash="mark" :data-mark="b.mark" :title="markTitle(b.mark)">{{ markText(b.mark) }}</span>
        <span v-else-if="b.status === 'loading'" class="st-dim">…</span>
        <span v-else-if="b.status === 'no-price'" class="st-dim">?</span>
      </template>
    </div>
    <div v-if="card" class="st-value" data-stash="value" role="status" :style="{ left: `${card.left}px`, top: `${card.top}px`, maxWidth: `${card.maxWidth}px`, maxHeight: `${card.maxHeight}px` }">
      <span class="st-value-line">
        <span class="st-value-title">{{ t('ppz.stash.value_title') }}</span>
        <span class="st-value-total num" data-stash="value-total">{{ card.chaos }} {{ unitLabel('c') }}</span>
        <span v-if="card.div" class="st-value-div num" data-stash="value-div">≈ {{ card.div }} {{ unitLabel('div') }}</span>
        <span class="st-value-counts" data-stash="value-counts">{{ t('ppz.stash.value_counts', { known: card.known, unknown: card.unknown }) }}</span>
      </span>
      <span class="st-value-line st-value-sub">
        <span v-if="card.excluded" class="st-value-excluded" data-stash="value-excluded">{{ t('ppz.stash.value_excluded', { n: card.excluded, unknown: card.unknown, noPrice: card.noPrice }) }}</span>
        <span class="st-value-note" data-stash="value-note">{{ t('ppz.stash.value_note') }}</span>
      </span>
    </div>
    <div v-if="toast" class="rs-toast warn" data-stash="toast">{{ toast }}</div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StashScanEvent } from '@ipc/types'
import type { StashSubtab } from '../../../../core/src/stash/layout'
import { AppConfig } from '../Config'
import { Host } from '../background/IPC'
import { usePoeninja } from '../background/Prices'
import { loadedGame } from '../games/active'
import { badgeStyleVars } from './badge-style'
import { overlayLayers } from './overlay-content'
import { layoutStashBadges, stashPageValue, stashValueCardPos, type StashBadgeView, type StashPriceUnit } from './stash-view'
import { loadStashData, stashData } from './stash-data'
import { stashValue, stashValueText } from './stash-value'
import { useScanLayer } from './useScanLayer'

const TOAST_MS = 6_000

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    const ninja = usePoeninja()
    const shown = shallowRef<{ subtab: StashSubtab, yOffset: number, client: { w: number, h: number } } | null>(null)
    /** 每格數量(main 讀的;省略 = 不讀數量) */
    const quantities = shallowRef<Array<number | null> | undefined>(undefined)
    const peek = shallowRef(false)
    const hover = shallowRef<string | null>(null)
    const viewport = shallowRef({ w: window.innerWidth, h: window.innerHeight })
    const toast = shallowRef<string | null>(null)
    let toastTimer: ReturnType<typeof setTimeout> | null = null
    let twNoticeShown = false

    function onScan (e: StashScanEvent) {
      if (e.reason !== 'show' || !e.subtab || loadedGame.value !== 'poe1') {
        if (shown.value) console.log('[stash] 收起疊層')
        shown.value = null
        quantities.value = undefined
        peek.value = false
        hover.value = null
        return
      }
      quantities.value = e.quantities
      peek.value = e.peek === true
      const prev = shown.value
      // 同子頁只是數量 / peek 更新:不重設、不重複記錄
      if (prev && prev.subtab === e.subtab && prev.yOffset === e.yOffset && prev.client.w === e.client.w && prev.client.h === e.client.h) return
      shown.value = { subtab: e.subtab, yOffset: e.yOffset, client: e.client }
      viewport.value = { w: window.innerWidth, h: window.innerHeight }
      void loadStashData()
      if (config.realm === 'tw') {
        if (!twNoticeShown) {
          twNoticeShown = true
          if (toastTimer) clearTimeout(toastTimer)
          toast.value = t('ppz.stash.tw_no_source')
          toastTimer = setTimeout(() => { toast.value = null }, TOAST_MS)
        }
      } else {
        ninja.queuePricesFetch()
      }
      console.log(`[stash] 顯示疊層:${e.subtab}(偏移 ${e.yOffset},client ${e.client.w}×${e.client.h}${e.quantities ? `,數量 ${e.quantities.filter(q => q != null && q > 0).length} 格` : ''})`)
    }

    const names = (refName: string) => config.uiLanguage === 'cmn-Hant' ? stashData.value?.zh.get(refName) : refName
    const badges = computed(() => {
      const s = shown.value
      const data = stashData.value
      void ninja.snapshot.value
      if (!s || !data) return []
      return layoutStashBadges({
        file: data.file,
        subtab: s.subtab,
        yOffset: s.yOffset,
        client: s.client,
        viewport: viewport.value,
        names,
        priceOf: (r) => ninja.priceOf(r),
        divineRate: ninja.xchgRate.value,
        thresholds: config.stashThresholds,
        hover: hover.value,
        quantities: quantities.value,
        peek: peek.value
      })
    })

    /** 整頁價值(有數量才有) */
    const pageValue = computed(() => {
      const s = shown.value
      const data = stashData.value
      void ninja.snapshot.value
      if (!s || !data || !quantities.value) return null
      return stashPageValue({ file: data.file, subtab: s.subtab, priceOf: (r) => ninja.priceOf(r), quantities: quantities.value })
    })
    /** 「本頁價值」卡:倉庫面板底部空白帶(格子區下方、搜尋列上方;不蓋格子 → 不影響 main 讀數量、不蓋右側頁籤清單);台服沒有價格 → 不顯示 */
    const card = computed(() => {
      const v = pageValue.value
      const s = shown.value
      const data = stashData.value
      if (!v || !s || !data || config.realm === 'tw') return null
      const pos = stashValueCardPos({ file: data.file, subtab: s.subtab, yOffset: s.yOffset, client: s.client, viewport: viewport.value })
      if (!pos) return null
      return { ...pos, ...stashValueText({ totalChaos: v.totalChaos, divineRate: ninja.xchgRate.value }), known: v.known, unknown: v.unknown, noPrice: v.noPrice, excluded: v.excluded }
    })
    // 懸浮選單「倉庫本頁價值」列讀這份
    watch([pageValue, () => ninja.xchgRate.value, () => config.realm], () => {
      const v = pageValue.value
      const s = shown.value
      stashValue.value = v && s && config.realm !== 'tw'
        ? { subtab: s.subtab, totalChaos: v.totalChaos, divineRate: ninja.xchgRate.value, known: v.known, unknown: v.unknown }
        : null
    }, { immediate: true })

    const styleVars = computed(() => badgeStyleVars(config.ocrBadgeStyle, 'stash'))
    const showNames = computed(() => config.stashShowNames)
    const unitLabel = (u: StashPriceUnit) => t(`ppz.stash.unit_${u}`)
    const markText = (m: StashBadgeView['mark']) => m === 'qty-unknown' ? '?' : t('ppz.stash.mark_no_price')
    const markTitle = (m: StashBadgeView['mark']) => m === 'qty-unknown' ? t('ppz.stash.qty_unknown') : t('ppz.stash.no_price_excluded')
    const priceText = (p: StashBadgeView['unitPrice'], status: StashBadgeView['status']) =>
      p ? `${p.value} ${unitLabel(p.unit)}` : status === 'loading' ? '…' : '?'

    // 掃描層共用接線(遮罩回報 + ack;main 讀格子數量時會截到這一層)
    const { layer } = useScanLayer<StashScanEvent>({
      source: 'stash',
      subscribe: cb => Host.onStashScanResult?.(cb) ?? (() => {}),
      handleEvent: onScan,
      drawn: [badges, card, toast, styleVars, showNames],
      showing: () => shown.value != null
    })

    const offCursor = Host.onStashCursor?.((e) => { hover.value = e.refName }) ?? (() => {})
    const onResize = () => { viewport.value = { w: window.innerWidth, h: window.innerHeight } }
    onMounted(() => { window.addEventListener('resize', onResize) })
    onUnmounted(() => {
      offCursor()
      window.removeEventListener('resize', onResize)
      if (toastTimer) clearTimeout(toastTimer)
      overlayLayers.stash = false
      stashValue.value = null
    })
    // 換掉遊戲 → 收起
    watch(loadedGame, (g) => {
      if (g !== 'poe1') { shown.value = null; quantities.value = undefined; peek.value = false; hover.value = null }
    })
    const active = computed(() => shown.value != null || toast.value != null)
    // 第五輪 30.4:有徽章 / 提示 = overlay 要顯示(overlay-content.ts)
    watch(active, (v) => { overlayLayers.stash = v }, { immediate: true })

    return { t, layer, shown, peek, badges, card, toast, styleVars, showNames, unitLabel, priceText, markText, markTitle, active }
  }
})
</script>

<style>
.st-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 39;
  font-family: var(--font-ui);
}
/* 外觀沿用符文徽章 .rs-badge(RuneshapePrices.vue);這裡只改位置:貼在格子下緣、水平置中、格寬內 */
.st-layer .st-badge {
  transform: translate(-50%, -100%);
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: 0 4px;
  border-left-width: 2px;
  font-size: var(--badge-fs-xs, var(--fs-xs));
  line-height: 1.25;
  overflow: hidden;
}
.st-layer .st-badge .st-name { max-width: 100%; overflow: hidden; text-overflow: clip; color: var(--ink-1); }
.st-layer .st-badge .rs-total { font-size: var(--badge-fs-xs, var(--fs-xs)); }
.st-layer .st-badge .st-dim { color: var(--ink-3); }
/* 三段價格色:與符文徽章同一組(`--badge-low/mid/high`,RuneshapePrices.vue 的 .rs-layer 規則照抄到這一層) */
.st-layer .rs-badge.ptier-low { color: var(--badge-low, var(--ink-2)); border-left-color: var(--badge-low, var(--ink-4)); }
.st-layer .rs-badge.ptier-mid { color: var(--badge-mid, var(--ink-0)); border-left-color: var(--badge-mid, var(--accent)); }
.st-layer .rs-badge.ptier-high { color: var(--badge-high, var(--gold)); border-left-color: var(--badge-high, var(--gold)); box-shadow: var(--shadow-float), 0 0 0 1px color-mix(in srgb, var(--badge-high, var(--gold)) 45%, transparent); }
.st-layer .rs-badge.ptier-high .rs-unit { color: var(--badge-high, var(--gold)); }
/* 游標停的格:放大、往下放到格子外(不蓋住格子與遊戲說明框),帶全名 */
.st-layer .st-badge.hovered {
  transform: translate(-50%, 4px);
  flex-direction: row;
  gap: 0.5em;
  padding: 2px 8px;
  font-size: var(--badge-fs, var(--fs-sm));
  overflow: visible;
}
.st-layer .st-badge.hovered .rs-total { font-size: var(--badge-fs, var(--fs-sm)); }
.st-layer .st-badge.hovered .st-name { color: var(--ink-0); }
/* 倉庫價值:數量讀不到 = 灰字(不分段) */
.st-layer .st-badge.st-unknown { color: var(--ink-3); }
/* 沒算進總價的格:警示色標記(「?」數量未讀 /「無價」)+ 虛線框;字級 / 字體跟徽章外觀(--badge-*)走 */
.st-layer .st-badge.st-flagged { outline: 1px dashed var(--badge-warn, var(--warn)); outline-offset: -1px; }
.st-layer .st-mark {
  display: inline-block;
  margin-right: 3px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--badge-warn, var(--warn));
  color: var(--badge-warn-ink, #1a1206);
  font-size: var(--badge-fs-xs, var(--fs-xs));
  font-weight: 700;
  line-height: 1.2;
  text-shadow: none;
}
/* 停格明細卡(單價 / 數量 / 小計;設計稿 StashValue) */
.st-layer .st-badge.st-detail {
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  min-width: 11em;
  padding: 6px 10px;
}
.st-layer .st-detail .st-row { display: flex; justify-content: space-between; gap: 1.2em; color: var(--ink-2); }
.st-layer .st-detail .st-sub { padding-top: 3px; border-top: 1px solid var(--line, rgba(255, 255, 255, 0.12)); font-weight: 700; color: var(--badge-high, var(--gold)); }
.st-layer .st-detail .st-note { font-size: var(--badge-fs-xs, var(--fs-xs)); color: var(--badge-warn, var(--warn)); }
/* 本頁價值卡:倉庫面板右側 */
.st-layer .st-value {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 3px 10px;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--surface-1, #0e1116) 92%, transparent);
  box-shadow: var(--shadow-float);
  color: var(--ink-0);
  font-size: var(--badge-fs-xs, var(--fs-xs));
  white-space: nowrap;
}
.st-layer .st-value-line { display: flex; align-items: baseline; gap: 0.8em; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.st-layer .st-value-title { color: var(--ink-3); }
.st-layer .st-value-total { font-size: var(--badge-fs, var(--fs-lg, 1.1em)); font-weight: 700; }
.st-layer .st-value-div { color: var(--ink-2); }
.st-layer .st-value-counts { color: var(--ink-3); }
.st-layer .st-value-excluded { color: var(--badge-warn, var(--warn)); }
.st-layer .st-value-note { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--ink-3); }
</style>
