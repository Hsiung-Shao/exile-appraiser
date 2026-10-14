<template>
  <div v-if="!error" class="listing-root">
    <div v-if="item.info.exchangeable" :class="$style.legacyMessage">
      {{ t(':legacy_bulk_xchg_msg') }}
    </div>
    <div class="listing-card" data-listing-kind="item">
    <div class="listing-head">
      <span class="listing-head-title">{{ t('ppz.listing.title') }}</span>
      <span v-if="lowest" class="listing-head-sub" data-listing-lowest>{{ t('ppz.listing.lowest', { price: lowest }) }}</span>
      <span class="flex items-baseline">
        <span class="mr-1">{{ t(':matched') }}</span>
        <span v-if="!list" class="text-gray-600">...</span>
        <span v-else class="text-gray-400">{{ list.total }}{{ list.inexact ? '+' : '' }}</span>
      </span>
      <online-filter v-if="list" :filters="filters" api="trade" />
      <span class="listing-spacer"></span>
      <listing-layout-toggle :model-value="layout" @update:model-value="setLayout" />
      <trade-links v-if="list"
        :get-link="makeTradeLink" />
    </div>
    <div class="listing-body">
      <div v-if="layout === 'grid'" class="listing-grid" data-listing-layout="grid">
        <template v-for="(result, idx) in groupedResults">
          <div v-if="!result" :key="idx" class="listing-tile is-placeholder"></div>
          <!-- exile-appraiser(2026-10-15):一筆掛單抽成 TradeItem(持有懸停浮窗的 tippy) -->
          <trade-item v-else :key="result.id" :result="result" :item="item" :filters="filters" :show-seller="showSeller" layout="grid" />
        </template>
      </div>
      <table v-else class="table-stripped w-full" data-listing-layout="list">
        <thead>
          <tr class="text-left">
            <th :class="$style.tableHeading">
              <div class="px-2">{{ t(':price') }}</div>
            </th>
            <th v-if="item.stackSize" :class="$style.tableHeading">
              <div class="px-2">{{ t(':stock') }}</div>
            </th>
            <th v-if="filters.itemLevel" :class="$style.tableHeading">
              <div class="px-2">{{ t(':item_level') }}</div>
            </th>
            <th v-if="item.category === 'Gem'" :class="$style.tableHeading">
              <div class="px-2">{{ t(':gem_level') }}</div>
            </th>
            <th v-if="filters.quality || item.category === 'Gem'" :class="$style.tableHeading">
              <div class="px-2">{{ t(':quality') }}</div>
            </th>
            <th :class="[$style.tableHeading, { 'w-full': !showSeller }]">
              <div class="pr-2 pl-4">
                <span class="ml-1" style="padding-left: 0.375rem;">{{ t(':listed') }}</span>
              </div>
            </th>
            <th v-if="showSeller" class="w-full" :class="$style.tableHeading">
              <div class="px-2">{{ t(':seller') }}</div>
            </th>
          </tr>
        </thead>
        <tbody style="overflow: scroll;">
          <template v-for="(result, idx) in groupedResults">
            <tr v-if="!result" :key="idx">
              <td colspan="100" class="text-transparent">***</td>
            </tr>
            <trade-item v-else :key="result.id" :result="result" :item="item" :filters="filters" :show-seller="showSeller" layout="list" />
          </template>
        </tbody>
      </table>
    </div>
    </div>
  </div>
  <ui-error-box v-else>
    <template #name>{{ t(':error') }}</template>
    <p v-if="error.includes('JSON')">{{ t('app.leagues_failed_help') }}</p>
    <p v-else>Error: {{ error }}</p>
    <template #actions>
      <button class="btn" @click="execSearch">{{ t('Retry') }}</button>
      <button class="btn" @click="openTradeLink">{{ t('Browser') }}</button>
      <report-inline mode="trade" :detail="error" />
    </template>
  </ui-error-box>
</template>

<script lang="ts">
// exile-appraiser: 2026-10-14 B 改版:呈現層已重寫(掛單卡標題列 + 方塊 / 長條切換;方塊 = 兩欄小卡片,長條 = 原本的表格列;
// 搜尋 / 分組 / 查詢組法不動。setup 回傳的 list / groupedResults / error 名稱與形狀維持,CheckedItem 的價格區會讀)
// exile-appraiser(2026-10-15):每筆掛單的長條列 / 方塊卡片搬到 TradeItem.vue(加懸停浮窗;合併掛單 = groupedResults 的第一筆)
// exile-appraiser: 交易層 request 函式改帶 TradeContext(activeTradeContext());requestResults 不再收 opts;交易站網址的 ?q= 改 encodeURIComponent
import { defineComponent, computed, watch, PropType, inject, shallowReactive, shallowRef } from 'vue'
import { useI18nNs } from '@/web/i18n'
import UiErrorBox from '@/web/ui/UiErrorBox.vue'
// exile-appraiser: 就地回報(2026-10-08):查價失敗時錯誤框多一顆「回報問題」(沒有宿主注入時不畫)
import ReportInline from '@/web/ui/ReportInline.vue'
import { requestTradeResultList, requestResults, createTradeRequest, PricingResult, SearchResult } from './pathofexile-trade'
import { activeTradeContext, getTradeEndpoint } from './common'
import { AppConfig } from '@/web/Config'
import { PriceCheckWidget } from '@/web/overlay/interfaces'
import { ItemFilters, FilterOrGroup } from '../filters/interfaces'
import { ParsedItem } from '@/parser'
import { artificialSlowdown } from './artificial-slowdown'
import OnlineFilter from './OnlineFilter.vue'
import TradeLinks from './TradeLinks.vue'
import ListingLayoutToggle from '@/web/price-panel/ListingLayoutToggle.vue'
import TradeItem from './TradeItem.vue'
import { useListingLayout } from '@/web/price-panel/useListingLayout'

const slowdown = artificialSlowdown(900)

const SHOW_RESULTS = 20
const API_FETCH_LIMIT = 100
const MIN_NOT_GROUPED = 7
const MIN_GROUPED = 10

function useTradeApi () {
  let searchId = 0
  let collapseMerchant = false
  const error = shallowRef<string | null>(null)
  const searchResult = shallowRef<SearchResult | null>(null)
  const fetchResults = shallowRef<PricingResult[]>([])

  const groupedResults = computed(() => {
    const out: Array<PricingResult & { listedTimes: number }> = []
    for (const result of fetchResults.value) {
      if (result == null) break
      if (out.length === 0 || (result.hasFee && !collapseMerchant)) {
        out.push({ listedTimes: 1, ...result })
        continue
      }
      const existingRes = out.find((added, idx) =>
        (
          added.accountName === result.accountName &&
          added.priceCurrency === result.priceCurrency &&
          added.priceAmount === result.priceAmount
        ) ||
        (
          added.accountName === result.accountName &&
          (out.length - idx) <= 2 // last or prev
        )
      )
      if (existingRes) {
        if (existingRes.stackSize) {
          existingRes.stackSize += result.stackSize!
        } else {
          existingRes.listedTimes += 1
        }
      } else {
        out.push({ listedTimes: 1, ...result })
      }
    }
    return out
  })

  async function search (filters: ItemFilters, stats: FilterOrGroup[]) {
    try {
      searchId += 1
      error.value = null
      searchResult.value = null
      const _fetchResults: PricingResult[] = shallowReactive([])
      fetchResults.value = _fetchResults

      const _searchId = searchId
      const request = createTradeRequest(filters, stats)
      const _searchResult = await requestTradeResultList(activeTradeContext(), request, filters.trade.league)
      if (_searchId !== searchId) {
        return
      }
      searchResult.value = _searchResult
      collapseMerchant = filters.trade.collapseMerchant

      // first two req are parallel, then sequential on demand
      {
        const r1 = (_searchResult.result.length > 0)
          ? requestResults(activeTradeContext(), _searchResult.id, _searchResult.result.slice(0, 10))
              .then(results => { _fetchResults.push(...results) })
          : Promise.resolve()
        const r2 = (_searchResult.result.length > 10)
          ? requestResults(activeTradeContext(), _searchResult.id, _searchResult.result.slice(10, 20))
              .then(results => r1
                .then(() => { _fetchResults.push(...results) }))
          : Promise.resolve()
        await Promise.all([r1, r2])
      }

      let fetched = 20
      async function fetchMore (): Promise<void> {
        if (_searchId !== searchId) return
        const totalGrouped = groupedResults.value.length
        const totalNotGrouped = groupedResults.value.reduce((len, res) =>
          res.listedTimes <= 2 ? len + 1 : len, 0)
        if (
          (totalNotGrouped < MIN_NOT_GROUPED || totalGrouped < MIN_GROUPED) &&
          fetched < _searchResult.result.length &&
          fetched < API_FETCH_LIMIT
        ) {
          await requestResults(activeTradeContext(), _searchResult.id, _searchResult.result.slice(fetched, fetched + 10))
            .then(results => { _fetchResults.push(...results) })
          fetched += 10
          return fetchMore()
        }
      }
      return fetchMore()
    } catch (err) {
      error.value = (err as Error).message
    }
  }

  return { error, searchResult, groupedResults, search }
}

export default defineComponent({
  components: { OnlineFilter, TradeLinks, UiErrorBox, ReportInline, ListingLayoutToggle, TradeItem },
  emits: ['reset'],
  props: {
    filters: {
      type: Object as PropType<ItemFilters>,
      required: true
    },
    stats: {
      type: Array as PropType<FilterOrGroup[]>,
      required: true
    },
    item: {
      type: Object as PropType<ParsedItem>,
      required: true
    }
  },
  setup (props, ctx) {
    const widget = computed(() => AppConfig<PriceCheckWidget>('price-check')!)

    watch(() => props.item, (item) => {
      slowdown.reset(item)
    }, { immediate: true })

    const { error, searchResult, groupedResults, search } = useTradeApi()

    const showBrowser = inject<(url: string) => void>('builtin-browser')!

    function makeTradeLink () {
      return (searchResult.value)
        ? `https://${getTradeEndpoint()}/trade/search/${props.filters.trade.league}/${searchResult.value.id}`
        : `https://${getTradeEndpoint()}/trade/search/${props.filters.trade.league}?q=${encodeURIComponent(JSON.stringify(createTradeRequest(props.filters, props.stats)))}`
    }

    const { t } = useI18nNs('trade_result')
    const { layout, setLayout } = useListingLayout('item')

    return {
      t,
      layout,
      setLayout,
      lowest: computed(() => {
        const first = groupedResults.value[0]
        return (slowdown.isReady.value && first) ? `${first.priceAmount} ${first.priceCurrency}` : null
      }),
      list: searchResult,
      groupedResults: computed(() => {
        if (!slowdown.isReady.value) {
          return Array<undefined>(SHOW_RESULTS)
        } else {
          return [
            ...groupedResults.value,
            ...(groupedResults.value.length < SHOW_RESULTS
              ? Array<undefined>(SHOW_RESULTS - groupedResults.value.length)
              : [])
          ]
        }
      }),
      execSearch: () => { search(props.filters, props.stats) },
      error,
      showSeller: computed(() => widget.value.showSeller),
      makeTradeLink,
      openTradeLink () {
        showBrowser(makeTradeLink())
        ctx.emit('reset')
      }
    }
  }
})
</script>

<style lang="postcss" module>
.tableHeading {
  @apply sticky top-0;
  @apply bg-gray-800;
  @apply p-0 m-0;
  white-space: nowrap;

  & > div {
    @apply border-b border-gray-700;
  }
}

.legacyMessage {
  @apply rounded p-2 mb-3;
  @apply border border-gray-600 bg-gray-700;
  text-wrap-style: balance;
  text-align: center;
}
</style>
