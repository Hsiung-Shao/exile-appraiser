<!--
  第 24 步:查價面板「通貨價格區」的 7 天走勢小圖(PoE1 / PoE2 的 PriceTrend.vue 共用)。
  取代上游的 vue3-apexcharts(sparkline 模式、平滑曲線、面積填到底);這裡畫折線 + 面積,
  顏色跟主題 token:漲 --ok、跌 --bad、持平 --ink-3,面積同色 22%。幾何在 price-trend.ts `sparklineGeometry`。
-->
<template>
  <svg v-if="geom" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="w-full h-full block"
    :class="$style.spark" :data-tone="tone" aria-hidden="true" data-sparkline>
    <path :d="geom.area" :class="$style.area" />
    <path :d="geom.line" :class="$style.line" vector-effect="non-scaling-stroke" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { sparklineGeometry } from '../background/price-trend'

const props = defineProps<{
  points: number[]
  drawMin: number
  drawMax: number
  tone: 'up' | 'down' | 'const'
}>()

const W = 48
const H = 32
const geom = computed(() => sparklineGeometry(props.points, props.drawMin, props.drawMax, W, H))
</script>

<style module>
.spark {
  --spark: var(--ink-3);
  overflow: visible;
}
.spark[data-tone="up"] { --spark: var(--ok); }
.spark[data-tone="down"] { --spark: var(--bad); }
.line {
  fill: none;
  stroke: var(--spark);
  stroke-width: 1.25;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.area {
  fill: color-mix(in srgb, var(--spark) 22%, transparent);
  stroke: none;
}
</style>
