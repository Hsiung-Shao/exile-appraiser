<!--
  exile-appraiser:移植自 Awakened PoE Trade `renderer/src/web/map-check/settings-maps.vue`(MIT,© Alexander Drozdov)。
  耦合點:
  - 設定來源:上游 `findWidget('item-check').maps` → prop `config`(renderer 傳 `AppConfig().mapCheck`)。
  - 標記以 stat ref 為鍵;詞綴清單與篩選搬到 `common.ts`(`areaModRows` 一個 ref 一列、`filterAreaMods`)。
  - 拿掉 VirtualScroll(清單約 300 列,直接畫;設定視窗的內容區自己捲動)。
  - 上方多一列設定檔切換(上游只能在地圖檢查視窗切;設定頁標記的是目前設定檔)。
  - UiToggle 改用 `@/web/ui/…`;`useI18nNs` 改 `useI18n` + 完整鍵。
-->
<template>
  <div class="flex flex-col">
    <div class="flex p-1 items-center gap-2 flex-wrap">
      <input :placeholder="t('Search') + '...'" v-model="search" class="input sm">
      <UiToggle v-model="onlySelected" class="mx-2">{{ t('map_check.search_selected') }}</UiToggle>
      <UiToggle v-model="config.showNewStats">{{ t('map_check.new_mods_icon') }}</UiToggle>
      <span class="grow" />
      <span class="text-ink-2">{{ t('map_check.profile') }}</span>
      <div class="flex gap-0.5">
        <button v-for="p in [1, 2, 3]" :key="p" class="btn sm" :class="{ on: config.profile === p }"
          @click="config.profile = p">{{ ['I', 'II', 'III'][p - 1] }}</button>
      </div>
    </div>
    <div class="flex items-baseline py-1 shadow-sm">
      <div class="flex-1 px-2 leading-none">{{ t('map_check.search_stat_col', [filteredStats.length]) }}</div>
      <div class="flex gap-x-1 text-center items-center" style="padding-right: calc(0.875em + 2.350em);">
        <i class="w-8 py-1 bg-orange-600 fas fa-exclamation-triangle"></i>
        <i class="w-8 py-1 bg-red-700 fas fa-skull-crossbones"></i>
        <i class="w-8 py-1 bg-green-700 fas fa-check"></i>
      </div>
    </div>
    <div>
      <SettingsMatcherEntry v-for="item in filteredStats" :key="(item.tag === StatTag.Outdated ? 'x:' : '') + item.ref"
        :matcher="item"
        :selected-stats="config.selectedStats"
        :profile="config.profile" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { areaModRows, decisionHasColor, filterAreaMods, isOutdated, StatTag, type MapCheckConfig, type StatMatcher } from './common.js'

import UiToggle from '@/web/ui/UiToggle.vue'
import SettingsMatcherEntry from './SettingsMatcherEntry.vue'

const props = defineProps<{
  config: MapCheckConfig
}>()

const selectedProfileMatchers = computed(() => {
  const { profile } = props.config
  const matchers = new Set<string>()
  for (const entry of props.config.selectedStats) {
    if (decisionHasColor(entry.decision, profile)) {
      matchers.add(entry.ref)
    }
  }
  return matchers
})

const outdatedTranslationList = computed<StatMatcher[]>(() => {
  const { profile } = props.config
  return props.config.selectedStats
    .filter(entry => isOutdated(profile, entry))
    .map(entry => ({ ref: entry.ref, matchStr: entry.ref, tag: StatTag.Outdated }))
})

const areaStatsDb = computed(() => areaModRows())
const search = ref('')
const onlySelected = ref(false)
const filteredStats = computed<StatMatcher[]>(() => [
  ...outdatedTranslationList.value,
  ...filterAreaMods(areaStatsDb.value, search.value, onlySelected.value, selectedProfileMatchers.value)
])

const { t } = useI18n()
</script>
