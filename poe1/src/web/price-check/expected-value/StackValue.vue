<!--
  移植自 Awakened PoE Trade(SnosMe,MIT)經繁中 fork awakened-poe-trade-zh-TW(Hsiung-Shao,MIT)
  `renderer/src/web/price-check/expected-value/StackValue.vue`。授權見 NOTICE.md / LICENSES/。
  exile-appraiser(第 24 步):只對 poe.ninja exchange 類顯示(與通貨價格區相同條件)。
  2026-10-14 B 改版:本檔呈現層已重寫 —— 模板改為 renderer `price-panel/StackCard.vue`(「你的這一疊」卡);
  數量 × poe.ninja 單價的算法與顯示條件不變(金額改傳數字 + 單位,由卡片格式化並配圖示)。
-->
<template>
  <stack-card v-if="show" game="poe1" :stack="value" />
</template>

<script lang="ts">
import { defineComponent, PropType, computed } from 'vue'
import { usePoeninja } from '@/web/background/Prices'
import { getDetailsId } from '../trends/getDetailsId'
import { ParsedItem } from '@/parser'
import { ItemFilters } from '../filters/interfaces'
import StackCard from '@/web/price-panel/StackCard.vue'
import type { Money, StackView } from '@/web/price-panel/price-hero'

export default defineComponent({
  components: { StackCard },
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
  setup (props) {
    const { findPriceByQuery, autoCurrency } = usePoeninja()

    function getPriceFor (n: number): Money {
      const one = findPriceByQuery(getDetailsId(props.item)!)!

      const price = (props.item.info.refName === 'Divine Orb')
        ? { min: n * one.chaos, max: n * one.chaos, currency: 'chaos' as const }
        : autoCurrency(n * one.chaos)

      return { amount: price.min, unit: price.currency }
    }

    return {
      show: computed(() => {
        const id = getDetailsId(props.item)
        // exile-appraiser: 只對 exchange 類顯示,與 PriceTrend 的通貨價格區同條件
        return Boolean(props.filters.stackSize && id && findPriceByQuery(id)?.exchange)
      }),
      value: computed<StackView>(() => {
        return {
          have: {
            count: props.filters.stackSize!.value,
            value: getPriceFor(props.filters.stackSize!.value)
          },
          oneStack: props.item.stackSize ? {
            count: props.item.stackSize.max,
            value: getPriceFor(props.item.stackSize.max)
          } : null
        }
      })
    }
  }
})
</script>
