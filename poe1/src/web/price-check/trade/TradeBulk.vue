<template>
  <div v-if="!error" class="layout-column min-h-0" style="height: auto;">
    <div :class="$style.legacyMessage">
      {{ t(':legacy_bulk_xchg_msg') }}
    </div>
    <div class="listing-card mb-2" data-listing-conditions>
      <div class="listing-head">
        <span class="listing-head-title">{{ t('ppz.listing.conditions') }}</span>
        <span class="listing-spacer"></span>
        <listing-online-switch :model-value="!filters.trade.offline" @update:model-value="setOnlineOnly" />
        <online-filter v-if="result" :filters="filters" api="bulk" />
      </div>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1" style="min-height: 2.2em;">
        <span class="text-gray-500">{{ t('ppz.listing.pay_with') }}</span>
        <span v-if="!result" class="text-gray-600">...</span>
        <template v-else>
          <listing-chip v-for="c in payWith" :key="c.key"
            :icon="c.icon" :label="c.name" :count="c.count" :pressed="selectedCurr === c.key"
            :title="t('ppz.listing.pay_with_title', { name: c.name, n: c.count })"
            @select="selectedCurr = c.key" />
        </template>
        <span class="listing-spacer"></span>
        <trade-links v-if="result"
          :get-link="makeTradeLink" />
      </div>
    </div>
    <div class="listing-card layout-column min-h-0" data-listing-kind="bulk">
    <div class="listing-head">
      <span class="listing-head-title">{{ t('ppz.listing.title') }}</span>
      <span v-if="lowest" class="listing-head-sub" data-listing-lowest>{{ t('ppz.listing.lowest', { price: lowest }) }}</span>
      <span class="listing-spacer"></span>
      <listing-layout-toggle :model-value="layout" @update:model-value="setLayout" />
    </div>
    <div class="layout-column overflow-y-auto overflow-x-hidden">
      <div v-if="layout === 'grid'" class="listing-grid" data-listing-layout="grid">
        <template v-for="(result, idx) in selectedResults">
          <div v-if="!result" :key="idx" class="listing-tile is-placeholder"></div>
          <div v-else-if="'marketRatio' in result" :key="result.id" class="listing-tile is-market" data-listing="market-ratio">
            <span class="listing-price">{{ Number((result.exchangeAmount / result.itemAmount).toFixed(4)) }}<img :src="selectedIcon" alt=""></span>
            <span class="listing-meta">{{ t('ppz.listing.market_ratio') }}</span>
          </div>
          <div v-else :key="result.id" class="listing-tile" data-listing="bulk">
            <span class="listing-price">{{ Number((result.exchangeAmount / result.itemAmount).toFixed(4)) }}<img :src="selectedIcon" alt=""></span>
            <span class="listing-meta text-xs">{{ Number(result.exchangeAmount.toFixed(1)) }} / {{ Number(result.itemAmount.toFixed(1)) }}</span>
            <span class="listing-meta">{{ t('ppz.listing.stock', { n: result.stock }) }}</span>
            <span class="listing-meta"><i v-if="result.stock < result.itemAmount" class="fas fa-exclamation-triangle mr-1 text-gray-500"></i>{{ t('ppz.listing.fulfill', { n: Math.floor(result.stock / result.itemAmount) }) }}</span>
            <span class="listing-time">
              <span :class="[$style.accountStatus, $style[result.accountStatus]]"></span>
              <span class="font-sans">{{ result.relativeDate }}</span>
            </span>
            <span v-if="result.isMine" class="listing-badge">{{ t('You') }}</span>
            <span v-else-if="showSeller" class="listing-meta font-sans text-xs">{{ showSeller === 'ign' ? result.ign : result.accountName }}</span>
          </div>
        </template>
      </div>
      <table v-else class="table-stripped w-full" data-listing-layout="list">
        <thead>
          <tr class="text-left">
            <th :class="$style.tableHeading">
              <div class="px-2">{{ t(':price') }}</div>
            </th>
            <th :class="$style.tableHeading">
              <div class="pl-1 pr-2 flex text-xs" style="line-height: 1.3125rem;"><span class="w-8 inline-block text-right -ml-px mr-px">{{ (selectedCurr === 'xchgChaos') ? 'chaos' : 'div' }}</span><span>{{ '\u2009' }}/{{ '\u2009' }}</span><span class="w-8 inline-block">{{ t(':bulk') }}</span></div>
            </th>
            <th :class="$style.tableHeading">
              <div class="px-1">{{ t(':stock') }}</div>
            </th>
            <th :class="$style.tableHeading">
              <div class="px-1">{{ t(':fulfill') }}</div>
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
          <template v-for="(result, idx) in selectedResults">
            <tr v-if="!result" :key="idx">
              <td colspan="100" class="text-transparent">***</td>
            </tr>
            <tr v-else :key="result.id"
              :class="{ [$style.marketRatioRow]: ('marketRatio' in result) }">
              <td class="px-2">{{ Number((result.exchangeAmount / result.itemAmount).toFixed(4)) }}</td>
              <td class="pl-1 whitespace-nowrap"><span class="w-8 inline-block text-right">{{ Number(result.exchangeAmount.toFixed(1)) }}</span><span>{{ '\u2009' }}/{{ '\u2009' }}</span><span class="w-8 inline-block">{{ Number(result.itemAmount.toFixed(1)) }}</span></td>
              <template v-if="'marketRatio' in result">
                <td class="pl-1 pr-2 whitespace-nowrap text-center" :colspan="showSeller ? 4 : 3">{{ t(':market_ratio') }}</td>
              </template>
              <template v-else>
                <td class="px-1 text-right">{{ result.stock }}</td>
                <td class="px-1 text-right"><i v-if="result.stock < result.itemAmount" class="fas fa-exclamation-triangle mr-1 text-gray-500"></i>{{ Math.floor(result.stock / result.itemAmount) }}</td>
                <td class="pr-2 pl-4 whitespace-nowrap">
                  <div class="inline-flex items-center">
                    <div :class="[$style.accountStatus, $style[result.accountStatus]]"></div>
                    <div class="ml-1 font-sans text-xs">{{ result.relativeDate }}</div>
                  </div>
                  <span v-if="!showSeller && result.isMine" class="rounded px-1 text-gray-800 bg-gray-400 ml-1">{{ t('You') }}</span>
                </td>
                <td v-if="showSeller" class="px-2 whitespace-nowrap">
                  <span v-if="result.isMine" class="rounded px-1 text-gray-800 bg-gray-400">{{ t('You') }}</span>
                  <span v-else class="font-sans text-xs">{{ showSeller === 'ign' ? result.ign : result.accountName }}</span>
                </td>
              </template>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    </div>
  </div>
  <ui-error-box class="mb-2" v-else>
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
// exile-appraiser: 2026-10-14 B 改版:呈現層已重寫(「兌換條件」卡:用什麼買膠囊(沿用 selectedCurr 與筆數)+ 只看在線開關(= filters.trade.offline);
// 掛單卡標題列 + 方塊 / 長條切換;方塊 = 兩欄小卡片,長條 = 原本的表格列。搜尋 / 市價比例 / 查詢組法不動)
// exile-appraiser: execBulkSearch 改帶 TradeContext(activeTradeContext())、不再收 opts;交易站網址的 ?q= 改 encodeURIComponent
import { defineComponent, PropType, computed, watch, ComputedRef, Ref, shallowRef, shallowReactive, inject, readonly } from 'vue'
import { useI18nNs } from '@/web/i18n'
import UiErrorBox from '@/web/ui/UiErrorBox.vue'
// exile-appraiser: 就地回報(2026-10-08):查價失敗時錯誤框多一顆「回報問題」(沒有宿主注入時不畫)
import ReportInline from '@/web/ui/ReportInline.vue'
import { BulkSearch, execBulkSearch, createTradeRequest, PricingResult } from './pathofexile-bulk'
import { activeTradeContext, getTradeEndpoint } from './common'
import { AppConfig } from '@/web/Config'
import { usePoeninja } from '@/web/background/Prices'
import { useLeagues } from '@/web/background/Leagues'
import { getDetailsId } from '../trends/getDetailsId'
import { ItemFilters } from '../filters/interfaces'
import { ParsedItem } from '@/parser'
import { PriceCheckWidget } from '@/web/overlay/interfaces'
import { artificialSlowdown } from './artificial-slowdown'
import OnlineFilter from './OnlineFilter.vue'
import TradeLinks from './TradeLinks.vue'
import ListingLayoutToggle from '@/web/price-panel/ListingLayoutToggle.vue'
import ListingChip from '@/web/price-panel/ListingChip.vue'
import ListingOnlineSwitch from '@/web/price-panel/ListingOnlineSwitch.vue'
import { useListingLayout } from '@/web/price-panel/useListingLayout'

const slowdown = artificialSlowdown(900)

function useBulkApi () {
  type BulkSearchExtended = Record<'xchgChaos' | 'xchgStable', {
    listed: Ref<BulkSearch | null>
    listedLazy: ComputedRef<readonly PricingResult[]>
  }>

  let searchId = 0
  const error = shallowRef<string | null>(null)
  const result = shallowRef<BulkSearchExtended | null>(null)

  async function search (item: ParsedItem, filters: ItemFilters) {
    try {
      searchId += 1
      error.value = null
      result.value = null

      const _searchId = searchId

      // override, because at league start many players set wrong price, and this breaks optimistic search
      const have = (item.info.refName === 'Chaos Orb')
        ? ['divine']
        : (item.info.refName === 'Divine Orb')
            ? ['chaos']
            : ['divine', 'chaos']

      const optimisticSearch = await execBulkSearch(
        activeTradeContext(), item, filters, have)
      if (_searchId === searchId) {
        result.value = {
          xchgStable: getResultsByHave(item, filters, optimisticSearch, 'divine'),
          xchgChaos: getResultsByHave(item, filters, optimisticSearch, 'chaos')
        }
      }
    } catch (err) {
      error.value = (err as Error).message
    }
  }

  function getResultsByHave (
    item: ParsedItem,
    filters: ItemFilters,
    preloaded: Array<BulkSearch | null>,
    have: 'divine' | 'chaos'
  ) {
    const _result = shallowRef(
      preloaded.some(res => res?.haveTag === have)
        ? shallowReactive(preloaded.find(res => res?.haveTag === have)!)
        : null)
    const items = shallowRef<PricingResult[]>(_result.value?.listed ?? [])
    let requested: boolean = (_result.value != null)

    const listedLazy = computed(() => {
      if (!requested) {
        ;(async function () {
          try {
            requested = true
            _result.value = shallowReactive((await execBulkSearch(
              activeTradeContext(), item, filters, [have]))[0]!
            )
            items.value = _result.value.listed
            const otherHave = (have === 'divine')
              ? result.value!.xchgChaos.listed.value!
              : result.value!.xchgStable.listed.value!
            // fix best guess we did while making optimistic search
            otherHave.total -= _result.value.total
          } catch (err) {
            error.value = (err as Error).message
          }
        })()
      }

      return items.value
    })

    return { listed: _result, listedLazy }
  }

  return { error, result, search }
}

interface MarketRatio extends Pick<PricingResult, 'exchangeAmount' | 'itemAmount'> {
  id: 'market-ratio'
  marketRatio: true
}

function mergeWithMarketRatio (results: readonly PricingResult[], marketRatio: MarketRatio): Array<PricingResult | MarketRatio> {
  if (!results.length) return [marketRatio]

  const out: Array<PricingResult | MarketRatio> = [...results]
  let insertIdx = results.findIndex(result =>
    (result.exchangeAmount / result.itemAmount) >= (marketRatio.exchangeAmount / marketRatio.itemAmount))
  if (insertIdx === -1) {
    insertIdx = results.length
  }
  out.splice(insertIdx, 0, marketRatio)
  return out
}

function useMarketRatioFinder () {
  type MarketRatioMap = Record<'xchgChaos' | 'xchgStable', MarketRatio | undefined>

  const { selected: defaultLeague } = useLeagues()
  const { findPriceByQuery, xchgRate } = usePoeninja()
  const marketRatio = shallowRef<MarketRatioMap>({ xchgChaos: undefined, xchgStable: undefined })

  function find (item: ParsedItem, filters: ItemFilters): void {
    marketRatio.value = { xchgChaos: undefined, xchgStable: undefined }

    if (filters.trade.league !== defaultLeague.value?.id) return

    const detailsId = getDetailsId(item)
    const priceEntry = detailsId && findPriceByQuery(detailsId)
    if (!priceEntry) return

    let xchgChaos: MarketRatio | undefined
    if (priceEntry.chaos < ((xchgRate.value || 9999) * 1.06)) {
      let price: number
      let items: number
      if (priceEntry.chaos > 4) {
        price = priceEntry.chaos
        items = 1
      } else {
        price = (priceEntry.chaos > 1) ? 20 : 10
        items = price / priceEntry.chaos
      }
      xchgChaos = { id: 'market-ratio', marketRatio: true, exchangeAmount: price, itemAmount: items }
    }

    let xchgStable: MarketRatio | undefined
    if (xchgRate.value !== undefined) {
      let price: number
      let items: number
      if (priceEntry.chaos > (xchgRate.value * 0.94)) {
        price = priceEntry.chaos / xchgRate.value
        items = 1
      } else {
        price = (priceEntry.chaos > (xchgRate.value * 0.2)) ? 2 : 1
        items = price * (xchgRate.value / priceEntry.chaos)
      }
      xchgStable = { id: 'market-ratio', marketRatio: true, exchangeAmount: price, itemAmount: items }
    }

    marketRatio.value = { xchgChaos, xchgStable }
  }

  return { marketRatio: readonly(marketRatio), find }
}

export default defineComponent({
  components: { OnlineFilter, TradeLinks, UiErrorBox, ReportInline, ListingLayoutToggle, ListingChip, ListingOnlineSwitch },
  emits: ['reset'],
  props: {
    filters: {
      type: Object as PropType<ItemFilters>,
      required: true
    },
    item: {
      type: Object as PropType<ParsedItem>,
      required: true
    }
  },
  setup (props, ctx) {
    const widget = computed(() => AppConfig<PriceCheckWidget>('price-check')!)
    const { error, result, search } = useBulkApi()
    const { marketRatio, find: findMarketRatio } = useMarketRatioFinder()

    const showBrowser = inject<(url: string) => void>('builtin-browser')!

    const selectedCurr = shallowRef<'xchgChaos' | 'xchgStable'>('xchgChaos')

    watch(() => props.item, (item) => {
      slowdown.reset(item)
    }, { immediate: true })

    const selectedResults = computed(() => {
      const arr = Array<PricingResult | MarketRatio | undefined>(20)
      if (!slowdown.isReady.value || !result.value) return arr

      const listed = result.value[selectedCurr.value].listedLazy.value
      const ratio = marketRatio.value[selectedCurr.value]
      const merged = (ratio !== undefined)
        ? mergeWithMarketRatio(listed.slice(0, 19), ratio)
        : listed
      arr.splice(0, merged.length, ...merged)
      return arr
    })

    watch(result, () => {
      const stableTotal = result.value?.xchgStable.listed.value?.total
      const chaosTotal = result.value?.xchgChaos.listed.value?.total
      if (stableTotal == null) {
        selectedCurr.value = 'xchgChaos'
      } else if (chaosTotal == null) {
        selectedCurr.value = 'xchgStable'
      } else {
        selectedCurr.value = (stableTotal > chaosTotal) ? 'xchgStable' : 'xchgChaos'
      }
    })

    function makeTradeLink (_have?: string[]) {
      const have = _have ?? ((selectedCurr.value === 'xchgStable') ? ['divine'] : ['chaos'])
      const httpPostBody = createTradeRequest(props.filters, props.item, have)
      const httpGetQuery = { exchange: httpPostBody.query }
      return `https://${getTradeEndpoint()}/trade/exchange/${props.filters.trade.league}?q=${encodeURIComponent(JSON.stringify(httpGetQuery))}`
    }

    const { t } = useI18nNs('trade_result')
    const { layout, setLayout } = useListingLayout('bulk')

    const CURR = {
      xchgChaos: { icon: '/images/chaos.png', nameKey: 'ppz.listing.currency.chaos' },
      xchgStable: { icon: '/images/divine.png', nameKey: 'ppz.listing.currency.divine' }
    } as const
    const payWith = computed(() => (['xchgChaos', 'xchgStable'] as const).map(key => ({
      key,
      icon: CURR[key].icon,
      name: t(CURR[key].nameKey),
      count: result.value?.[key].listed.value?.total ?? '?'
    })))

    return {
      t,
      layout,
      setLayout,
      payWith,
      selectedIcon: computed(() => CURR[selectedCurr.value].icon),
      lowest: computed(() => {
        const first = selectedResults.value.find(r => r != null && !('marketRatio' in r))
        return first
          ? `${Number((first.exchangeAmount / first.itemAmount).toFixed(4))} ${t(CURR[selectedCurr.value].nameKey)}`
          : null
      }),
      setOnlineOnly (online: boolean) {
        // 與 OnlineFilterCore 的「離線」開關同一個狀態(bulk 不動 listed)
        props.filters.trade.offline = !online
      },
      error,
      result,
      selectedResults,
      selectedCurr,
      execSearch: () => {
        search(props.item, props.filters)
        findMarketRatio(props.item, props.filters)
      },
      showSeller: computed(() => widget.value.showSeller),
      makeTradeLink,
      openTradeLink () {
        showBrowser(makeTradeLink(['mirror']))
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

.accountStatus {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 100%;

  /* &.online {} */
  &.offline { @apply bg-red-600; }
  &.afk { @apply bg-orange-500; }
}

.currencyIcon {
  width: 1.75rem;
  height: 1.75rem;
  margin: -0.4375rem;
  margin-right: 0.125rem;
  filter: grayscale(1);
}

.legacyMessage {
  @apply rounded p-2 mb-3;
  @apply border border-gray-600 bg-gray-700;
  text-wrap-style: balance;
  text-align: center;
}

.marketRatioRow {
  @apply bg-gray-700 !important;
  outline: 1px solid theme('colors.gray.600');
  outline-offset: -1px;
}
</style>
