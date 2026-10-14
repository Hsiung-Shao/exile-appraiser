<!--
  移植自 Awakened PoE Trade(SnosMe,MIT)經繁中 fork awakened-poe-trade-zh-TW(Hsiung-Shao,MIT)
  `renderer/src/web/price-check/trends/PriceTrend.vue`。授權見 NOTICE.md / LICENSES/。
  exile-appraiser(第 24 步)的改動以 `exile-appraiser:` 註解標出:走勢圖改手繪 SVG(不加 apexcharts)、
  只顯示 poe.ninja exchange 類(通貨價格區)、沒有價格整塊不顯示;另照 Exiled Exchange 2 的 PriceTrend 加上
  每小時成交量(通貨 / 物品,依設定「通貨每小時成交量」)與「成交量最大」通貨;外開走 Host.openExternal。
  2026-10-14 B 改版:本檔呈現層已重寫 —— 模板改為 renderer `price-panel/PriceHero.vue`(mode="currency",設計稿 PricePanelBCurrency
  「市價」卡);本檔只組資料(`market`),價格 / 走勢 / 成交量的計算與只顯示 exchange 類的條件不變。
-->
<template>
  <price-hero v-if="trend && market" game="poe1" mode="currency" :market="market" @open="openNinja" />
  <!-- exile-appraiser: 上游沒有價格時的「? ×」後援區塊(showFallback)移除(沒有 ninja 價 = 整塊不顯示) -->
</template>

<script lang="ts">
import { defineComponent, PropType, computed, watch } from 'vue'
import { useI18nNs } from '@/web/i18n'
import { displayRounding, usePoeninja } from '@/web/background/Prices'
import { isValuableBasetype, getDetailsId } from './getDetailsId'
import { ParsedItem } from '@/parser'
import { artificialSlowdown } from '../trade/artificial-slowdown'
import { ItemFilters } from '../filters/interfaces'
// exile-appraiser: 成交量設定 / 外開;2026-10-14 B 改版:呈現改 PriceHero(走勢圖仍是手繪 SVG PriceSparkline,在 PriceHero 內)
import { volumeParts as volumePartsOf } from '@/web/background/price-trend'
import PriceHero from '@/web/price-panel/PriceHero.vue'
import type { MarketView } from '@/web/price-panel/price-hero'
import { AppConfig } from '@/web/Config'
import { PriceCheckWidget } from '@/web/overlay/interfaces'
import { Host } from '@/web/background/IPC'

const slowdown = artificialSlowdown(800)

export default defineComponent({
  components: {
    PriceHero
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
    const volumeParts = computed(() => volumePartsOf(volumeSetting.value))
    const valuableBasetype = computed(() => isValuableBasetype(props.item))

    // 2026-10-14 B 改版:PriceHero 通貨模式的資料(數字與單位照原本的 trend)
    const market = computed<MarketView | undefined>(() => {
      const tr = trend.value
      if (!tr) return undefined
      const vol = tr.volume
      return {
        loading: !valuableBasetype.value && !slowdown.isReady.value,
        itemIcon: props.item.info.icon,
        itemName: props.item.info.name,
        rate: tr.price,
        fraction: props.filters.stackSize != null,
        change: tr.change,
        volumeValue: vol && volumeParts.value.value ? { amount: vol.perHour, unit: vol.currency } : undefined,
        volumeItems: vol && volumeParts.value.item ? { amount: vol.itemsPerHour } : undefined,
        highest: vol?.highest
      }
    })

    return {
      t,
      trend,
      market,
      openNinja () {
        // exile-appraiser: window.open → Host.openExternal(系統瀏覽器)
        void Host.openExternal(trend.value!.url)
      },
      isValuableBasetype: valuableBasetype,
      slowdown,
      volumeParts
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
