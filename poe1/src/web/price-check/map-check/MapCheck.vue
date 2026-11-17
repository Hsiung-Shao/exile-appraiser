<!--
  exile-appraiser:移植自 Awakened PoE Trade `renderer/src/web/map-check/MapCheck.vue`(MIT,© Alexander Drozdov)。
  耦合點:
  - 2026-11-18 起依正則書籤上色(使用者裁定):標題列的設定檔 I / II / III 換成正則書籤下拉(`bookmarks` / `bookmark` /
    `update:bookmark`),每列的紅 / 綠由 renderer 傳入的 `markOf(stat)` 決定;過時提示拿掉(書籤自己會標「找不到幾項」)。
  - MapStatButton 的 key 改用 stat ref。
  - 拿掉地圖截圖(FullscreenImage):資料裡只有 14 張地圖有截圖,而且是 imgur 外部網址(overlay 不連外部圖庫)。
  - 外框 / 底色改用主題 token(bg-surface / border),不寫死 gray-800,背景圖模式與淺色主題才看得清楚。
  - Tailwind 4:`<style>` 加 `@reference`。
-->
<template>
  <div class="map-check text-ink-0"
    style="min-width: 20rem; max-width: min(100vw - var(--game-panel), 30rem);">
    <div class="map-check-head py-1 px-8 flex items-baseline gap-2">
      <div class="flex-1 text-center">{{ mapName }}</div>
      <select v-if="bookmarks.length" class="select sm" :value="bookmark ?? ''" :aria-label="t('ppz.map_check.bookmark')"
        @change="emit('update:bookmark', ($event.target as HTMLSelectElement).value)">
        <option v-if="!bookmark" value="" disabled>{{ t('ppz.map_check.pick_bookmark') }}</option>
        <option v-for="name in bookmarks" :key="name" :value="name">{{ name }}</option>
      </select>
    </div>
    <div v-if="!bookmarks.length" class="py-2 px-8 map-check-outdated" data-hint="no-bookmark">{{ t('ppz.map_check.no_bookmark') }}</div>
    <div :class="$style.body">
      <div v-if="item.mapArea && MEMORY_MAPS.includes(item.mapArea.refName)"
        :class="$style.mavenReminder">
        <img src="/images/maven-witness.png" class="w-8">
        <span>{{ t('map_check.maven_reminder') }}</span>
      </div>
      <div v-if="!mapStats.length && !unknownModifiers.length" class="px-8">
        {{ t('map_check.no_mods') }}
      </div>
      <div v-else class="flex flex-col">
        <MapStatButton v-for="stat in mapStats" :key="stat.ref"
          :stat="stat" :mark="stat.mark" />
        <div v-for="stat of unknownModifiers" :key="stat.type + '/' + stat.text"
          class="py-1 px-8">
          <span class="text-orange-400">{{ t('Not recognized modifier') }} &mdash;</span> {{ stat.text }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ParsedItem } from '@/parser'
import { ModifierType } from '@/parser/modifiers'
import type { Stat } from '@/assets/data'
import { prepareMapStat } from './prepare-map-stats'

import MapStatButton from './MapStatButton.vue'

const props = defineProps<{
  item: ParsedItem,
  bookmarks: string[],
  bookmark: string | null,
  markOf: (stat: Stat) => 'bad' | 'good' | null
}>()

const emit = defineEmits<{ 'update:bookmark': [name: string] }>()

const { t } = useI18n()

const MEMORY_MAPS = [
  'Courtyard of Wasting',
  'Chambers of Impurity',
  'Theatre of Lies'
]

const mapName = computed(() => {
  const { item } = props
  if (item.info.area?.blighted) {
    return item.info.name
  }
  return item.mapArea?.name ?? item.info.name
})

const mapStats = computed(() => props.item.statsByType
  .filter(calc => calc.type === ModifierType.Explicit)
  .map(calc => ({ ...prepareMapStat(calc), mark: props.markOf(calc.stat) })))

const unknownModifiers = computed(() => props.item.unknownModifiers
  .filter(mod => mod.type === ModifierType.Explicit))

</script>

<style lang="postcss" module>
@reference "../../../../../renderer/src/theme/tailwind.css"; /* exile-appraiser: Tailwind 4,讓 @apply / theme() 認得 utility */

.body {
  display: flex;
  flex-direction: column;
  gap: theme('spacing.1');
  padding: theme('spacing.2') 0;
}

.mavenReminder {
  display: flex;
  align-items: center;
  gap: theme('spacing.2');
  padding: 0 theme('spacing.8');
  white-space: pre-wrap;
  font-style: italic;
  color: var(--ink-2);
  line-height: 1.25;
}
</style>

<style>
/* exile-appraiser: 主題 token(上游 bg-gray-800 / gray-900 / gray-700) */
.map-check { background: var(--surface-1); border: 4px solid var(--surface-0); }
.map-check-head { background: var(--surface-0); }
.map-check-outdated { background: var(--surface-2); }
</style>
