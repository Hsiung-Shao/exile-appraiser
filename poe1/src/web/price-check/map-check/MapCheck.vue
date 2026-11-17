<!--
  exile-appraiser:移植自 Awakened PoE Trade `renderer/src/web/map-check/MapCheck.vue`(MIT,© Alexander Drozdov)。
  耦合點:
  - MapStatButton 的 key 改用 stat ref(標記鍵)。
  - 拿掉地圖截圖(FullscreenImage):資料裡只有 14 張地圖有截圖,而且是 imgur 外部網址(overlay 不連外部圖庫)。
  - 外框 / 底色改用主題 token(bg-surface / border),不寫死 gray-800,背景圖模式與淺色主題才看得清楚。
  - Tailwind 4:`<style>` 加 `@reference`。
-->
<template>
  <div class="map-check text-ink-0"
    style="min-width: 20rem; max-width: min(100vw - var(--game-panel), 30rem);">
    <div class="map-check-head py-1 px-8 flex items-baseline gap-2">
      <div class="flex-1 text-center">{{ mapName }}</div>
      <div class="ml-8 text-ink-2">{{ t('map_check.profile') }}</div>
      <div class="flex gap-0.5">
        <button
          v-for="profile in profiles" :key="profile.text"
          @click="profile.select"
          :class="{ 'border border-gray-600': profile.active }"
          class="w-6 map-check-profile"
        >{{ profile.text }}</button>
      </div>
    </div>
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
          :stat="stat" :config="config" />
        <div v-for="stat of unknownModifiers" :key="stat.type + '/' + stat.text"
          class="py-1 px-8">
          <span class="text-orange-400">{{ t('Not recognized modifier') }} &mdash;</span> {{ stat.text }}
        </div>
      </div>
    </div>
    <div v-if="hasOutdatedTranslation"
      class="py-2 px-8 map-check-outdated">{{ t('map_check.has_outdated') }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ParsedItem } from '@/parser'
import { ModifierType } from '@/parser/modifiers'
import { prepareMapStat } from './prepare-map-stats'
import { type MapCheckConfig, isOutdated } from './common.js'

import MapStatButton from './MapStatButton.vue'

const props = defineProps<{
  item: ParsedItem,
  config: MapCheckConfig
}>()

const { t } = useI18n()

const MEMORY_MAPS = [
  'Courtyard of Wasting',
  'Chambers of Impurity',
  'Theatre of Lies'
]

const hasOutdatedTranslation = computed<boolean>(() => {
  const { profile } = props.config
  return props.config.selectedStats
    .some(entry => isOutdated(profile, entry))
})

const mapName = computed(() => {
  const { item } = props
  if (item.info.area?.blighted) {
    return item.info.name
  }
  return item.mapArea?.name ?? item.info.name
})

const mapStats = computed(() => props.item.statsByType
  .filter(calc => calc.type === ModifierType.Explicit)
  .map(calc => prepareMapStat(calc)))

const unknownModifiers = computed(() => props.item.unknownModifiers
  .filter(mod => mod.type === ModifierType.Explicit))

const profiles = computed(() => {
  const ROMAN_NUMERALS = ['I', 'II', 'III']
  return ROMAN_NUMERALS.map((text, i) => ({
    text,
    active: (props.config.profile === i + 1),
    select: () => { props.config.profile = i + 1 }
  }))
})
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
.map-check-profile { background: var(--surface-1); }
.map-check-outdated { background: var(--surface-2); }
</style>
