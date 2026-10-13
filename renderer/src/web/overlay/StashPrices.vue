<!--
  PoE1 倉庫價格疊層(Stash-Ninja 式,參考 Exile-UI,MIT;只在 overlay 掛,與符文塑形徽章層同級、呈現照符文徽章)。
  - 收 main 的 `stash-scan-result`(main/src/ocr/stash-scan.ts:OCR 碎片頁子頁按鈕列 → 目前子頁 + 資料夾偏移):
    `show` → 固定版面(stash-data.ts)每格一枚徽章(stash-view.ts `layoutStashBadges`);`hide` → 清掉。
  - 徽章 = 名稱(辨識檢視,設定 `stashShowNames`)+ poe.ninja 單價(混沌石,≥ 1 神聖石改神聖石;三段顏色 `stashThresholds`,
    外觀變數 `config.ocrBadgeStyle` 與符文共用)。台服沒有 poe.ninja → 只顯示名稱,並提示一次。
  - 游標停在某格(main `stash-cursor`)→ 只留那一格、放大加全名,不蓋住遊戲說明框。
  - 整層 `pointer-events: none`。不送任何輸入。物品名稱只讀 repo 資料(版面上的 refName → cmn-Hant items.ndjson)。
  - 不需要擷取遮罩:main 只 OCR 子頁按鈕列,徽章畫在格子上,兩者不重疊。
-->
<template>
  <div v-if="active" class="st-layer pob-dark" data-stash-layer :data-stash-subtab="shown?.subtab" :style="styleVars">
    <div v-for="b in badges" :key="b.key" class="rs-badge st-badge"
      :class="[b.tier ? `ptier-${b.tier}` : '', `st-${b.status}`, { hovered: b.hovered }]"
      data-stash="badge" :data-ref="b.refName" :data-status="b.status"
      :style="{ left: `${b.left}px`, top: `${b.top}px`, maxWidth: b.hovered ? undefined : `${Math.max(b.width, 28)}px` }"
      :title="b.refName">
      <span v-if="showNames || b.hovered" class="st-name">{{ b.name }}</span>
      <span v-if="b.price" class="rs-total">{{ b.price.value }}<span class="rs-unit">{{ unitLabel(b.price.unit) }}</span><span v-if="b.lowConfidence" class="rs-lc" :title="t('ppz.runeshape.low_confidence')">?</span></span>
      <span v-else-if="b.status === 'loading'" class="st-dim">…</span>
      <span v-else-if="b.status === 'no-price'" class="st-dim">?</span>
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
import { layoutStashBadges, type StashPriceUnit } from './stash-view'
import { loadStashData, stashData } from './stash-data'

const TOAST_MS = 6_000

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    const ninja = usePoeninja()
    const shown = shallowRef<{ subtab: StashSubtab, yOffset: number, client: { w: number, h: number } } | null>(null)
    const hover = shallowRef<string | null>(null)
    const viewport = shallowRef({ w: window.innerWidth, h: window.innerHeight })
    const toast = shallowRef<string | null>(null)
    let toastTimer: ReturnType<typeof setTimeout> | null = null
    let twNoticeShown = false

    function onScan (e: StashScanEvent) {
      if (e.reason !== 'show' || !e.subtab || loadedGame.value !== 'poe1') {
        if (shown.value) console.log('[stash] 收起疊層')
        shown.value = null
        hover.value = null
        return
      }
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
      console.log(`[stash] 顯示疊層:${e.subtab}(偏移 ${e.yOffset},client ${e.client.w}×${e.client.h})`)
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
        hover: hover.value
      })
    })

    const styleVars = computed(() => badgeStyleVars(config.ocrBadgeStyle, 'stash'))
    const showNames = computed(() => config.stashShowNames)
    const unitLabel = (u: StashPriceUnit) => t(`ppz.stash.unit_${u}`)

    const offScan = Host.onStashScanResult(onScan)
    const offCursor = Host.onStashCursor((e) => { hover.value = e.refName })
    const onResize = () => { viewport.value = { w: window.innerWidth, h: window.innerHeight } }
    onMounted(() => { window.addEventListener('resize', onResize) })
    onUnmounted(() => {
      offScan()
      offCursor()
      window.removeEventListener('resize', onResize)
      if (toastTimer) clearTimeout(toastTimer)
      overlayLayers.stash = false
    })
    // 換掉遊戲 → 收起
    watch(loadedGame, (g) => { if (g !== 'poe1') { shown.value = null; hover.value = null } })
    const active = computed(() => shown.value != null || toast.value != null)
    // 第五輪 30.4:有徽章 / 提示 = overlay 要顯示(overlay-content.ts)
    watch(active, (v) => { overlayLayers.stash = v }, { immediate: true })

    return { t, shown, badges, toast, styleVars, showNames, unitLabel, active }
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
</style>
