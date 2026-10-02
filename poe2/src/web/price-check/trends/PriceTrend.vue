<!--
  移植自 Exiled Exchange 2(Kvan7,MIT)經繁中 fork Exiled-Exchange-2-zh-TW(Hsiung-Shao,MIT)
  `renderer/src/web/price-check/trends/PriceTrend.vue`(fc7de73c)。授權見 NOTICE.md / LICENSES/。
  exile-appraiser(第 24 步)的改動以 `exile-appraiser:` 註解標出:走勢圖改手繪 SVG(不加 apexcharts)、
  只顯示 poe.ninja exchange 類(通貨價格區)、沒有價格整塊不顯示、上游缺的字串改 ppz.*、外開走 Host.openExternal。
-->
<template>
  <div v-if="priceData" class="flex items-center pb-4" style="min-height: 3rem" data-price-trend>
    <div
      v-if="!isValuableBasetype && !slowdown.isReady.value"
      class="flex flex-1 justify-center"
    >
      <div><i class="fas fa-dna fa-spin text-gray-600"></i></div>
      <i18n-t keypath="trade_result.getting_price" class="pl-2">
        <span class="text-gray-600">{{ t(":getting_price_from") }}</span>
      </i18n-t>
    </div>
    <template v-else>
      <div
        v-if="priceData.volume && (volumeParts.value || volumeParts.item)"
        @click="openNinja"
        class="flex flex-col items-center gap-y-1 rounded hover:bg-gray-700 px-1 cursor-pointer"
        data-price-volume
      >
        <!-- Currency per hour -->
        <div
          v-if="volumeParts.value"
          class="flex flex-row items-center"
          data-volume-value
        >
          {{ priceData.volume.primaryVolumePerHour }}
          <div class="w-6 h-6 flex items-center justify-center shrink-0">
            <core-currency-img :currency="priceData.volume.currency" />
          </div>
          <div class="text-xs text-gray-500">{{ t("ppz.per_hour") }}</div>
        </div>
        <!-- Items per hour -->
        <div
          v-if="volumeParts.item"
          class="flex flex-row items-center"
          data-volume-item
        >
          {{ priceData.volume.itemsPerHour }}
          <div class="w-6 h-6 flex items-center justify-center shrink-0">
            <ui-item-img :icon="item.info.icon" overflow-hidden />
          </div>
          <div class="text-xs text-gray-500">{{ t("ppz.per_hour") }}</div>
        </div>
      </div>
      <item-quick-price
        class="flex-1 text-base justify-center"
        :price="priceData.price"
        :fraction="filters.stackSize != null"
        :item-img="item.info.icon"
        :item-base="item.info"
      >
        <template #item v-if="isValuableBasetype">
          <span class="text-gray-400">{{ t(":base_item") }}</span>
        </template>
      </item-quick-price>
      <div
        v-if="priceData.change || priceData.volume"
        class="flex flex-col items-center"
      >
        <div
          v-if="priceData.change"
          @click="openNinja"
          :class="$style['trend-btn']"
          data-price-change
        >
          <div class="text-center">
            <div class="leading-tight">
              <i
                v-if="priceData.change.forecast === 'down'"
                class="fas fa-angle-double-down pr-1 text-red-600"
              ></i>
              <i
                v-if="priceData.change.forecast === 'up'"
                class="fas fa-angle-double-up pr-1 text-green-500"
              ></i>
              <span
                v-if="priceData.change.forecast === 'const'"
                class="pr-1 text-gray-600 font-sans leading-none"
                >±</span
              >
              <span>{{ priceData.change.text }}</span>
            </div>
            <div class="text-xs text-gray-500 leading-none">
              {{ t(":graph_7d") }}
            </div>
          </div>
          <div v-if="priceData.change" class="w-12 h-8">
            <!-- exile-appraiser: vue-apexcharts → 手繪 SVG(PriceSparkline.vue;y 軸範圍同上游 drawMin / drawMax、面積填到底) -->
            <price-sparkline
              :points="priceData.change.graph.points"
              :draw-min="priceData.change.graph.drawMin"
              :draw-max="priceData.change.graph.drawMax"
              :tone="priceData.change.forecast"
            />
          </div>
        </div>
        <div v-if="priceData.volume?.highestVolumeCurrency" class="flex flex-row items-center" data-highest-volume>
          <!-- exile-appraiser: 上游 trade_result.highest_volume 只有 en 有 → ppz.highest_volume(兩語);圖示加 ml-1(冒號被圖示壓到) -->
          <div class="text-xs text-gray-500">{{ t("ppz.highest_volume") }}</div>

          <div class="w-6 h-6 ml-1 flex items-center justify-center shrink-0">
            <core-currency-img
              :currency="priceData.volume.highestVolumeCurrency"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
  <!-- exile-appraiser: 上游沒有價格時的「? ×」後援區塊移除(沒有 ninja 價 = 整塊不顯示) -->
</template>

<script lang="ts">
import { defineComponent, PropType, computed, watch } from "vue";
import { useI18nNs } from "@/web/i18n";
import {
  CurrencyValue,
  displayRounding,
  usePoeninja,
} from "@/web/background/Prices";
import { isValuableBasetype, getDetailsId } from "./getDetailsId";
import ItemQuickPrice from "@/web/ui/ItemQuickPrice.vue";
import { ParsedItem } from "@/parser";
import { artificialSlowdown } from "../trade/artificial-slowdown";
import { ItemFilters } from "../filters/interfaces";
import { AppConfig } from "@/web/Config";
import { PriceCheckWidget } from "@/web/overlay/interfaces";
import UiItemImg from "@/web/ui/UiItemImg.vue";
import CoreCurrencyImg from "@/web/ui/CoreCurrencyImg.vue";
// exile-appraiser: vue3-apexcharts → 手繪 SVG(renderer/src/web/ui/PriceSparkline.vue)
import PriceSparkline from "@/web/ui/PriceSparkline.vue";
// exile-appraiser: 「通貨每小時成交量」四選一的判斷與外開走 Host
import { volumeParts as volumePartsOf } from "@/web/background/price-trend";
import { Host } from "@/web/background/IPC";

const slowdown = artificialSlowdown(800);

export default defineComponent({
  components: {
    ItemQuickPrice,
    PriceSparkline,
    UiItemImg,
    CoreCurrencyImg,
  },
  props: {
    item: {
      type: Object as PropType<ParsedItem>,
      required: true,
    },
    filters: {
      type: Object as PropType<ItemFilters>,
      required: true,
    },
  },
  setup(props) {
    const { t } = useI18nNs("trade_result");
    const { findPriceByQuery, autoCurrency } = usePoeninja();

    const volumeSetting = computed(
      () => AppConfig<PriceCheckWidget>("price-check")!.currencyVolume,
    );

    watch(
      () => props.item,
      (item) => {
        slowdown.reset(item);
      },
      { immediate: true },
    );

    const priceData = computed(() => {
      const detailsId = getDetailsId(props.item);
      const entry = detailsId && findPriceByQuery(detailsId);
      if (!entry) return;
      // exile-appraiser: 通貨價格區只顯示 poe.ninja exchange 類(通貨、符文、精髓…);傳奇等 item overview 不顯示
      if (!entry.cx) return;
      const price = autoCurrency(
        entry.primaryValue,
        props.item.info.refName === "Divine Orb",
      );

      const data: {
        price: CurrencyValue;
        change?: {
          graph: { points: number[]; drawMin: number; drawMax: number };
          forecast: "up" | "down" | "const";
          text: string;
        } | null;
        url: string;
        volume?: {
          currency: string;
          primaryVolumePerHour: string;
          itemsPerHour: string;
          highestVolumeCurrency?: string;
        };
      } = {
        price,
        change: entry.sparkline.data
          ? deltaFromGraph(entry.sparkline.data)
          : undefined,
        url: entry.url,
      };

      if ("volumePrimaryValue" in entry && entry.volumePrimaryValue != null) {
        const perHour = autoCurrency(entry.volumePrimaryValue);

        const itemsPerHour =
          perHour!.min /
          (perHour!.currency === "div" ? entry.primaryValue : price.min);

        data.volume = {
          currency: perHour!.currency,
          primaryVolumePerHour: displayRounding(perHour!.min),
          itemsPerHour: displayRounding(itemsPerHour!, false, true),
          highestVolumeCurrency: entry.maxVolumeCurrency,
        };
      }

      return data;
    });

    return {
      t,
      priceData,
      openNinja() {
        // exile-appraiser: window.open → Host.openExternal(系統瀏覽器)
        void Host.openExternal(priceData.value!.url);
      },
      isValuableBasetype: computed(() => {
        return isValuableBasetype(props.item);
      }),
      slowdown,
      // exile-appraiser: 上游在模板直接比對 volumeSetting 字串;改用 volumeParts(none / value / item / both)
      volumeParts: computed(() => volumePartsOf(volumeSetting.value)),
    };
  },
});

function deltaFromGraph(graphPoints: Array<number | null>) {
  const points = graphPoints.filter((p) => p != null) as number[];
  if (points.length < 2) return null;

  let forecast: "up" | "down" | "const" = "const";
  if (points.length === 7) {
    if (
      points.filter((p) => p > 0).length >= 4 ||
      points.slice(4).every((p) => p > 0)
    ) {
      forecast = "up";
    } else if (
      points.filter((p) => p < 0).length >= 4 ||
      points.slice(4).every((p) => p < 0)
    ) {
      forecast = "down";
    }
  }

  const mean = points.reduce((a, b) => a + b) / points.length;
  const changeVal = Math.sqrt(
    points.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b) /
      (points.length - 1),
  );

  return {
    graph: {
      points,
      drawMin: Math.min(...points) - (changeVal || 1),
      drawMax: Math.max(...points) + (changeVal || 1),
    },
    forecast,
    text: `${Math.round(changeVal * 2)} %`,
  };
}
</script>

<style lang="postcss" module>
.trend-btn {
  display: flex;
  align-items: center;
  @apply gap-x-2;
  cursor: pointer;
  @apply rounded;
  @apply -my-0.5 py-0.5;
  @apply px-1;

  &:hover {
    @apply bg-gray-700;
  }
}
</style>
