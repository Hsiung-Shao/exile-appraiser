<!--
  移植自 Exiled Exchange 2(Kvan7,MIT)經繁中 fork Exiled-Exchange-2-zh-TW(Hsiung-Shao,MIT)
  `renderer/src/web/price-check/trends/PriceTrend.vue`(fc7de73c)。授權見 NOTICE.md / LICENSES/。
  exile-appraiser(第 24 步)的改動以 `exile-appraiser:` 註解標出:走勢圖改手繪 SVG(不加 apexcharts)、
  只顯示 poe.ninja exchange 類(通貨價格區)、沒有價格整塊不顯示、上游缺的字串改 ppz.*、外開走 Host.openExternal。
  2026-10-14 B 改版:本檔呈現層已重寫 —— 模板改為 renderer `price-panel/PriceHero.vue`(mode="currency",設計稿 PricePanelBCurrency
  「市價」卡;圖示走 currencyIcon('poe2', …) = /images/poe2/);本檔只組資料(`market`),價格 / 走勢 / 成交量的計算與只顯示 cx 類的條件不變。
-->
<template>
  <price-hero v-if="priceData && market" game="poe2" mode="currency" :market="market" @open="openNinja" />
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
import { ParsedItem } from "@/parser";
import { artificialSlowdown } from "../trade/artificial-slowdown";
import { ItemFilters } from "../filters/interfaces";
import { AppConfig } from "@/web/Config";
import { PriceCheckWidget } from "@/web/overlay/interfaces";
// 2026-10-14 B 改版:呈現改 PriceHero(走勢圖仍是手繪 SVG PriceSparkline,在 PriceHero 內)
import PriceHero from "@/web/price-panel/PriceHero.vue";
import type { MarketView } from "@/web/price-panel/price-hero";
// exile-appraiser: 「通貨每小時成交量」四選一的判斷與外開走 Host
import { volumeParts as volumePartsOf } from "@/web/background/price-trend";
import { Host } from "@/web/background/IPC";

const slowdown = artificialSlowdown(800);

export default defineComponent({
  components: {
    PriceHero,
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

    const volumeParts = computed(() => volumePartsOf(volumeSetting.value));
    const valuableBasetype = computed(() => isValuableBasetype(props.item));

    // 2026-10-14 B 改版:PriceHero 通貨模式的資料(數字與單位照原本的 priceData)
    const market = computed<MarketView | undefined>(() => {
      const pd = priceData.value;
      if (!pd) return undefined;
      const vol = pd.volume;
      // 上游 displayRounding 的小數點寫成「 . 」(PoE2 字型);價格區用等寬字,改回一般小數點
      const dot = (x: string) => x.replace(/ \. /g, ".");
      return {
        loading: !valuableBasetype.value && !slowdown.isReady.value,
        itemIcon: props.item.info.icon,
        itemName: props.item.info.name,
        rate: pd.price,
        fraction: props.filters.stackSize != null,
        change: pd.change,
        volumeValue:
          vol && volumeParts.value.value
            ? { amount: dot(vol.primaryVolumePerHour), unit: vol.currency }
            : undefined,
        volumeItems:
          vol && volumeParts.value.item ? { amount: dot(vol.itemsPerHour) } : undefined,
        highest: vol?.highestVolumeCurrency,
      };
    });

    return {
      t,
      priceData,
      market,
      openNinja() {
        // exile-appraiser: window.open → Host.openExternal(系統瀏覽器)
        void Host.openExternal(priceData.value!.url);
      },
      isValuableBasetype: valuableBasetype,
      slowdown,
      // exile-appraiser: 上游在模板直接比對 volumeSetting 字串;改用 volumeParts(none / value / item / both)
      volumeParts,
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
