<template>
  <div v-if="noUniqueSelection" class="p-4 layout-column min-h-0">
    <filter-name :filters="itemFilters" :item="item" />
    <filters-block
      ref="filtersComponent"
      :filters="itemFilters"
      :stats="itemStats"
      :item="item"
      :presets="presets"
      @preset="selectPreset"
      @submit="doSearch = true"
    />
    <trade-listing
      v-if="tradeAPI === 'trade' && doSearch"
      ref="tradeService"
      :filters="itemFilters"
      :stats="itemStats"
      :item="item"
    />
    <trade-bulk
      v-if="tradeAPI === 'bulk' && doSearch"
      ref="tradeService"
      :filters="itemFilters"
      :item="item"
    />
    <div v-if="!doSearch" class="flex justify-between items-center">
      <div class="flex w-40" @mouseenter="handleSearchMouseenter">
        <button class="btn" @click="doSearch = true" style="min-width: 5rem">
          {{ t("Search") }}
        </button>
      </div>
      <div class="flex flex-row gap-1">
        <trade-links v-if="tradeAPI === 'trade'" :get-link="makeTradeLink" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  PropType,
  watch,
  ref,
  nextTick,
  computed,
  ComponentPublicInstance,
} from "vue";
import { useI18n } from "vue-i18n";
import { ItemRarity, ItemCategory, ParsedItem } from "@/parser";
import TradeListing from "./trade/TradeListing.vue";
import TradeBulk from "./trade/TradeBulk.vue";
import TradeLinks from "./trade/TradeLinks.vue";
import { apiToSatisfySearch, getTradeEndpoint } from "./trade/common";
import FiltersBlock from "./filters/FiltersBlock.vue";
import { createPresets } from "./filters/create-presets";
import FilterName from "./filters/FilterName.vue";
import {
  CATEGORY_TO_TRADE_ID,
  createTradeRequest,
} from "./trade/pathofexile-trade";
import { AppConfig } from "@/web/Config";
import { FilterPreset } from "./filters/interfaces";
import { PriceCheckWidget } from "@/web/overlay/interfaces";
import { useLeagues } from "@/web/background/Leagues";
// exile-appraiser: 移除 PriceTrend / PricePrediction / StackValue(poe.ninja、預測價)、Tip 與贊助區塊;
// useEn 改由 realm 模型推導(AppConfig().useIntlSite);overlay 型別改 @/web alias;交易站網址的聯盟與 ?q= 改 encodeURIComponent

export default defineComponent({
  name: "CheckedItem",
  emits: ["item-editor-selection"],
  components: {
    TradeListing,
    TradeBulk,
    TradeLinks,
    FiltersBlock,
    FilterName,
  },
  props: {
    item: {
      type: Object as PropType<ParsedItem>,
      required: true,
    },
    advancedCheck: {
      type: Boolean,
      required: true,
    },
  },
  setup(props, ctx) {
    const widget = computed(() => AppConfig<PriceCheckWidget>("price-check")!);
    const leagues = useLeagues();

    const presets = ref<{ active: string; presets: FilterPreset[] }>(null!);
    const itemFilters = computed(
      () =>
        presets.value.presets.find(
          (preset) => preset.id === presets.value.active,
        )!.filters,
    );
    const itemStats = computed(
      () =>
        presets.value.presets.find(
          (preset) => preset.id === presets.value.active,
        )!.stats,
    );
    const doSearch = ref(false);
    const tradeAPI = ref<"trade" | "bulk">("bulk");

    // TradeListing.vue OR TradeBulk.vue
    const tradeService = ref<{ execSearch(): void } | null>(null);
    // FiltersBlock.vue
    const filtersComponent = ref<ComponentPublicInstance>(null!);

    watch(
      () => props.item,
      (item, prevItem) => {
        performance.mark("checked-item-item-changed");
        const prevCurrency =
          presets.value != null ? itemFilters.value.trade.currency : undefined;
        const prevListingType =
          presets.value != null
            ? itemFilters.value.trade.listingType
            : undefined;

        presets.value = createPresets(item, {
          league: leagues.selectedId.value!,
          collapseListings: widget.value.collapseListings,
          activateStockFilter: widget.value.activateStockFilter,
          searchStatRange: widget.value.searchStatRange,
          useEn: AppConfig().useIntlSite,
          currency:
            widget.value.rememberCurrency ||
            (prevItem &&
              item.info.namespace === prevItem.info.namespace &&
              item.info.refName === prevItem.info.refName)
              ? prevCurrency
              : undefined,
          listingType: widget.value.rememberListingType
            ? prevListingType
            : undefined,
          defaultAllSelected: widget.value.defaultAllSelected,
        });

        if (
          (!props.advancedCheck && !widget.value.smartInitialSearch) ||
          (props.advancedCheck && !widget.value.lockedInitialSearch)
        ) {
          doSearch.value = false;
        } else {
          doSearch.value = Boolean(
            item.rarity === ItemRarity.Unique ||
              item.category === ItemCategory.HeistBlueprint ||
              item.category === ItemCategory.SanctumRelic ||
              item.category === ItemCategory.Charm ||
              !CATEGORY_TO_TRADE_ID.has(item.category!) ||
              item.isUnidentified ||
              item.isVeiled,
          );
        }

        tradeAPI.value = apiToSatisfySearch(
          props.item,
          itemStats.value,
          itemFilters.value,
        );

        if (tradeAPI.value === "bulk") {
          itemFilters.value.trade.listingType = "online";
        }
        performance.mark("checked-item-switch-item-end");
      },
      { immediate: true, deep: true },
    );

    watch(
      () => [props.item, doSearch.value],
      () => {
        if (doSearch.value === false) return;

        tradeAPI.value = apiToSatisfySearch(
          props.item,
          itemStats.value,
          itemFilters.value,
        );

        // NOTE: child `trade-xxx` component renders/receives props on nextTick
        nextTick(() => {
          if (tradeService.value) {
            tradeService.value.execSearch();
          }
        });
      },
      { deep: false, immediate: true },
    );

    watch(
      () => [props.item, doSearch.value, itemStats.value, itemFilters.value],
      (curr, prev) => {
        const cItem = curr[0];
        const pItem = prev[0];
        const cIntaracted = curr[1];
        const pIntaracted = prev[1];

        if (cItem === pItem && cIntaracted === true && pIntaracted === true) {
          // force user to press Search button on change
          doSearch.value = false;
        }
      },
      { deep: true },
    );

    watch(
      () => [props.item, JSON.stringify(itemFilters.value.trade)],
      (curr, prev) => {
        const cItem = curr[0];
        const pItem = prev[0];
        const cTrade = curr[1];
        const pTrade = prev[1];

        if (cItem === pItem && cTrade !== pTrade) {
          nextTick(() => {
            doSearch.value = true;
          });
        }
      },
      { deep: false },
    );

    const noUniqueSelection = computed(() => {
      return !(
        props.item.rarity === ItemRarity.Unique &&
        props.item.isUnidentified &&
        props.item.info.unique == null
      );
    });

    function handleSearchMouseenter(e: MouseEvent) {
      if (
        (filtersComponent.value.$el as HTMLElement).contains(
          e.relatedTarget as HTMLElement,
        )
      ) {
        doSearch.value = true;

        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
    }

    watch(
      () => itemFilters.value.itemEditorSelection,
      (val) => {
        ctx.emit("item-editor-selection", val);
      },
      { deep: true },
    );

    const { t } = useI18n();

    return {
      t,
      itemFilters,
      itemStats,
      doSearch,
      tradeAPI,
      tradeService,
      filtersComponent,
      noUniqueSelection,
      handleSearchMouseenter,
      presets: computed(() =>
        presets.value.presets.map((preset) => ({
          id: preset.id,
          active: preset.id === presets.value.active,
        })),
      ),
      selectPreset(id: string) {
        presets.value.active = id;
      },
      makeTradeLink() {
        return `https://${getTradeEndpoint()}/trade2/search/poe2/${encodeURIComponent(itemFilters.value.trade.league)}?q=${encodeURIComponent(JSON.stringify(createTradeRequest(itemFilters.value, itemStats.value, props.item)))}`;
      },
    };
  },
});
</script>
