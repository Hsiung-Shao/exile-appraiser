<!--
  2026-10-14 查價面板 B 改版:價格區(設計稿 PricePanelB 頂端「建議售價」卡、PricePanelBCurrency「市價」卡)。兩代共用。
  - 一般物品的「建議售價」模式(mode="item")使用者看過實機後移除(2026-10-14);`mode` 只剩 currency(其他值不輸出)。
  - mode="currency":通貨(poe.ninja exchange 類),吃兩代 trends/PriceTrend.vue 組好的 `MarketView`;點走勢 / 成交量 = emit open(開 poe.ninja)。
  圖示一律走 `unitIconFor(game, …)`(PoE2 用 /images/poe2/)。樣式在 price-panel.css(主題 token、em)。
-->
<template>
  <section v-if="mode === 'currency' && market" class="ph-card ph-hero" data-price-hero="currency" data-price-trend>
    <div class="ph-h">{{ t('ppz.hero.market') }}<span class="ph-sub">{{ t('ppz.hero.source_ninja') }}</span></div>
    <div v-if="market.loading" class="ph-status" data-hero-status>
      <i class="fas fa-dna fa-spin" aria-hidden="true"></i>
      <span>{{ t('ppz.hero.loading') }}</span>
    </div>
    <template v-else>
      <div class="ph-row">
        <span class="ph-from" data-hero-from>{{ sides.left }}<img :src="market.itemIcon" :alt="market.itemName"></span>
        <span v-if="market.baseItem" class="ph-sub" data-hero-base>{{ t('ppz.hero.base_item') }}</span>
        <svg class="ph-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        <span class="ph-big" data-hero-rate>
          {{ sides.right }}
          <img v-if="icon(market.rate.currency)" :src="icon(market.rate.currency)" :alt="market.rate.currency">
          <span v-else class="ph-unit">{{ unitShort(market.rate.currency) }}</span>
        </span>
        <span class="flex-1" />
        <button v-if="market.change" type="button" class="ph-change" :data-tone="market.change.forecast"
          :title="t('ppz.hero.open_ninja')" :aria-label="changeLabel" @click="emit('open')" data-price-change>
          <span class="ph-pct">{{ arrow }} {{ market.change.text }}</span>
          <span class="ph-spark">
            <price-sparkline
              :points="market.change.graph.points"
              :draw-min="market.change.graph.drawMin"
              :draw-max="market.change.graph.drawMax"
              :tone="market.change.forecast" />
          </span>
          <span class="ph-sub">{{ t('ppz.hero.graph_7d') }}</span>
        </button>
      </div>
      <div v-if="tiles > 0" class="ph-stats" :style="{ gridTemplateColumns: `repeat(${tiles}, minmax(0, 1fr))` }">
        <div v-if="market.volumeValue" class="ph-stat ph-click" @click="emit('open')" data-volume-value>
          <span>{{ t('ppz.hero.vol_value') }}</span>
          <b>{{ market.volumeValue.amount }}<img v-if="icon(market.volumeValue.unit)" :src="icon(market.volumeValue.unit)" alt=""></b>
        </div>
        <div v-if="market.volumeItems" class="ph-stat ph-click" @click="emit('open')" data-volume-item>
          <span>{{ t('ppz.hero.vol_items') }}</span>
          <b>{{ market.volumeItems.amount }}<img :src="market.itemIcon" alt=""></b>
        </div>
        <div v-if="market.highest" class="ph-stat" data-highest-volume>
          <span>{{ t('ppz.hero.highest') }}</span>
          <b><img v-if="icon(market.highest)" :src="icon(market.highest)" :alt="market.highest"><template v-else>{{ market.highest }}</template></b>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import PriceSparkline from '../ui/PriceSparkline.vue'
import {
  rateSides, unitIconFor, unitShort,
  type Game, type MarketView
} from './price-hero'

const props = defineProps({
  game: { type: String as PropType<Game>, required: true },
  mode: { type: String as PropType<'currency'>, required: true },
  market: { type: Object as PropType<MarketView>, default: undefined }
})
const emit = defineEmits<{ (e: 'open'): void }>()

const { t } = useI18n()

const icon = (unit: string) => unitIconFor(props.game, unit)

const sides = computed(() => props.market ? rateSides(props.market.rate, props.market.fraction) : { left: '', right: '' })
const tiles = computed(() => {
  const m = props.market
  return m ? [m.volumeValue, m.volumeItems, m.highest].filter(Boolean).length : 0
})
const arrow = computed(() => {
  switch (props.market?.change?.forecast) {
    case 'up': return '▲'
    case 'down': return '▼'
    default: return '±'
  }
})
const changeLabel = computed(() => {
  const c = props.market?.change
  if (!c) return ''
  const key = c.forecast === 'up' ? 'change_up' : c.forecast === 'down' ? 'change_down' : 'change_flat'
  return t(`ppz.hero.${key}`, [c.text])
})
</script>

<style src="./price-panel.css"></style>
