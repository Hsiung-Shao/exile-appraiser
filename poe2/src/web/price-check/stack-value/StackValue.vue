<!--
  移植自 Exiled Exchange 2(Kvan7,MIT)經繁中 fork Exiled-Exchange-2-zh-TW(Hsiung-Shao,MIT)
  `renderer/src/web/price-check/stack-value/StackValue.vue`(fc7de73c)。授權見 NOTICE.md / LICENSES/。
  exile-appraiser(第 24 步):只對 poe.ninja exchange 類顯示(與通貨價格區相同條件)。
-->
<template>
  <div
    v-if="show"
    class="p-2 border-dashed border border-gray-600 rounded mt-2"
    data-stack-value
  >
    <div class="flex text-gray-400 leading-none">
      <div class="w-1/2">
        {{ t("trade_result.you_have") }} <span class="font-sans">×</span>
        {{ value.have.amount }}
        <i class="fas fa-arrow-right text-gray-600 px-1 text-xs"></i>
        {{ value.have.price }}
      </div>
      <div class="w-1/2 pl-2" v-if="value.oneStack">
        {{ t("trade_result.stack") }} <span class="font-sans">×</span>
        {{ value.oneStack.amount }}
        <i class="fas fa-arrow-right text-gray-600 px-1 text-xs"></i>
        {{ value.oneStack.price }}
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, computed } from "vue";
import { useI18n } from "vue-i18n";
import { usePoeninja, displayRounding } from "@/web/background/Prices";
import { getDetailsId } from "../trends/getDetailsId";
import { ParsedItem } from "@/parser";
import { ItemFilters } from "../filters/interfaces";

export default defineComponent({
  props: {
    filters: {
      type: Object as PropType<ItemFilters>,
      required: true,
    },
    item: {
      type: Object as PropType<ParsedItem>,
      required: true,
    },
  },
  setup(props) {
    const { findPriceByQuery, autoCurrency } = usePoeninja();

    function getPriceFor(n: number) {
      const one = findPriceByQuery(getDetailsId(props.item)!)!;

      const price = autoCurrency(n * one.primaryValue);

      return `${displayRounding(price.min)} ${price.currency}`;
    }

    const { t } = useI18n();

    return {
      t,
      show: computed(() => {
        const id = getDetailsId(props.item);
        // exile-appraiser: 只對 exchange 類(cx)顯示,與 PriceTrend 的通貨價格區同條件
        return Boolean(props.filters.stackSize && id && findPriceByQuery(id)?.cx);
      }),
      value: computed(() => {
        return {
          have: {
            amount: props.filters.stackSize!.value,
            price: getPriceFor(props.filters.stackSize!.value),
          },
          oneStack: props.item.stackSize
            ? {
                amount: props.item.stackSize.max,
                price: getPriceFor(props.item.stackSize.max),
              }
            : null,
        };
      }),
    };
  },
});
</script>
