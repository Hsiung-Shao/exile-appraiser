<template>
  <div class="py-2 border-b border-gray-700 flex flex-col ppz-unknown-mod">
    <!-- exile-appraiser: ppz-unknown-mod = 就地回報列的左右間隔與淡黃底(樣式在 renderer ui/ReportInline.vue) -->
    <div class="pb-1 flex items-baseline">
      <i class="w-5 shrink-0 fas fa-exclamation-triangle text-orange-400"></i>
      <div class="search-text mr-1 relative flex min-w-0" style="line-height: 1rem;">
        <span class="truncate"><ItemModifierText :text="stat.text" /></span>
        <span class="search-text-full whitespace-pre-wrap cursor-default"><ItemModifierText :text="stat.text" /></span>
      </div>
    </div>
    <div class="ml-5 text-xs leading-none flex items-center gap-x-2">
      <span><span class="text-gray-600">{{ t(stat.type) }} &mdash; </span>
      <span class="text-orange-400">{{ t('Not recognized modifier') }}</span></span>
      <span class="grow" />
      <report-inline mode="mod" :detail="stat.text" />
    </div>
  </div>
</template>

<script setup lang="ts">
// exile-appraiser: ui/ 元件住在 renderer package,相對路徑 ../../ui 改成 @/web/ui alias
import { useI18n } from 'vue-i18n'
import { ParsedItem } from '@/parser'

import ItemModifierText from '@/web/ui/ItemModifierText.vue'
// exile-appraiser: 就地回報(2026-10-08):未解析詞綴旁直接放「回報這條」(沒有宿主注入時不畫)
import ReportInline from '@/web/ui/ReportInline.vue'

defineProps<{
  stat: ParsedItem['unknownModifiers'][number]
}>()

const { t } = useI18n()
</script>
