<!--
  移植自 Awakened PoE Trade(SnosMe,MIT)經繁中 fork awakened-poe-trade-zh-TW(Hsiung-Shao,MIT)
  `renderer/src/web/price-check/trends/PriceTrend.vue`。授權見 NOTICE.md / LICENSES/。
  exile-appraiser(第 24 步)的改動以 `exile-appraiser:` 註解標出:走勢圖改手繪 SVG(不加 apexcharts)、
  只顯示 poe.ninja exchange 類(通貨價格區)、沒有價格整塊不顯示;另照 Exiled Exchange 2 的 PriceTrend 加上
  每小時成交量(通貨 / 物品,依設定「通貨每小時成交量」)與「成交量最大」通貨;外開走 Host.openExternal。
-->
<template>
  <div v-if="trend" class="flex items-center pb-4" style="min-height: 3rem;" data-price-trend>
    <div v-if="!isValuableBasetype && !slowdown.isReady.value" class="flex flex-1 justify-center">
      <div><i class="fas fa-dna fa-spin text-gray-600"></i></div>
      <i18n-t keypath="trade_result.getting_price" class="pl-2">
        <span class="text-gray-600">{{ t(':getting_price_from') }}</span>
      </i18n-t>
    </div>
    <template v-else>
      <!-- exile-appraiser: 每小時成交量(EE2 PriceTrend 的區塊;APT 沒有) -->
      <div v-if="trend.volume && (volumeParts.value || volumeParts.item)" @click="openNinja"
        class="flex flex-col items-center gap-y-1 rounded hover:bg-gray-700 px-1 cursor-pointer" data-price-volume>
        <div v-if="volumeParts.value" class="flex flex-row items-center" data-volume-value>
          {{ trend.volume.perHour }}
          <div class="w-6 h-6 flex items-center justify-center shrink-0">
            <img :src="currencyIcon(trend.volume.currency)" class="max-w-full max-h-full">
          </div>
          <div class="text-xs text-gray-500">{{ t('ppz.per_hour') }}</div>
        </div>
        <div v-if="volumeParts.item" class="flex flex-row items-center" data-volume-item>
          {{ trend.volume.itemsPerHour }}
          <div class="w-6 h-6 flex items-center justify-center shrink-0">
            <img :src="item.info.icon" class="max-w-full max-h-full overflow-hidden">
          </div>
          <div class="text-xs text-gray-500">{{ t('ppz.per_hour') }}</div>
        </div>
      </div>
      <item-quick-price class="flex-1 text-base justify-center"
        :price="trend.price"
        :fraction="filters.stackSize != null"
        :item-img="item.info.icon"
        :item-base="item.uniqueBase ?? item.info"
      >
        <template #item v-if="isValuableBasetype">
          <span class="text-gray-400">{{ t(':base_item') }}</span>
        </template>
      </item-quick-price>
      <div v-if="trend.change || trend.volume?.highest" class="flex flex-col items-center">
        <div v-if="trend.change" @click="openNinja" :class="$style['trend-btn']" data-price-change>
          <div class="text-center">
            <div class="leading-tight">
              <i v-if="trend.change.forecast === 'down'" class="fas fa-angle-double-down pr-1 text-red-600"></i>
              <i v-if="trend.change.forecast === 'up'" class="fas fa-angle-double-up pr-1 text-green-500"></i>
              <span v-if="trend.change.forecast === 'const'" class="pr-1 text-gray-600 font-sans leading-none">±</span>
              <span>{{ trend.change.text }}</span>
            </div>
            <div class="text-xs text-gray-500 leading-none">{{ t(':graph_7d') }}</div>
          </div>
          <div v-if="trend.change" class="w-12 h-8">
            <!-- exile-appraiser: vue-apexcharts → 手繪 SVG(PriceSparkline.vue;y 軸範圍同上游 drawMin / drawMax、面積填到底) -->
            <price-sparkline
              :points="trend.change.graph.points"
              :draw-min="trend.change.graph.drawMin"
              :draw-max="trend.change.graph.drawMax"
              :tone="trend.change.forecast" />
          </div>
        </div>
        <!-- exile-appraiser: 成交量最大的對手通貨(EE2 的 HIGHEST VOLUME) -->
        <div v-if="trend.volume?.highest" class="flex flex-row items-center" data-highest-volume>
          <div class="text-xs text-gray-500">{{ t('ppz.highest_volume') }}</div>
          <div class="w-6 h-6 ml-1 flex items-center justify-center shrink-0">
            <img :src="currencyIcon(trend.volume.highest)" class="max-w-full max-h-full">
          </div>
        </div>
      </div>
    </template>
  </div>
  <!-- exile-appraiser: 上游沒有價格時的「? ×」後援區塊(showFallback)移除(沒有 ninja 價 = 整塊不顯示) -->
</template>

<script lang="ts">
import { defineComponent, PropType, computed, watch } from 'vue'
import { useI18nNs } from '@/web/i18n'
import { displayRounding, usePoeninja } from '@/web/background/Prices'
import { isValuableBasetype, getDetailsId } from './getDetailsId'
import ItemQuickPrice from '@/web/ui/ItemQuickPrice.vue'
import { ParsedItem } from '@/parser'
import { artificialSlowdown } from '../trade/artificial-slowdown'
import { ItemFilters } from '../filters/interfaces'
// exile-appraiser: vue3-apexcharts → 手繪 SVG;成交量設定 / 通貨圖示 / 外開
import PriceSparkline from '@/web/ui/PriceSparkline.vue'
import { coreCurrencyIcon, volumeParts as volumePartsOf } from '@/web/background/price-trend'
import { AppConfig } from '@/web/Config'
import { PriceCheckWidget } from '@/web/overlay/interfaces'
import { Host } from '@/web/background/IPC'

const slowdown = artificialSlowdown(800)

export default defineComponent({
  components: {
    ItemQuickPrice,
    PriceSparkline
  },
  props: {
    item: {
      type: Object as PropType<ParsedItem>,
      required: true
    },
    filters: {
      type: Object as PropType<ItemFilters>,
      required: true
    }
  },
  setup (props) {
    const { t } = useI18nNs('trade_result')
    const { findPriceByQuery, autoCurrency } = usePoeninja()

    watch(() => props.item, (item) => {
      slowdown.reset(item)
    }, { immediate: true })

    const trend = computed(() => {
      const detailsId = getDetailsId(props.item)
      const trend = detailsId && findPriceByQuery(detailsId)
      if (!trend) return
      // exile-appraiser: 通貨價格區只顯示 poe.ninja exchange 類(通貨、碎片、命運卡…);傳奇 / 寶石等 item overview 不顯示
      if (!trend.exchange) return

      const price = (props.item.info.refName === 'Divine Orb')
        ? { min: trend.chaos, max: trend.chaos, currency: 'chaos' as const }
        : autoCurrency(trend.chaos)

      // exile-appraiser: 每小時成交量(volumeChaos 為 chaos 單位;物品數 = 成交額 / 單價)、成交量最大的對手通貨
      let volume: { currency: string, perHour: string, itemsPerHour: string, highest?: string } | undefined
      if (trend.volumeChaos !== undefined) {
        const perHour = autoCurrency(trend.volumeChaos)
        volume = {
          currency: perHour.currency,
          perHour: displayRounding(perHour.min),
          itemsPerHour: displayRounding(trend.volumeChaos / trend.chaos),
          highest: trend.maxVolumeCurrency
        }
      }

      return {
        price: price,
        change: deltaFromGraph(trend.graph),
        url: trend.url,
        volume
      }
    })

    const volumeSetting = computed(() => AppConfig<PriceCheckWidget>('price-check')!.currencyVolume)

    return {
      t,
      trend,
      openNinja () {
        // exile-appraiser: window.open → Host.openExternal(系統瀏覽器)
        void Host.openExternal(trend.value!.url)
      },
      isValuableBasetype: computed(() => {
        return isValuableBasetype(props.item)
      }),
      slowdown,
      volumeParts: computed(() => volumePartsOf(volumeSetting.value)),
      currencyIcon: coreCurrencyIcon
    }
  }
})

function deltaFromGraph (graphPoints: Array<number | null>) {
  const points = graphPoints.filter(p => p != null) as number[]
  if (points.length < 2) return null

  let forecast: 'up' | 'down' | 'const' = 'const'
  if (points.length === 7) {
    if (
      points.filter(p => p > 0).length >= 4 ||
      points.slice(4).every(p => p > 0)
    ) {
      forecast = 'up'
    } else if (
      points.filter(p => p < 0).length >= 4 ||
      points.slice(4).every(p => p < 0)
    ) {
      forecast = 'down'
    }
  }

  const mean = points.reduce((a, b) => a + b) / points.length
  const changeVal = Math.sqrt(points.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / (points.length - 1))

  return {
    graph: {
      points,
      drawMin: Math.min(...points) - (changeVal || 1),
      drawMax: Math.max(...points) + (changeVal || 1)
    },
    forecast,
    text: `${Math.round(changeVal * 2)} %`
  }
}
</script>

<style lang="postcss" module>
.trend-btn {
  display: flex;
  align-items: center;
  @apply gap-x-2;
  cursor: pointer;
  @apply rounded;
  @apply -my-0.5 py-0.5;
  @apply px-1;

  &:hover {
    @apply bg-gray-700;
  }
}
</style>
