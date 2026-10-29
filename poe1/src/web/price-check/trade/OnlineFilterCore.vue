<template>
  <div class="flex gap-x-8">
    <div class="flex flex-col gap-y-1">
      <div class="mb-1">
        <UiToggle
          :disabled="context === 'settings'"
          :modelValue="filters.offline"
          @update:modelValue="onOfflineUpdate">{{ t(':offline_toggle') }}</UiToggle>
      </div>
      <template v-if="api === 'trade'">
        <UiRadio :modelValue="filters.listed" @update:modelValue="onListed" :disabled="context === 'settings'" :value="null">{{ t(':listed_any_time') }}</UiRadio>
        <UiRadio :modelValue="filters.listed" @update:modelValue="onListed" :disabled="context === 'settings'" value="1day">{{ t(':listed_1day') }}</UiRadio>
        <UiRadio :modelValue="filters.listed" @update:modelValue="onListed" :disabled="context === 'settings'" value="3days">{{ t(':listed_3days') }}</UiRadio>
        <UiRadio :modelValue="filters.listed" @update:modelValue="onListed" :disabled="context === 'settings'" value="1week">{{ t(':listed_1week') }}</UiRadio>
        <UiRadio :modelValue="filters.listed" @update:modelValue="onListed" :disabled="context === 'settings'" value="2weeks">{{ t(':listed_2weeks') }}</UiRadio>
        <UiRadio :modelValue="filters.listed" @update:modelValue="onListed" :disabled="context === 'settings'" value="1month">{{ t(':listed_1month') }}</UiRadio>
        <UiRadio :modelValue="filters.listed" @update:modelValue="onListed" :disabled="context === 'settings'" value="2months">{{ t(':listed_2months') }}</UiRadio>
      </template>
    </div>
    <div class="flex flex-col gap-y-1">
      <div class="mb-1">
        <UiToggle v-if="api === 'bulk'" :class="{ 'invisible': filters.offline }"
          v-model="filters.onlineInLeague">{{ t(':in_league_toggle') }}</UiToggle>
        <UiToggle v-if="api === 'trade'" :class="{ 'invisible': filters.offline }"
          :modelValue="filters.merchantOnly" @update:modelValue="onMerchantOnly">{{ t(':merchant_toggle') }}</UiToggle>
      </div>
      <UiRadio v-for="league of tradeLeagues" :key="league.id"
        v-model="filters.league" :value="league.id" :disabled="context === 'settings'">{{ league.id }}</UiRadio>
      <template v-if="api === 'trade'">
        <UiRadio class="mt-3" :modelValue="filters.currency" @update:modelValue="onCurrency" :value="null">{{ t(':currency_any') }}</UiRadio>
        <UiRadio :modelValue="filters.currency" @update:modelValue="onCurrency" value="chaos">{{ t(':currency_only_chaos') }}</UiRadio>
        <UiRadio :modelValue="filters.currency" @update:modelValue="onCurrency" value="divine">{{ t(':currency_only_div') }}</UiRadio>
        <UiRadio :modelValue="filters.currency" @update:modelValue="onCurrency" value="chaos_divine">{{ t(':currency_chaos_div') }}</UiRadio>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PropType } from 'vue'
import { useI18nNs } from '@/web/i18n'
import type { ItemFilters } from '../filters/interfaces'
import { useLeagues } from '@/web/background/Leagues'

import UiRadio from '@/web/ui/UiRadio.vue'
import UiToggle from '@/web/ui/UiToggle.vue'
// exile-appraiser: 2026-10-29 選單裡改的離線 / 上架時間 / 僅限商人 / 通貨自動記住(寫進設定檔;聯盟不記)
import { AppConfig } from '@/web/Config'
import type { PriceCheckWidget } from '@/web/overlay/interfaces'
import { rememberPoe1, type Poe1Patch } from '@/web/price-panel/online-filter-memory'

const props = defineProps({
  filters: {
    type: Object as PropType<ItemFilters['trade']>,
    required: true
  },
  api: {
    type: String as PropType<'trade' | 'bulk'>,
    required: true
  },
  context: {
    type: String as PropType<'price-check' | 'settings'>,
    default: 'price-check'
  }
})

const { list: tradeLeagues } = useLeagues()
const { t } = useI18nNs('online_filter')

function onOfflineUpdate (offline: boolean) {
  const { filters } = props
  filters.offline = offline
  if (props.api === 'trade') {
    filters.listed = (offline) ? '2months' : null
  }
  // exile-appraiser: 上游順帶改的上架時間一起記,與畫面一致
  remember(props.api === 'trade' ? { offline, listed: filters.listed } : { offline })
}

// exile-appraiser: 2026-10-29 使用者在選單改的值同時寫進設定檔(online-filter-memory.ts);程式自己改的值不經過這裡
function remember (patch: Poe1Patch) {
  rememberPoe1(AppConfig<PriceCheckWidget>('price-check'), patch)
}
function onListed (listed: string | null) {
  props.filters.listed = listed
  remember({ listed })
}
function onMerchantOnly (merchantOnly: boolean) {
  props.filters.merchantOnly = merchantOnly
  remember({ merchantOnly })
}
function onCurrency (currency: string | null) {
  props.filters.currency = currency
  remember({ currency })
}
</script>
