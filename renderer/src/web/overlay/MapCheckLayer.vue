<!--
  2026-11-18 PoE1 地圖詞綴檢查的 overlay 圖層(對應 APT `item-check/WidgetItemCheck.vue`,MIT):
  照上游的錨點 —— 游標在畫面右半(背包)就貼在背包面板左側,左半(倉庫)就貼在倉庫面板右側,垂直置中。
  overlay 取得焦點(熱鍵 focusOverlay)期間顯示,失焦 / 點背景 / 查價面板打開時由 App.vue 收起。
-->
<template>
  <div class="map-check-layer absolute inset-0 flex items-center pointer-events-none"
    :class="side === 'stash' ? 'justify-start' : 'justify-end'"
    :style="side === 'stash' ? { paddingLeft: 'var(--game-panel)' } : { paddingRight: 'var(--game-panel)' }"
    data-layer="map-check">
    <div class="pointer-events-auto max-h-full overflow-y-auto">
      <error-boundary :reset-key="itemKey" where="map-check">
        <map-check :item="item" :config="config.mapCheck" />
      </error-boundary>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import type { ParsedItem } from '@/parser'
import MapCheck from '@poe1/map-check/MapCheck.vue'
import ErrorBoundary from '../ui/ErrorBoundary.vue'
import { AppConfig } from '../Config'

export default defineComponent({
  components: { MapCheck, ErrorBoundary },
  props: {
    item: { type: Object as PropType<ParsedItem>, required: true },
    side: { type: String as PropType<'stash' | 'inventory'>, required: true },
    itemKey: { type: Number, required: true }
  },
  setup () {
    return { config: AppConfig() }
  }
})
</script>
