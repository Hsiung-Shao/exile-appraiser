<template>
  <div v-if="show" class="p-4 layout-column min-h-0">
    <filter-name
      :filters="itemFilters"
      :item="item" />
    <price-trend
      :item="item"
      :filters="itemFilters" />
    <filters-block
      ref="filtersComponent"
      :filters="itemFilters"
      :stats="itemStats"
      :item="item"
      :presets="presets"
      @preset="selectPreset"
      @submit="doSearch = true" />
    <trade-listing
      v-if="tradeAPI === 'trade' && doSearch"
      ref="tradeService"
      :filters="itemFilters"
      :stats="itemStats"
      :item="item"
      @reset="resetTradeResults" />
    <trade-bulk
      v-if="tradeAPI === 'bulk' && doSearch"
      ref="tradeService"
      :filters="itemFilters"
      :item="item"
      @reset="resetTradeResults" />
    <div v-if="!doSearch" class="flex justify-between items-center">
      <div class="flex w-40" @mouseenter="handleSearchMouseenter">
        <button class="btn" @click="doSearch = true" style="min-width: 5rem;">{{ t('Search') }}</button>
      </div>
      <trade-links v-if="tradeAPI === 'trade'"
        :get-link="makeTradeLink" />
    </div>
    <p v-if="showComplexityHint" :class="$style.complexityHint">
      <i class="fas fa-info-circle" />
      {{ t('item.complexity_hint') }}
    </p>
    <stack-value :filters="itemFilters" :item="item"/>
    <dust-value v-if="item.dustEquivalent" :item="item"/>
  </div>
</template>

<script lang="ts">
// exile-appraiser: 移除 PricePrediction 與贊助區塊(showPredictedPrice / showSupportLinks);DustValue 已加回(拆粉量 + poe.ninja dust/chaos);overlay 型別改 @/web alias;交易站網址 ?q= 改 encodeURIComponent
// exile-appraiser(第 24 步):PriceTrend(通貨價格區:兌換價、7 天走勢、每小時成交量)/ StackValue 加回,只對 poe.ninja exchange 類顯示;
// 台服與沒有 ninja 價的物品整塊不顯示(元件內判斷)。PricePrediction 仍不做 → 不再用 v-else 掛在它後面
import { defineComponent, PropType, watch, ref, nextTick, computed, ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { ItemRarity, ItemCategory, ParsedItem } from '@/parser'
import TradeListing from './trade/TradeListing.vue'
import TradeBulk from './trade/TradeBulk.vue'
import TradeLinks from './trade/TradeLinks.vue'
import { apiToSatisfySearch, getTradeEndpoint } from './trade/common'
import FiltersBlock from './filters/FiltersBlock.vue'
import { createPresets } from './filters/create-presets'
import FilterName from './filters/FilterName.vue'
import DustValue from './expected-value/DustValue.vue'
import PriceTrend from './trends/PriceTrend.vue'
import StackValue from './expected-value/StackValue.vue'
import { CATEGORY_TO_TRADE_ID, createTradeRequest } from './trade/pathofexile-trade'
import { AppConfig } from '@/web/Config'
import { FilterPreset } from './filters/interfaces'
import { PriceCheckWidget } from '@/web/overlay/interfaces'
import { useLeagues } from '@/web/background/Leagues'

export default defineComponent({
  name: 'CheckedItem',
  components: {
    TradeListing,
    TradeBulk,
    TradeLinks,
    FiltersBlock,
    FilterName,
    DustValue,
    PriceTrend,
    StackValue
  },
  props: {
    item: {
      type: Object as PropType<ParsedItem>,
      required: true
    },
    advancedCheck: {
      type: Boolean,
      required: true
    }
  },
  setup (props) {
    const widget = computed(() => AppConfig<PriceCheckWidget>('price-check')!)
    const leagues = useLeagues()

    const presets = ref<{ active: string, presets: FilterPreset[] }>(null!)
    const itemFilters = computed(() => presets.value.presets.find(preset => preset.id === presets.value.active)!.filters)
    const itemStats = computed(() => presets.value.presets.find(preset => preset.id === presets.value.active)!.stats)
    const doSearch = ref(false)
    const tradeAPI = ref<'trade' | 'bulk'>('bulk')

    // TradeListing.vue OR TradeBulk.vue
    const tradeService = ref<{ execSearch(): void } | null>(null)
    // FiltersBlock.vue
    const filtersComponent = ref<ComponentPublicInstance>(null!)

    watch(() => props.item, (item, prevItem) => {
      const prevCurrency = (presets.value != null) ? itemFilters.value.trade.currency : null

      presets.value = createPresets(item, {
        league: leagues.selectedId.value!,
        merchantOnly: widget.value.merchantOnly,
        collapseListings: widget.value.collapseListings,
        activateStockFilter: widget.value.activateStockFilter,
        searchStatRange: widget.value.searchStatRange,
        useEn: AppConfig().useIntlSite,
        currency: (prevItem &&
          item.info.namespace === prevItem.info.namespace &&
          item.info.refName === prevItem.info.refName
        ) ? prevCurrency : widget.value.defaultCurrency
      })

      if ((!props.advancedCheck && !widget.value.smartInitialSearch) ||
          (props.advancedCheck && !widget.value.lockedInitialSearch)) {
        doSearch.value = false
      } else {
        doSearch.value = Boolean(
          (item.rarity === ItemRarity.Unique) ||
          (presets.value.active === 'filters.preset_bulk') ||
          (item.mapCompletionReward) ||
          (item.category === ItemCategory.HeistContract) ||
          (item.category === ItemCategory.HeistBlueprint) ||
          (item.category === ItemCategory.SanctumRelic) ||
          (item.category === ItemCategory.Charm) ||
          (item.category === ItemCategory.Idol) ||
          (!CATEGORY_TO_TRADE_ID.has(item.category!) &&
            item.info.refName !== 'Mercenary Warrant') ||
          (item.isUnidentified) ||
          (item.isVeiled)
        )
      }

      tradeAPI.value = apiToSatisfySearch(props.item, itemStats.value, itemFilters.value)
    }, { immediate: true })

    watch(() => [props.item, doSearch.value], () => {
      if (doSearch.value === false) return

      tradeAPI.value = apiToSatisfySearch(props.item, itemStats.value, itemFilters.value)

      // NOTE: child `trade-xxx` component renders/receives props on nextTick
      nextTick(() => {
        if (tradeService.value) {
          tradeService.value.execSearch()
        }
      })
    }, { deep: false, immediate: true })

    watch(() => [props.item, doSearch.value, itemStats.value, itemFilters.value], (curr, prev) => {
      const cItem = curr[0]; const pItem = prev[0]
      const cIntaracted = curr[1]; const pIntaracted = prev[1]

      if (cItem === pItem && cIntaracted === true && pIntaracted === true) {
        // force user to press Search button on change
        doSearch.value = false
      }
    }, { deep: true })

    watch(() => [props.item, JSON.stringify(itemFilters.value.trade)], (curr, prev) => {
      const cItem = curr[0]; const pItem = prev[0]
      const cTrade = curr[1]; const pTrade = prev[1]

      if (cItem === pItem && cTrade !== pTrade) {
        nextTick(() => {
          doSearch.value = true
        })
      }
    }, { deep: false })

    const show = computed(() => {
      return !(props.item.rarity === ItemRarity.Unique &&
        props.item.isUnidentified &&
        props.item.info.unique == null)
    })

    function handleSearchMouseenter (e: MouseEvent) {
      if ((filtersComponent.value.$el as HTMLElement).contains(e.relatedTarget as HTMLElement)) {
        doSearch.value = true

        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
      }
    }

    const { t } = useI18n()

    return {
      t,
      itemFilters,
      itemStats,
      doSearch,
      tradeAPI,
      tradeService,
      filtersComponent,
      show,
      handleSearchMouseenter,
      showComplexityHint: computed(() => !widget.value.builtinBrowser && !doSearch.value &&
        props.item.info.refName === 'Mercenary Warrant'),
      presets: computed(() => presets.value.presets.map(preset =>
        ({ id: preset.id, active: (preset.id === presets.value.active) }))),
      selectPreset (id: string) {
        presets.value.active = id
      },
      makeTradeLink () {
        return `https://${getTradeEndpoint()}/trade/search/${itemFilters.value.trade.league}?q=${encodeURIComponent(JSON.stringify(createTradeRequest(itemFilters.value, itemStats.value)))}`
      },
      resetTradeResults () {
        doSearch.value = false
      }
    }
  }
})
</script>

<style lang="postcss" module>
.complexityHint {
  display: flex;
  align-items: baseline;
  gap: theme('spacing.2');
  margin-top: theme('spacing.4');
  padding: theme('spacing.2') theme('spacing.4') theme('spacing.2') theme('spacing.3');
  border-radius: theme('borderRadius.DEFAULT');
  background: theme('colors.gray.900');
  text-wrap-style: pretty;

  & > i {
    color: theme('colors.gray.600');
  }
}
</style>
