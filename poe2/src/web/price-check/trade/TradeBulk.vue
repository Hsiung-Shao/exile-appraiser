<template>
  <div v-if="!error" class="listing-root">
    <div class="listing-card mb-2" data-listing-conditions>
      <div class="listing-head">
        <span class="listing-head-title">{{ t("ppz.listing.conditions") }}</span>
        <span class="listing-spacer"></span>
        <listing-online-switch
          :model-value="filters.trade.listingType !== 'any'"
          @update:model-value="setOnlineOnly"
        />
        <online-filter v-if="result" :filters="filters" api="bulk" />
      </div>
      <div
        class="flex flex-wrap items-center gap-x-2 gap-y-1"
        style="min-height: 2.2em"
      >
        <span class="text-gray-500">{{ t("ppz.listing.pay_with") }}</span>
        <span v-if="!result" class="text-gray-600">...</span>
        <template v-else>
          <listing-chip
            v-for="c in payWith"
            :key="c.key"
            :icon="c.icon"
            :label="c.name"
            :count="c.count"
            :pressed="selectedCurr === c.key"
            :title="t('ppz.listing.pay_with_title', { name: c.name, n: c.count })"
            @select="selectedCurr = c.key"
          />
        </template>
        <span class="listing-spacer"></span>
        <trade-links v-if="result" :get-link="makeTradeLink" />
      </div>
    </div>
    <div class="listing-card" data-listing-kind="bulk">
    <div class="listing-head">
      <span class="listing-head-title">{{ t("ppz.listing.title") }}</span>
      <span v-if="lowest" class="listing-head-sub" data-listing-lowest>{{
        t("ppz.listing.lowest", { price: lowest })
      }}</span>
      <span class="listing-spacer"></span>
      <listing-layout-toggle
        :model-value="layout"
        @update:model-value="setLayout"
      />
    </div>
    <div class="listing-body">
      <div
        v-if="layout === 'grid'"
        class="listing-grid"
        data-listing-layout="grid"
      >
        <template v-for="(result, idx) in selectedResults">
          <div
            v-if="!result"
            :key="idx"
            class="listing-tile is-placeholder"
          ></div>
          <div v-else :key="result.id" class="listing-tile" data-listing="bulk">
            <span class="listing-price"
              >{{
                Number((result.exchangeAmount / result.itemAmount).toFixed(4))
              }}<img :src="selectedIcon" alt=""
            /></span>
            <span class="listing-meta text-xs"
              >{{ result.exchangeAmount }} / {{ result.itemAmount }}</span
            >
            <span class="listing-meta">{{
              t("ppz.listing.stock", { n: result.stock })
            }}</span>
            <span class="listing-meta"
              ><i
                v-if="result.stock < result.itemAmount"
                class="fas fa-exclamation-triangle mr-1 text-gray-500"
              ></i
              >{{
                t("ppz.listing.fulfill", {
                  n: Math.floor(result.stock / result.itemAmount),
                })
              }}</span
            >
            <span class="listing-time">
              <span class="account-status" :class="result.accountStatus"></span>
              <span class="font-sans">{{ result.relativeDate }}</span>
            </span>
            <span v-if="result.isMine" class="listing-badge">{{ t("You") }}</span>
            <span
              v-else-if="showSeller"
              class="listing-meta font-sans text-xs"
              >{{ showSeller === "ign" ? result.ign : result.accountName }}</span
            >
          </div>
        </template>
      </div>
      <table v-else class="table-stripped w-full" data-listing-layout="list">
        <thead>
          <tr class="text-left">
            <th class="trade-table-heading">
              <div class="px-2">{{ t(":price") }}</div>
            </th>
            <th class="trade-table-heading">
              <div
                class="pl-1 pr-2 flex text-xs"
                style="line-height: 1.3125rem"
              >
                <span class="w-8 inline-block text-right -ml-px mr-px">{{
                  selectedCurr === "xchgExalted"
                    ? "exalt"
                    : selectedCurr === "xchgChaos"
                      ? "chaos"
                      : "div"
                }}</span
                ><span>{{ "\u2009" }}/{{ "\u2009" }}</span
                ><span class="w-8 inline-block">{{ t(":bulk") }}</span>
              </div>
            </th>
            <th class="trade-table-heading">
              <div class="px-1">{{ t(":stock") }}</div>
            </th>
            <th class="trade-table-heading">
              <div class="px-1">{{ t(":fulfill") }}</div>
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
          <template v-for="(result, idx) in selectedResults">
            <tr v-if="!result" :key="idx">
              <td colspan="100" class="text-transparent">***</td>
            </tr>
            <tr v-else :key="result.id">
              <td class="px-2">
                {{
                  Number((result.exchangeAmount / result.itemAmount).toFixed(4))
                }}
              </td>
              <td class="pl-1 whitespace-nowrap">
                <span class="w-8 inline-block text-right">{{
                  result.exchangeAmount
                }}</span
                ><span>{{ "\u2009" }}/{{ "\u2009" }}</span
                ><span class="w-8 inline-block">{{ result.itemAmount }}</span>
              </td>
              <td class="px-1 text-right">{{ result.stock }}</td>
              <td class="px-1 text-right">
                <i
                  v-if="result.stock < result.itemAmount"
                  class="fas fa-exclamation-triangle mr-1 text-gray-500"
                ></i
                >{{ Math.floor(result.stock / result.itemAmount) }}
              </td>
              <td class="pr-2 pl-4 whitespace-nowrap">
                <div class="inline-flex items-center">
                  <div
                    class="account-status"
                    :class="result.accountStatus"
                  ></div>
                  <div class="ml-1 font-sans text-xs">
                    {{ result.relativeDate }}
                  </div>
                </div>
                <span
                  v-if="!showSeller && result.isMine"
                  class="rounded px-1 text-gray-800 bg-gray-400 ml-1"
                  >{{ t("You") }}</span
                >
              </td>
              <td v-if="showSeller" class="px-2 whitespace-nowrap">
                <span
                  v-if="result.isMine"
                  class="rounded px-1 text-gray-800 bg-gray-400"
                  >{{ t("You") }}</span
                >
                <span v-else class="font-sans text-xs">{{
                  showSeller === "ign" ? result.ign : result.accountName
                }}</span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    </div>
  </div>
  <ui-error-box class="mb-4" v-else>
    <template #name>{{ t(":error") }}</template>
    <p>Error: {{ error }}</p>
    <template #actions>
      <button class="btn" @click="execSearch">{{ t("Retry") }}</button>
      <button class="btn" @click="openTradeLink">{{ t("Browser") }}</button>
      <report-inline mode="trade" :detail="error" />
    </template>
  </ui-error-box>
</template>

<script lang="ts">
// exile-appraiser: 2026-10-14 B 改版:呈現層已重寫(「兌換條件」卡:用什麼買膠囊(沿用 selectedCurr 與筆數)+ 只看在線開關(= filters.trade.listingType);
// 掛單卡標題列 + 方塊 / 長條切換;方塊 = 兩欄小卡片,長條 = 原本的表格列。搜尋 / 查詢組法不動;圖示走 currencyIcon('poe2', …))
import {
  defineComponent,
  PropType,
  computed,
  watch,
  shallowRef,
  inject,
} from "vue";
import { useI18nNs } from "@/web/i18n";
import UiErrorBox from "@/web/ui/UiErrorBox.vue";
// exile-appraiser: 就地回報(2026-10-08):查價失敗時錯誤框多一顆「回報問題」(沒有宿主注入時不畫)
import ReportInline from "@/web/ui/ReportInline.vue";
import { createTradeRequest } from "./pathofexile-bulk";
import { getTradeEndpoint } from "./common";
import { AppConfig } from "@/web/Config";
import { ItemFilters } from "../filters/interfaces";
import { ParsedItem } from "@/parser";
import { PriceCheckWidget } from "@/web/overlay/interfaces";
import { artificialSlowdown } from "./artificial-slowdown";
import OnlineFilter from "./OnlineFilter.vue";
import TradeLinks from "./TradeLinks.vue";
import { Host } from "@/web/background/IPC";
import { useBulkApi } from "./bulk-api";
import ListingLayoutToggle from "@/web/price-panel/ListingLayoutToggle.vue";
import ListingChip from "@/web/price-panel/ListingChip.vue";
import ListingOnlineSwitch from "@/web/price-panel/ListingOnlineSwitch.vue";
import { useListingLayout } from "@/web/price-panel/useListingLayout";
import { currencyIcon } from "@/web/price-panel/currency-icon";

const slowdown = artificialSlowdown(900);

export default defineComponent({
  components: {
    OnlineFilter,
    TradeLinks,
    UiErrorBox,
    ReportInline,
    ListingLayoutToggle,
    ListingChip,
    ListingOnlineSwitch,
  },
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
    const widget = computed(() => AppConfig<PriceCheckWidget>("price-check")!);
    const { error, result, search } = useBulkApi();

    const showBrowser = inject<(url: string) => void>("builtin-browser")!;

    const useExalts = computed(() => widget.value.coreCurrency === "exalted");

    const selectedCurr = shallowRef<"xchgExalted" | "xchgChaos" | "xchgStable">(
      // only does this check on first load, otherwise will use last used currency
      widget.value.coreCurrency === "exalted" ? "xchgExalted" : "xchgChaos",
    );

    watch(
      () => props.item,
      (item) => {
        slowdown.reset(item);
      },
      { immediate: true },
    );

    const selectedResults = computed(() => {
      const arr = Array(8);
      if (!slowdown.isReady.value || !result.value) return arr;

      const listed = result.value[selectedCurr.value].listedLazy.value;
      arr.splice(0, listed.length, ...listed);
      return arr;
    });

    watch(result, () => {
      // TODO: If we start having more than just ex & c, this is not scalable
      const stableTotal = result.value?.xchgStable.listed.value?.total;
      const exaltedTotal = result.value?.xchgExalted.listed.value?.total;
      const chaosTotal = result.value?.xchgChaos.listed.value?.total;

      if (stableTotal == null) {
        selectedCurr.value = useExalts.value ? "xchgExalted" : "xchgChaos";
      } else if (exaltedTotal == null) {
        selectedCurr.value = "xchgStable";
      } else if (chaosTotal == null) {
        selectedCurr.value = "xchgStable";
      } else {
        if (useExalts.value) {
          selectedCurr.value =
            stableTotal > exaltedTotal ? "xchgStable" : "xchgExalted";
        } else {
          selectedCurr.value =
            stableTotal > chaosTotal ? "xchgStable" : "xchgChaos";
        }
      }
    });

    function makeTradeLink(_have?: string[]) {
      const have =
        _have ??
        (selectedCurr.value === "xchgStable"
          ? ["divine"]
          : selectedCurr.value === "xchgExalted"
            ? ["exalted"]
            : ["chaos"]);
      const httpPostBody = createTradeRequest(props.filters, props.item, have);
      const httpGetQuery = { exchange: httpPostBody.query };
      // exile-appraiser: 聯盟與 ?q= 改 encodeURIComponent
      return `https://${getTradeEndpoint()}/trade2/exchange/poe2/${encodeURIComponent(props.filters.trade.league)}?q=${encodeURIComponent(JSON.stringify(httpGetQuery))}`;
    }

    const { t } = useI18nNs("trade_result");
    const { layout, setLayout } = useListingLayout("bulk");

    const CURR = {
      xchgExalted: { icon: currencyIcon("poe2", "exa"), nameKey: "ppz.listing.currency.exalted" },
      xchgChaos: { icon: currencyIcon("poe2", "chaos"), nameKey: "ppz.listing.currency.chaos" },
      xchgStable: { icon: currencyIcon("poe2", "divine"), nameKey: "ppz.listing.currency.divine" },
    } as const;
    const payWith = computed(() =>
      (["xchgExalted", "xchgChaos", "xchgStable"] as const).map((key) => ({
        key,
        icon: CURR[key].icon,
        name: t(CURR[key].nameKey),
        count: result.value?.[key].listed.value?.total ?? "?",
      })),
    );

    return {
      t,
      layout,
      setLayout,
      payWith,
      selectedIcon: computed(() => CURR[selectedCurr.value].icon),
      lowest: computed(() => {
        const first = selectedResults.value.find((r) => r != null);
        return first
          ? `${Number((first.exchangeAmount / first.itemAmount).toFixed(4))} ${t(CURR[selectedCurr.value].nameKey)}`
          : null;
      }),
      setOnlineOnly(online: boolean) {
        // 與 OnlineFilter 的 listingType 同一個狀態:關 = 含離線(any);開 = 原本是 any 才改回 online(onlineleague 保留)
        const trade = props.filters.trade;
        if (!online) trade.listingType = "any";
        else if (trade.listingType === "any") trade.listingType = "online";
      },
      error,
      result,
      selectedResults,
      selectedCurr,
      execSearch: () => {
        search(props.item, props.filters);
      },
      showSeller: computed(() => widget.value.showSeller),
      makeTradeLink,
      openTradeLink() {
        if (widget.value.builtinBrowser && Host.isElectron) {
          showBrowser(makeTradeLink(["mirror"]));
        } else {
          void Host.openExternal(makeTradeLink(["mirror"])); // exile-appraiser: Host.openExternal
        }
      },
    };
  },
});
</script>

<style lang="postcss">
.trade-bulk-currency-icon {
  width: 1.75rem;
  height: 1.75rem;
  margin: -0.4375rem;
  margin-right: 0.125rem;
  filter: grayscale(1);
}

.trade-table-heading {
  @apply whitespace-nowrap;
}
</style>
