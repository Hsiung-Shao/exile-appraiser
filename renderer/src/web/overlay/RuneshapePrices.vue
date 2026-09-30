<!--
  exile-appraiser(WP-R2):PoE2 符文塑形面板自動查價的價格徽章層(只在 overlay 掛;與 OcrBadges 同級)。
  - 收 main 的 `runeshape-scan-result`(掃描迴圈 main/src/ocr/runeshape-scan.ts):`rows` → `@poe2-entry` 的 `matchRunesRows`
    (列格式 + 精確 / 模糊比對 + 類別優先序,docs/runeshape.md)→ 每列右側一枚徽章(面板外的列不畫);空結果(面板關了 / 停用 / 暫停)→ 清掉。
    模糊命中標「≈」;技能 / 輔助寶石 poe.ninja 沒有價格 →「無價格」;對不上 / 重名 →「?」。
  - 價格:`usePoeninja().priceOf(refName, level)`(poe.ninja,PoE2 exchange);收到列時 `queuePricesFetch()` 表示「有人在查價」。
    預設崇高石計價,≥ 1 神聖石改神聖石;數量 > 1 顯示「總價(單價 each)」;依總價(崇高石)三段顏色(設定 `runeshapeThresholds`)。
  - 台服:poe.ninja 沒有台服價格 → 只顯示一次「台服無價格來源」提示,不畫徽章。
  - `pointer-events: none`;按住 Alt 時隨 App.vue 根元素 `hideUI` 隱藏。不送任何輸入。
-->
<template>
  <div v-if="active" class="rs-layer pob-dark" data-runeshape-layer :data-runeshape-state="state">
    <template v-if="state === 'rows'">
      <div v-for="b in badges" :key="b.key" class="rs-badge" :class="[`tier-${b.tier}`, `kind-${b.kind}`, b.noPrice ? `no-price-${b.noPrice}` : '']"
        data-runeshape="badge" :data-kind="b.kind" :data-tier="b.tier" :data-ref="b.refName" :data-no-price="b.noPrice" :data-approx="b.approx ? '1' : undefined"
        :style="{ left: `${b.left}px`, top: `${b.top}px` }"
        :title="badgeTitle(b)">
        <template v-if="b.kind === 'price'">
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
import { computed, defineComponent, onMounted, onUnmounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RuneshapeScanEvent } from '@ipc/types'
import * as Poe2 from '@poe2-entry'
import { AppConfig } from '../Config'
import { Host } from '../background/IPC'
import { usePoeninja } from '../background/Prices'
import { loadedGame } from '../games/active'
import { layoutRunePrices, recordScanTimings, type MatchedRow, type PriceUnit, type RuneBadgeView } from './runeshape-view'

const TOAST_MS = 2_500

type State = 'idle' | 'rows'

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    const ninja = usePoeninja()
    const state = shallowRef<State>('idle')
    const rows = shallowRef<MatchedRow[]>([])
    const client = shallowRef({ w: 0, h: 0 })
    const viewport = shallowRef({ w: window.innerWidth, h: window.innerHeight })
    const toast = shallowRef<{ code: string, text: string, kind: string } | null>(null)
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
      if (config.realm === 'tw') {
        state.value = 'idle'
        if (!twNoticeShown) {
          twNoticeShown = true
          showToast('tw', t('ppz.runeshape.tw_no_source'), 'warn', 6_000)
        }
        return
      }
      rows.value = Poe2.matchRunesRows(e.rows)
      client.value = e.client
      viewport.value = { w: window.innerWidth, h: window.innerHeight }
      state.value = 'rows'
      ninja.queuePricesFetch()
      const matched = rows.value.filter(r => r.refName).length
      console.log(`[runeshape] ${e.rows.length} 列(對上 ${matched}):` + rows.value.map(r => r.refName ?? `?${r.text.replace(/\s+/g, '')}`).join(' | ').slice(0, 300))
    }

    const badges = computed(() => {
      // 依賴:價格表(snapshot)、門檻、列、視窗大小
      void ninja.snapshot.value
      return layoutRunePrices(rows.value, ninja.priceOf, client.value, viewport.value, config.runeshapeThresholds)
    })

    const unitLabel = (u: PriceUnit) => t(`ppz.runeshape.unit_${u}`)
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
    })
    onUnmounted(() => {
      unsub.forEach(fn => fn())
      window.removeEventListener('resize', onResize)
      if (toastTimer) clearTimeout(toastTimer)
    })

    return {
      t,
      state,
      badges,
      toast,
      unitLabel,
      badgeTitle,
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
