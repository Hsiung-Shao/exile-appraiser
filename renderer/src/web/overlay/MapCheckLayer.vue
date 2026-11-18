<!--
  2026-11-18 PoE1 地圖詞綴檢查的 overlay 圖層(對應 APT `item-check/WidgetItemCheck.vue`,MIT):
  照上游的錨點 —— 游標在畫面右半(背包)就貼在背包面板左側,左半(倉庫)就貼在倉庫面板右側,垂直置中。
  overlay 取得焦點(熱鍵 focusOverlay)期間顯示,失焦 / 點背景 / 查價面板打開時由 App.vue 收起。
  上色依正則書籤(`map-check-bookmark.ts`;設定 `mapCheckBookmark`,視窗裡換書籤也寫回設定 = 新的預設)。
-->
<template>
  <div class="map-check-layer absolute inset-0 flex items-center pointer-events-none"
    :class="side === 'stash' ? 'justify-start' : 'justify-end'"
    :style="side === 'stash' ? { paddingLeft: 'var(--game-panel)' } : { paddingRight: 'var(--game-panel)' }"
    data-layer="map-check">
    <div class="pointer-events-auto max-h-full overflow-y-auto">
      <error-boundary :reset-key="itemKey" where="map-check">
        <map-check :item="item" :bookmarks="labels" :bookmark="current ? list.indexOf(current) : -1" :mark-of="markOf"
          @update:bookmark="select" />
      </error-boundary>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, shallowRef, type PropType } from 'vue'
import type { RegexPage } from '@exile-appraiser/regex'
import type { ParsedItem } from '@/parser'
import MapCheck from '@poe1/map-check/MapCheck.vue'
import ErrorBoundary from '../ui/ErrorBoundary.vue'
import { AppConfig } from '../Config'
import { catalogueFor, ensureStateLoaded, useRegexStore } from '../regex/store'
import { bookmarkLabels, bookmarkMarks, mapCheckBookmarks, mapCheckRefOf, markOfStat, pickMapCheckBookmark } from '../map-check-bookmark'

export default defineComponent({
  components: { MapCheck, ErrorBoundary },
  props: {
    item: { type: Object as PropType<ParsedItem>, required: true },
    side: { type: String as PropType<'stash' | 'inventory'>, required: true },
    itemKey: { type: Number, required: true }
  },
  setup () {
    const config = AppConfig()
    const { ui } = useRegexStore()
    const pages = shallowRef<readonly RegexPage[]>([])
    void ensureStateLoaded()
    void catalogueFor('poe1').then(c => { pages.value = c?.pages ?? [] })
    const list = computed(() => mapCheckBookmarks(ui.bookmarks))
    const current = computed(() => pickMapCheckBookmark(list.value, config.mapCheckBookmark))
    const marks = computed(() => bookmarkMarks(pages.value, current.value))
    return {
      list,
      labels: computed(() => bookmarkLabels(list.value)),
      current,
      markOf: (matchers: ReadonlyArray<{ string: string }>, text?: string) => markOfStat(marks.value, matchers, text),
      select (i: number) {
        const b = list.value[i]
        if (!b) return
        config.mapCheckBookmark = mapCheckRefOf(b, list.value)
        console.log(`[map-check] 換書籤 ${b.folder ? `${b.folder} / ` : ''}${b.name}`)
      }
    }
  }
})
</script>
