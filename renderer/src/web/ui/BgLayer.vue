<!--
  exile-appraiser(第 30.6 步,2026-10-03):自訂背景圖層的閘門。放在 `.bg-host` 容器(查價面板 #price-window、設定視窗)裡;
  **背景開著(`bgShownUrl` 有值)且容器顯示中(`shown`)才掛載本體 BgLayerImage.vue**,否則什麼都不畫:
  沒有 `.bgimg` / `.bgtint` DOM、沒有 ResizeObserver / MutationObserver / watcher、不載入也不預先處理圖。
  - 查價面板在 App.vue 是 `v-show` 藏起(元件不卸載),所以 App.vue 把同一個可見條件傳進 `shown`;設定視窗本身是 v-if,預設 true。
  - 隱藏時本體卸載,畫好的圖交給 bg-bake.ts `bgBakeCache` 保留;再顯示時第一幀直接換上(不重畫、不閃)。
  本體的說明(預先處理、顯示位置 / 填滿方式、CSS 路徑)見 BgLayerImage.vue。
-->
<template>
  <bg-layer-image v-if="on" :host="host" />
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from 'vue'
import BgLayerImage from './BgLayerImage.vue'
import { bgShownUrl, type BgHost } from '../useTheme'

export default defineComponent({
  components: { BgLayerImage },
  props: {
    /** 這一層畫在哪個容器:查價面板(#price-window)/ 設定視窗 */
    host: { type: String as PropType<BgHost>, default: 'panel' },
    /** 容器目前是否顯示(查價面板的 v-show 條件);false = 卸載本體 */
    shown: { type: Boolean, default: true }
  },
  setup (props) {
    return { on: computed(() => props.shown && bgShownUrl.value != null) }
  }
})
</script>
