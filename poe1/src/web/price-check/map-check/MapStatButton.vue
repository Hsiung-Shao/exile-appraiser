<!--
  exile-appraiser:移植自 Awakened PoE Trade `renderer/src/web/map-check/MapStatButton.vue`(MIT,© Alexander Drozdov)。
  2026-11-18 起依正則書籤上色:不再點擊循環標記、沒有「已看過」鈕;`mark`(bad = 排除書籤命中 / good = 包含書籤命中)決定底色與圖示。
  ItemModifierText 改用 `@/web/ui/…`(renderer);Tailwind 4 `@reference`。
-->
<template>
  <div class="flex" :data-mark="mark ?? ''">
    <div :class="[$style.row, btnStyle().bg]">
      <i class="text-center w-4 shrink-0"
        :class="btnStyle().icon" />
      <ItemModifierText class="truncate"
        :text="stat.matcher" :roll="stat.roll" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useCssModule } from 'vue'
import { PreparedStat } from './prepare-map-stats'

import ItemModifierText from '@/web/ui/ItemModifierText.vue'

const props = defineProps<{
  stat: PreparedStat,
  mark: 'bad' | 'good' | null
}>()

const $style = useCssModule()

function btnStyle () {
  switch (props.mark) {
    case 'bad': return { bg: $style.danger, icon: 'fas fa-skull-crossbones' }
    case 'good': return { bg: $style.good, icon: 'fas fa-check' }
  }
  return { bg: undefined, icon: undefined }
}
</script>

<style lang="postcss" module>
@reference "../../../../../renderer/src/theme/tailwind.css"; /* exile-appraiser: Tailwind 4,讓 @apply / theme() 認得 utility */

.row {
  @apply p-2;
  display: flex;
  align-items: center;
  @apply gap-x-2;
  line-height: 1;
  text-align: left;
  overflow: hidden;
  flex: 1;

  &.danger { @apply bg-red-700; }
  &.good { @apply bg-green-700; }
}
</style>
