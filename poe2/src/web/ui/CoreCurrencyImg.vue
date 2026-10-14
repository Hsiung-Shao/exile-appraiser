<!--
  移植自 Exiled Exchange 2(Kvan7,MIT)經繁中 fork Exiled-Exchange-2-zh-TW(Hsiung-Shao,MIT)
  `renderer/src/web/ui/CoreCurrencyImg.vue`(fc7de73c),逐字。授權見 NOTICE.md / LICENSES/。
  同一張對照表的純函式版:renderer/src/web/background/price-trend.ts `coreCurrencyIcon`(PoE1 通貨價格區用)。
  exile-appraiser: 圖示路徑改 /images/poe2/(PoE2 自己的圖,見 renderer/public/images/poe2/SOURCE.json),不借 PoE1 的圖。
-->
<template>
  <div
    class="max-w-full max-h-full"
    :class="{ 'overflow-hidden': overflowHidden }"
  >
    <ui-item-img :icon="icon" />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent } from "vue";
import UiItemImg from "@/web/ui/UiItemImg.vue";

export default defineComponent({
  components: {
    UiItemImg,
  },
  props: {
    currency: {
      type: String,
      required: true,
    },
    overflowHidden: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const icon = computed(() => {
      switch (props.currency.toLowerCase().charAt(0)) {
        case "d":
          return "/images/poe2/divine.png";
        case "c":
          return "/images/poe2/chaos.png";
        case "e":
          return "/images/poe2/exa.png";
        case "a":
          return "/images/poe2/annul.png";
        default:
          return "/images/404.png";
      }
    });

    return {
      icon,
    };
  },
});
</script>
