<template>
  <div class="filter-name">
    <!-- exile-appraiser(2026-11-15,使用者要求):類別與基底改成兩個並排的選項(預設查物品類型,基底名稱看得到、點一下改查這個基底) -->
    <div v-if="choices" class="filter-name-seg" role="radiogroup" :aria-label="t('ppz.search_scope')">
      <button v-for="c in choices" :key="c.id" role="radio" :aria-checked="c.active" :data-scope="c.id"
        class="px-2 rounded-sm border overflow-hidden text-ellipsis"
        :class="c.active ? 'border-gray-500' : 'border-gray-900 filter-name-idle'"
        @click="pick(c.id)">{{ c.label }}</button>
    </div>
    <button
      v-else
      class="px-2 rounded-sm border overflow-hidden text-ellipsis"
      :class="{
        'border-gray-500': showAsActive,
        'border-gray-900': !showAsActive,
      }"
      @click="toggleAccuracy"
    >
      {{ label }}
    </button>
    <button
      v-if="filters.corrupted"
      class="px-2"
      @click="corrupted = !corrupted"
    >
      <span v-if="corrupted" class="text-red-500">{{
        t("item.corrupted")
      }}</span>
      <span v-else class="text-gray-600">{{ t("item.not_corrupted") }}</span>
    </button>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ParsedItem } from "@/parser";
import type { ItemFilters } from "./interfaces";
import { CATEGORY_TO_TRADE_ID } from "../trade/pathofexile-trade";

export default defineComponent({
  name: "FilterName",
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
    const { t } = useI18n();

    const label = computed(() => {
      const { filters } = props;
      const activeSearch =
        filters.searchRelaxed && !filters.searchRelaxed.disabled
          ? filters.searchRelaxed
          : filters.searchExact;

      if (activeSearch.name) {
        return activeSearch.name;
      }
      if (activeSearch.baseType) {
        return activeSearch.baseType;
      }
      if (activeSearch.category) {
        const tradeId = CATEGORY_TO_TRADE_ID.get(activeSearch.category)!;
        return t("item_category.prop", [
          t(`item_category.${tradeId.replace(".", "_")}`),
        ]);
      }

      return "??? Report if you see this text";
    });

    // exile-appraiser(2026-11-15,使用者要求):類別與基底改成兩個並排的選項(預設查物品類型,基底名稱看得到、點一下改查這個基底)
    const choices = computed(() => {
      const { searchRelaxed, searchExact } = props.filters;
      const base = searchExact.name ?? searchExact.baseType;
      const tradeId =
        searchRelaxed?.category &&
        CATEGORY_TO_TRADE_ID.get(searchRelaxed.category);
      if (!searchRelaxed || !tradeId || !base) return null;
      return [
        {
          id: "category",
          label: t("item_category.prop", [
            t(`item_category.${tradeId.replace(".", "_")}`),
          ]),
          active: !searchRelaxed.disabled,
        },
        { id: "base", label: base, active: Boolean(searchRelaxed.disabled) },
      ];
    });

    function pick(id: string) {
      if (props.filters.searchRelaxed)
        props.filters.searchRelaxed.disabled = id === "base";
    }

    const showAsActive = computed(() => {
      const { filters } = props;
      return filters.searchRelaxed?.disabled;
    });

    function toggleAccuracy() {
      const { filters } = props;
      if (filters.searchRelaxed) {
        filters.searchRelaxed.disabled = !filters.searchRelaxed.disabled;
      }
    }

    const corrupted = computed<boolean>({
      get() {
        return props.filters.corrupted!.value;
      },
      set(value) {
        props.filters.corrupted!.value = value;
      },
    });

    return {
      t,
      label,
      choices,
      pick,
      showAsActive,
      toggleAccuracy,
      corrupted,
    };
  },
});
</script>

<style lang="postcss">
@reference "../../../../../renderer/src/theme/tailwind.css"; /* exile-appraiser: Tailwind 4 升級(2026-10-24),讓 @apply / theme() 認得 utility */
.filter-name {
  @apply bg-gray-900 mb-2 rounded;
  line-height: 1.25rem;
  display: flex;
  justify-content: space-between;
  white-space: nowrap;
}
.filter-name-seg {
  display: flex;
  gap: 0.25rem;
  min-width: 0;
}
/* 基底名稱很長時讓按鈕縮短、以 … 截斷,不撐出面板(flex 子項目預設 min-width: auto) */
.filter-name-seg > button {
  min-width: 0;
  flex: 0 1 auto;
}
.filter-name-idle {
  color: var(--ink-2);
}
</style>
