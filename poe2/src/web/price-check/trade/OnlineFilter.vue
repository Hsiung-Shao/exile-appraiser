<template>
  <ui-popover
    :delay="[80, null]"
    placement="bottom-start"
    boundary="#price-window"
  >
    <template #target>
      <button
        class="rounded-sm mr-1 px-2 truncate"
        :class="showWarning() ? 'text-orange-500' : 'text-gray-500'"
      >
        <span
          ><i class="fas fa-history"></i>
          {{
            t(
              filters.trade.listingType === "securable"
                ? "Instant"
                : filters.trade.listingType === "any"
                  ? "Offline"
                  : "Online",
            )
          }}</span
        >
        <span v-if="showLeagueName()">, {{ filters.trade.league }}</span>
      </button>
    </template>
    <template #content>
      <div class="flex gap-x-8 p-2 bg-gray-800 text-gray-400">
        <div class="flex flex-col gap-y-1">
          <template v-if="api === 'trade'">
            <ui-radio :modelValue="filters.trade.listingType" @update:modelValue="onListingType" value="available">{{
              t("Instant or Online")
            }}</ui-radio>
            <ui-radio :modelValue="filters.trade.listingType" @update:modelValue="onListingType" value="securable">{{
              t("Instant")
            }}</ui-radio>
            <ui-radio :modelValue="filters.trade.listingType" @update:modelValue="onListingType" value="online">{{
              t("Online")
            }}</ui-radio>
            <ui-radio :modelValue="filters.trade.listingType" @update:modelValue="onListingType" value="any">{{
              t(":offline_toggle")
            }}</ui-radio>
          </template>
          <template v-else>
            <ui-radio
              :modelValue="filters.trade.listingType" @update:modelValue="onListingType"
              value="onlineleague"
              >{{ t(":in_league_toggle") }}</ui-radio
            >
            <ui-radio :modelValue="filters.trade.listingType" @update:modelValue="onListingType" value="online">{{
              t("Online")
            }}</ui-radio>
            <ui-radio :modelValue="filters.trade.listingType" @update:modelValue="onListingType" value="any">{{
              t(":offline_toggle")
            }}</ui-radio>
          </template>
          <template v-if="byTime">
            <ui-radio
              :modelValue="filters.trade.listed" @update:modelValue="onListed"
              :value="undefined"
              class="mt-3"
              >{{ t(":listed_any_time") }}</ui-radio
            >
            <ui-radio :modelValue="filters.trade.listed" @update:modelValue="onListed" value="1day">{{
              t(":listed_1day")
            }}</ui-radio>
            <ui-radio :modelValue="filters.trade.listed" @update:modelValue="onListed" value="3days">{{
              t(":listed_3days")
            }}</ui-radio>
            <ui-radio :modelValue="filters.trade.listed" @update:modelValue="onListed" value="1week">{{
              t(":listed_1week")
            }}</ui-radio>
            <ui-radio :modelValue="filters.trade.listed" @update:modelValue="onListed" value="2weeks">{{
              t(":listed_2weeks")
            }}</ui-radio>
            <ui-radio :modelValue="filters.trade.listed" @update:modelValue="onListed" value="1month">{{
              t(":listed_1month")
            }}</ui-radio>
            <ui-radio :modelValue="filters.trade.listed" @update:modelValue="onListed" value="2months">{{
              t(":listed_2months")
            }}</ui-radio>
          </template>
        </div>
        <div class="flex flex-col gap-y-1">
          <ui-radio
            v-for="league of tradeLeagues"
            :key="league.id"
            v-model="filters.trade.league"
            :value="league.id"
            >{{ league.id }}</ui-radio
          >
          <template v-if="byTime">
            <ui-radio
              class="mt-3"
              :modelValue="filters.trade.currency" @update:modelValue="onCurrency"
              :value="undefined"
              >{{ t(":currency_any") }}</ui-radio
            >
            <ui-radio :modelValue="filters.trade.currency" @update:modelValue="onCurrency" value="exalted">{{
              t(":currency_only_exalted")
            }}</ui-radio>
            <ui-radio :modelValue="filters.trade.currency" @update:modelValue="onCurrency" value="chaos">{{
              t(":currency_only_chaos")
            }}</ui-radio>
            <ui-radio :modelValue="filters.trade.currency" @update:modelValue="onCurrency" value="divine">{{
              t(":currency_only_div")
            }}</ui-radio>
            <ui-radio :modelValue="filters.trade.currency" @update:modelValue="onCurrency" value="exalted_divine">{{
              t(":currency_exalted_div")
            }}</ui-radio>
          </template>
        </div>
      </div>
    </template>
  </ui-popover>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { useI18nNs } from "@/web/i18n";
import UiRadio from "@/web/ui/UiRadio.vue";
import UiToggle from "@/web/ui/UiToggle.vue";
import UiPopover from "@/web/ui/Popover.vue";
import type { ItemFilters } from "../filters/interfaces";
import { useLeagues } from "@/web/background/Leagues";
// exile-appraiser: 2026-10-29 選單裡改的掛單類型 / 上架時間 / 通貨自動記住(寫進設定檔;聯盟不記)
import { AppConfig } from "@/web/Config";
import type { PriceCheckWidget } from "@/web/overlay/interfaces";
import { rememberPoe2, type Poe2Patch } from "@/web/price-panel/online-filter-memory";

export default defineComponent({
  components: { UiRadio, UiToggle, UiPopover },
  props: {
    filters: {
      type: Object as PropType<ItemFilters>,
      required: true,
    },
    byTime: {
      type: Boolean,
      default: false,
    },
    api: {
      type: String as PropType<"trade" | "bulk">,
      required: true,
    },
  },
  setup(props) {
    const leagues = useLeagues();
    const { t } = useI18nNs("online_filter");
    // exile-appraiser: 使用者在選單改的值同時寫進設定檔(online-filter-memory.ts);查詢函式自己正規化的 listingType 不經過這裡
    const remember = (patch: Poe2Patch) => {
      rememberPoe2(AppConfig<PriceCheckWidget>("price-check"), props.api, patch);
    };

    return {
      t,
      tradeLeagues: leagues.list,
      showLeagueName: () =>
        leagues.selectedId.value !== props.filters.trade.league,
      showWarning: () =>
        Boolean(
          (props.filters.trade.listed &&
            ["1day", "3days", "1week"].includes(props.filters.trade.listed)) ||
            props.filters.trade.currency,
        ),
      onListingType(listingType: ItemFilters["trade"]["listingType"]) {
        props.filters.trade.listingType = listingType;
        remember({ listingType });
      },
      onListed(listed: string | undefined) {
        props.filters.trade.listed = listed;
        remember({ listed });
      },
      onCurrency(currency: string | undefined) {
        props.filters.trade.currency = currency;
        remember({ currency });
      },
      onOfflineUpdate(offline: boolean) {
        const { filters } = props;
        filters.trade.offline = offline;
        if (props.byTime) {
          filters.trade.listed = offline ? "2months" : undefined;
        }
      },
      inputFocus(e: FocusEvent) {
        const target = e.target as HTMLInputElement;
        target.select();
      },
    };
  },
});
</script>

<style lang="postcss" module>
@reference "../../../../../renderer/src/theme/tailwind.css"; /* exile-appraiser: Tailwind 4 升級(2026-10-24),讓 @apply / theme() 認得 utility */
.input {
  @apply text-center;
  @apply bg-transparent;
  @apply text-gray-300;
  @apply select-all;

  &:hover,
  &:focus {
    @apply bg-gray-700;
    @apply -my-px border-t border-b border-gray-500;
  }

  &::placeholder {
    @apply text-gray-400;
  }

  &:focus {
    cursor: none;
  }
}
</style>
