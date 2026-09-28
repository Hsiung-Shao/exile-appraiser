<template>
  <div class="p-2 border-dashed border border-gray-600 rounded mt-2 text-gray-400 leading-none" data-dust-value>
    {{ t('item.disenchanting') }} <i class="fas fa-arrow-right text-gray-600 px-1 text-xs"></i> {{ item.dustEquivalent!.toLocaleString() }} <span class="font-sans">×</span> <img src="/images/dust.png" class="w-5 -my-5 inline-block" />
    <span v-if="perChaos != null" class="ml-3 whitespace-nowrap" data-dust-per-chaos :title="priceTitle">{{ t('ppz.dust.per_chaos', { n: perChaos.toLocaleString() }) }}<span v-if="price!.lowConfidence" class="ml-1 text-warn" data-dust-low-confidence :title="t('ppz.dust.low_confidence', { count: price!.count })">⚠</span></span>
  </div>
</template>

<script setup lang="ts">
// exile-appraiser: 自 APT 逐字複製;擴充:有 poe.ninja 價時加「≈ N dust / chaos」(N = dust / chaos 取整,
// 低信心加 ⚠);沒有價(台服、沒抓到、ninja 沒這件)只顯示 dust。價格查 `unique|name|baseType[|6L]`。
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ParsedItem } from '@/parser'
import { usePoeninja } from '@/web/background/Prices'

const props = defineProps<{
  item: ParsedItem
}>()

const { t } = useI18n()
const { findPriceByQuery, queuePricesFetch } = usePoeninja()

onMounted(() => { queuePricesFetch() })

const price = computed(() => {
  const item = props.item
  if (!item.info.refName) return null
  return findPriceByQuery({
    ns: 'UNIQUE',
    name: item.info.refName,
    baseType: item.uniqueBase?.refName,
    links: item.sockets?.linked
  })
})

const perChaos = computed(() => {
  const p = price.value
  if (!p || !(p.chaos > 0) || !props.item.dustEquivalent) return null
  return Math.round(props.item.dustEquivalent / p.chaos)
})

const priceTitle = computed(() => {
  const p = price.value
  if (!p) return ''
  return t('ppz.dust.price_source', { chaos: p.chaos.toLocaleString(), count: p.count })
})
</script>
