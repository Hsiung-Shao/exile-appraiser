<!--
  設定 › 正則 › 書籤與快捷:「地圖詞綴檢查」卡片(PoE1;2026-11-18 設定重整,原本是書籤卡片 PoE1 分頁裡的一列)。
  地圖詞綴檢查熱鍵依這裡選的正則書籤上色(設定 `mapCheckBookmark`,`map-check-bookmark.ts`):
  選項值 = 清單索引;沒選過且只有一個地圖書籤 → 顯示那一個(自動選);選「不上色」存 false。
-->
<template>
  <section class="card" data-regex="bm-map-check">
    <div class="card-head">
      <span class="label">{{ t('ppz.map_check.card_title') }}</span>
      <span class="chip soft">PoE1</span>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.map_check.default_label') }}</span>
      <div class="ctl">
        <select class="select sm" :value="mapCheckValue" :aria-label="t('ppz.map_check.default_label')"
          @change="setMapCheckBookmark(($event.target as HTMLSelectElement).value)">
          <option value="">{{ t('ppz.map_check.default_none') }}</option>
          <option v-for="(label, i) in mapCheckLabels" :key="i" :value="String(i)">{{ label }}</option>
        </select>
      </div>
    </div>
    <p class="lead">{{ t('ppz.map_check.default_lead') }}</p>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '@/web/Config'
import { useRegexStore } from './store'
import { bookmarkLabels, mapCheckBookmarks, mapCheckRefOf, pickMapCheckBookmark } from '../map-check-bookmark'

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    const store = useRegexStore()
    return {
      t,
      mapCheckLabels: computed(() => bookmarkLabels(mapCheckBookmarks(store.ui.bookmarks))),
      mapCheckValue: computed(() => {
        const list = mapCheckBookmarks(store.ui.bookmarks)
        const b = pickMapCheckBookmark(list, config.mapCheckBookmark)
        return b ? String(list.indexOf(b)) : ''
      }),
      setMapCheckBookmark (v: string) {
        const list = mapCheckBookmarks(store.ui.bookmarks)
        const b = v === '' ? undefined : list[Number(v)]
        config.mapCheckBookmark = b ? mapCheckRefOf(b, list) : false
      }
    }
  }
})
</script>
