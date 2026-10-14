<template>
  <div v-if="!error" class="listing-root">
    <div class="listing-card" data-listing-kind="item">
    <div class="listing-head">
      <span class="listing-head-title">{{ t("ppz.listing.title") }}</span>
      <span v-if="lowest" class="listing-head-sub" data-listing-lowest>{{
        t("ppz.listing.lowest", { price: lowest })
      }}</span>
      <span class="flex items-baseline">
        <span class="mr-1">{{ t(":matched") }}</span>
        <span v-if="!list" class="text-gray-600">...</span>
        <span v-else class="text-gray-400"
          >{{ list.total }}{{ list.inexact ? "+" : "" }}</span
        >
      </span>
      <online-filter
        v-if="list"
        :by-time="true"
        :filters="filters"
        api="trade"
      />
      <span class="listing-spacer"></span>
      <listing-layout-toggle
        :model-value="layout"
        @update:model-value="setLayout"
      />
      <trade-links v-if="list" :get-link="makeTradeLink" />
    </div>

    <div class="listing-body">
      <div
        v-if="layout === 'grid'"
        class="listing-grid"
        data-listing-layout="grid"
      >
        <template v-for="(result, idx) in groupedResults">
          <div
            v-if="!result"
            :key="idx"
            class="listing-tile is-placeholder"
          ></div>
          <trade-item
            v-else
            :key="'grid:' + result.id"
            layout="grid"
            :result="result"
            :item="item"
            :show-seller="showSeller"
            :item-level="filters.itemLevel"
            :quality="filters.quality"
          />
        </template>
      </div>
      <table v-else class="table-stripped w-full" data-listing-layout="list">
        <thead>
          <tr class="text-left">
            <th class="trade-table-heading">
              <div class="px-2">{{ t(":price") }}</div>
            </th>
            <th v-if="item.stackSize" class="trade-table-heading">
              <div class="px-2">{{ t(":stock") }}</div>
            </th>
            <th v-if="filters.itemLevel" class="trade-table-heading">
              <div class="px-2">{{ t(":item_level") }}</div>
            </th>
            <th
              v-if="isGem || item.category === ItemCategory.UncutGem"
              class="trade-table-heading"
            >
              <div class="px-2">{{ t(":gem_level") }}</div>
            </th>
            <th v-if="isGem || grantsSkill" class="trade-table-heading">
              <div class="px-2">{{ t(":gem_sockets") }}</div>
            </th>
            <th
              v-if="(filters.quality && !filters.quality.disabled) || isGem"
              class="trade-table-heading"
            >
              <div class="px-2">{{ t(":quality") }}</div>
            </th>
            <th class="trade-table-heading" :class="{ 'w-full': !showSeller }">
              <div class="pr-2 pl-4">
                <span class="ml-1" style="padding-left: 0.375rem">{{
                  t(":listed")
                }}</span>
              </div>
            </th>
            <th v-if="showSeller" class="trade-table-heading w-full">
              <div class="px-2">{{ t(":seller") }}</div>
            </th>
          </tr>
        </thead>
        <tbody style="overflow: scroll">
          <template v-for="(result, idx) in groupedResults">
            <tr v-if="!result" :key="idx">
              <td colspan="100" class="text-transparent">***</td>
            </tr>
            <trade-item
              v-else
              :key="result.id"
              :result="result"
              :item="item"
              :show-seller="showSeller"
              :item-level="filters.itemLevel"
              :quality="filters.quality"
            />
          </template>
        </tbody>
      </table>
      <!-- LIKELY PRICE FIXED -->
      <div
        v-if="isLikelyPriceFixed"
        class="p-2 border-2 border-gray-600 rounded mt-2"
      >
        <div class="flex text-gray-400 leading-none">
          <div class="mt-1">
            {{ t(":likely_price_fixed") }}
          </div>
          <div class="flex-1" />
          <div class="pl-2">
            <button class="btn" @click="execFilterExaltDivine">
              {{ t(":filter_exalt_divine") }}
              <i class="fas fa-history text-xs" />
            </button>
          </div>
        </div>
      </div>

      <!-- Extraction Value -->
      <extraction-value :item="item" :first-result="groupedResults.at(0)" />

      <!-- ADDED AUGMENTS COST -->
      <!-- <div
        v-if="addedAugments && addedAugments.length"
        class="p-2 border-2 border-gray-600 rounded mt-2 flex items-center"
      >
        <div class="w-fit">{{ t(":added_augments") }}</div>
        <div class="flex px-2 items-center">
          <item-sum-price
            :items="
              addedAugments.map((augment) =>
                augment ? augment.baseItem : null,
              )
            "
          />
        </div>
      </div> -->
    </div>
    </div>
  </div>
  <ui-error-box v-else>
    <template #name>{{ t(":error") }}</template>
    <p>Error: {{ error }}</p>
    <div v-if="error && errorFix" class="border p-1 rounded">
      {{ errorFix }}
    </div>
    <template #actions>
      <button class="btn" @click="execSearch">{{ t("Retry") }}</button>
      <button class="btn" @click="openTradeLink">{{ t("Browser") }}</button>
      <report-inline mode="trade" :detail="error" />
    </template>
  </ui-error-box>
</template>

<script lang="ts">
// exile-appraiser: 2026-10-14 B 改版:呈現層已重寫(掛單卡標題列 + 方塊 / 長條切換;方塊 = 兩欄小卡片(TradeItem layout="grid"),
// 長條 = 原本的表格列。搜尋 / 分組 / 查詢組法不動;setup 回傳的 list / groupedResults / error 名稱與形狀維持,CheckedItem 的價格區會讀)
import {
  defineComponent,
  computed,
  watch,
  PropType,
  inject,
  ref,
  onMounted,
  onUnmounted,
} from "vue";
import { useI18nNs } from "@/web/i18n";
import UiPopover from "@/web/ui/Popover.vue";
import UiErrorBox from "@/web/ui/UiErrorBox.vue";
// exile-appraiser: 就地回報(2026-10-08):查價失敗時錯誤框多一顆「回報問題」(沒有宿主注入時不畫)
import ReportInline from "@/web/ui/ReportInline.vue";
import { createTradeRequest } from "./pathofexile-trade";
import { getTradeEndpoint } from "./common";
import { AppConfig } from "@/web/Config";
import { PriceCheckWidget } from "@/web/overlay/interfaces";
import { ItemFilters, StatFilter } from "../filters/interfaces";
import { ItemCategory, ParsedItem } from "@/parser";
import { artificialSlowdown } from "./artificial-slowdown";
import ItemQuickPrice from "@/web/ui/ItemQuickPrice.vue";
import OnlineFilter from "./OnlineFilter.vue";
import TradeLinks from "./TradeLinks.vue";
import TradeItem from "./TradeItem.vue";
import { useTradeApi } from "./trade-api";
import { GEM, GRANTS_REAL_SKILL } from "@/parser/meta";
import ItemSumPrice from "@/web/ui/ItemSumPrice.vue";
import ExtractionValue from "./ExtractionValue.vue";
import ListingLayoutToggle from "@/web/price-panel/ListingLayoutToggle.vue";
import { useListingLayout } from "@/web/price-panel/useListingLayout";

const slowdown = artificialSlowdown(900);

const SHOW_RESULTS = 20;

export default defineComponent({
  components: {
    ExtractionValue,
    ItemQuickPrice,
    ItemSumPrice,
    OnlineFilter,
    TradeLinks,
    TradeItem,
    UiErrorBox,
    ReportInline,
    UiPopover,
    ListingLayoutToggle,
  },
  props: {
    filters: {
      type: Object as PropType<ItemFilters>,
      required: true,
    },
    stats: {
      type: Array as PropType<StatFilter[]>,
      required: true,
    },
    item: {
      type: Object as PropType<ParsedItem>,
      required: true,
    },
  },
  setup(props) {
    const widget = computed(() => AppConfig<PriceCheckWidget>("price-check")!);
    watch(
      () => props.item,
      (item) => {
        slowdown.reset(item);
      },
      { immediate: true },
    );

    const { error, searchResult, groupedResults, search } = useTradeApi();

    const showBrowser = inject<(url: string) => void>("builtin-browser")!;

    const { t } = useI18nNs("trade_result");

    function makeTradeLink() {
      return searchResult.value
        ? `https://${getTradeEndpoint()}/trade2/search/poe2/${encodeURIComponent(props.filters.trade.league)}/${searchResult.value.id}`
        : `https://${getTradeEndpoint()}/trade2/search/poe2/${encodeURIComponent(props.filters.trade.league)}?q=${encodeURIComponent(JSON.stringify(createTradeRequest(props.filters, props.stats, props.item)))}`; // exile-appraiser: 聯盟與 ?q= 改 encodeURIComponent
    }

    // Shift Key Detection
    const isShiftPressed = ref(false);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        isShiftPressed.value = true;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        isShiftPressed.value = false;
      }
    };

    onMounted(() => {
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);
    });

    onUnmounted(() => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    });

    const { layout, setLayout } = useListingLayout("item");

    return {
      t,
      layout,
      setLayout,
      lowest: computed(() => {
        const first = groupedResults.value[0];
        return slowdown.isReady.value && first
          ? `${first.priceAmount} ${first.priceCurrency}`
          : null;
      }),
      list: searchResult,
      groupedResults: computed(() => {
        if (!slowdown.isReady.value) {
          return Array<undefined>(SHOW_RESULTS);
        } else {
          return [
            ...groupedResults.value,
            ...(groupedResults.value.length < SHOW_RESULTS
              ? Array<undefined>(SHOW_RESULTS - groupedResults.value.length)
              : []),
          ];
        }
      }),
      execSearch: () => {
        search(props.filters, props.stats, props.item);
      },
      execFilterExaltDivine: () => {
        props.filters.trade.currency = "exalted_divine";
      },
      error,
      errorFix: computed(() => {
        console.log(error.value);
        if (error.value?.startsWith("Query is too complex.")) {
          return t(":fix_complex_query");
        }

        return undefined;
      }),
      showSeller: computed(() => widget.value.showSeller),
      makeTradeLink,
      openTradeLink() {
        showBrowser(makeTradeLink());
      },
      // Shift key state and methods
      isShiftPressed,
      ItemCategory,
      isGem: computed(
        () => props.item.category && GEM.has(props.item.category),
      ),
      grantsSkill: computed(
        () => props.item.category && GRANTS_REAL_SKILL.has(props.item.category),
      ),
      isLikelyPriceFixed: computed(() => {
        // if it isn't filling listings it probably is fine
        if (groupedResults.value.length <= 15) {
          return false;
        }
        const commonCurrencyPrices = groupedResults.value.filter((res) => {
          return (
            // is a common currency
            /chaos|exalted|divine/i.test(res.priceCurrency) ||
            // is a common very low value currency (but not enhanced versions)
            // NOTE: BECAUSE WE CANT HAVE NICE THINGS HERE
            ((res.priceCurrency === "aug" ||
              res.priceCurrency === "regal" ||
              res.priceCurrency === "transmute") &&
              res.priceAmount < 30)
          );
        });
        if (commonCurrencyPrices.length < 5) {
          return true;
        }

        return false;
      }),
      addedAugments: computed(() => {
        return props.item.augmentSockets?.augments.filter(
          (i) => i && !i.existing,
        );
      }),
    };
  },
});
</script>

<style lang="postcss">
.trade-table-heading {
  @apply sticky top-0;
  @apply bg-gray-800;
  @apply p-0 m-0;
  @apply whitespace-nowrap;

  & > div {
    @apply border-b border-gray-700;
  }
}

.account-status {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 100%;

  &.instantBuyout {
    /* */
  }

  &.online {
    @apply bg-pink-400;
  }

  &.offline {
    @apply bg-red-600;
  }

  &.afk {
    @apply bg-orange-500;
  }

  &.rank-2 {
    @apply bg-blue-600;
  }

  &.rank-3 {
    @apply bg-yellow-600;
  }
}
</style>
