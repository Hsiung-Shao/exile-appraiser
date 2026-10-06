<template>
  <div v-if="result" :class="[$style['wrapper'], $style[clickPosition]]" data-panel="related-items">
    <div v-if="'related' in result" class="flex-1 p-2 w-1/2">
      <div v-for="item in result.related" :key="item.name"
        :class="{ 'bg-gray-700': item.highlight }" class="rounded px-1">
        <item-quick-price currency-text fraction class="text-base"
          :price="item.price"
          :item-img="item.icon" />
        <div class="text-left text-gray-600 mb-1 whitespace-nowrap overflow-hidden">{{ item.name }}</div>
      </div>
    </div>
    <div v-if="'items' in result && result.items.length" class="flex-1 p-2 w-1/2">
      <div v-for="item in result.items" :key="item.name">
        <item-quick-price currency-text fraction class="text-base"
          :price="item.price"
          :item-img="item.icon" />
        <div class="text-left text-gray-600 mb-1 whitespace-nowrap overflow-hidden">{{ item.name }}</div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// exile-appraiser: 移植自 APT `price-check/related-items/RelatedItems.vue`(MIT)。
// - `getItemPrices` 等搬到 core `games/related-items.ts`(純函式、兩代共用、有單元測試);
// - 上游 id 找不到物品時整塊改成英文錯誤字串,這裡略過那一筆並在 log 記一次(`[related]`);
// - 由 renderer App.vue 掛在 overlay 側欄(上游 PriceCheckWindow 同位置)或 window 模式的查價區下方,只在國際服。
import { computed, defineComponent, PropType } from 'vue'
import { ITEM_BY_REF, ITEM_DROP } from '@/assets/data'
import { usePoeninja, CurrencyValue } from '@/web/background/Prices'
import { getDetailsId } from '../trends/getDetailsId'
import { ParsedItem } from '@/parser'
import ItemQuickPrice from '@/web/ui/ItemQuickPrice.vue'
import { relatedItemPrices, relatedQueryId } from '@exile-appraiser/core/games/related-items'

const { findPriceByQuery, autoCurrency } = usePoeninja()

const warned = new Set<string>()
function warnMissing (missing: string[]) {
  for (const id of missing) {
    if (warned.has(id)) continue
    warned.add(id)
    console.warn(`[related] item-drop.json 的 ${id} 在物品資料找不到,略過`)
  }
}

export default defineComponent({
  components: { ItemQuickPrice },
  props: {
    item: {
      type: Object as PropType<ParsedItem | null>,
      default: null
    },
    clickPosition: {
      type: String,
      required: true
    }
  },
  setup (props) {
    const result = computed(() => {
      if (!props.item) return

      const queryId = getDetailsId(props.item)
      if (!queryId || !queryId.ns || !queryId.name) return

      const out = relatedItemPrices<CurrencyValue>({
        drops: ITEM_DROP ?? [],
        itemByRef: (ns, name) => ITEM_BY_REF(ns as Parameters<typeof ITEM_BY_REF>[0], name),
        priceOf: (q) => {
          const priceEntry = findPriceByQuery(q)
          return priceEntry ? autoCurrency(priceEntry.chaos) : undefined
        }
      }, relatedQueryId(queryId))
      if (out?.missing.length) warnMissing(out.missing)
      return out ?? undefined
    })

    return { result }
  }
})
</script>

<style lang="postcss" module>
.wrapper {
  display: flex;
  @apply bg-gray-800 text-gray-400 mt-6;
  @apply border border-gray-900;
  border-width: 0.25rem;
  max-width: min(100%, 24rem);
}

.inventory {
  @apply rounded-l-lg;
  box-shadow: inset -0.5rem 0 0.5rem -0.5rem rgb(0 0 0 / 70%);
  border-right: none;
}

.stash {
  @apply rounded-r-lg;
  box-shadow: inset 0.5rem 0 0.5rem -0.5rem rgb(0 0 0 / 70%);
  border-left: none;
}
</style>
