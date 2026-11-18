<!--
  設定 › 正則(2026-11-18 設定重整:分成兩個子分頁)。
  - 「產生器」:Poe Regex 面板(WP5,renderer/src/web/regex/RegexPanel.vue `part="generator"`)。
  - 「書籤與快捷」:地圖詞綴檢查用的書籤(MapCheckCard.vue,PoE1)、書籤列開關、書籤清單(RegexBookmarks.vue,由 RegexPanel `part="bookmarks"` 畫)。
    頁頂「這頁的熱鍵」唯讀列出快速面板與地圖詞綴檢查熱鍵(在熱鍵總表編輯;只在 overlay 模式註冊 → 不是 overlay 時不列)。
  子分頁狀態在 ../tabState.ts `regexView`(熱鍵總表點書籤列、PobTools 送來書籤時切到「書籤與快捷」)。
  RegexPanel 兩個子分頁都掛著(只切 v-show),書籤對話框(Teleport)從產生器的「存成自訂書籤」也開得起來。
-->
<template>
  <!-- 2026-11-18 設計稿 P10 / P11:子分頁是底線樣式 -->
  <div class="tabs sub-tabs" role="tablist" data-setting="regex-view">
    <button v-for="v in views" :key="v.id" type="button" role="tab" class="tab" :class="{ on: regexView === v.id }" :aria-selected="regexView === v.id"
      :data-value="v.id" @click="regexView = v.id">{{ v.label }}</button>
  </div>
  <template v-if="regexView === 'bookmarks'">
    <page-hotkeys :ids="['regexQuick', 'map-check']" />
    <!-- 設計稿 P11:地圖詞綴檢查與書籤列兩張小卡並排(窄時上下排);書籤列用開關 -->
    <div class="rx-bm-cards">
      <map-check-card v-if="config.game === 'poe1'" />
      <section class="card" data-setting="regex-quick">
        <div class="card-head">
          <span class="label">{{ t('ppz.regex.quick_section') }}</span>
          <help-tip id="regex-quick" :text="t('ppz.regex.quick_section_hint')" />
          <span class="grow" />
          <label class="scan-switch" :title="t('ppz.regex.quick_bar_toggle')"><input v-model="config.regexBookmarkBar" type="checkbox" role="switch" :aria-checked="config.regexBookmarkBar" :aria-label="t('ppz.regex.quick_bar_toggle')" data-setting="regex-bookmark-bar"><span class="scan-switch-track" aria-hidden="true"><span class="scan-switch-knob" /></span></label>
        </div>
        <p class="lead">{{ t('ppz.regex.quick_bar_toggle') }}</p>
      </section>
    </div>
  </template>
  <RegexPanel :part="regexView" />
</template>

<script lang="ts">
import { computed, defineComponent, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import RegexPanel from '@/web/regex/RegexPanel.vue'
import MapCheckCard from '@/web/regex/MapCheckCard.vue'
import { bookmarkReveal } from '@/web/regex/store'
import { AppConfig } from '@/web/Config'
import HelpTip from '../HelpTip.vue'
import PageHotkeys from '../PageHotkeys.vue'
import { regexView } from '../tabState'

export default defineComponent({
  components: { RegexPanel, MapCheckCard, HelpTip, PageHotkeys },
  setup () {
    const { t } = useI18n()
    // PobTools 送來的書籤加入後(store `bookmarkReveal`)→ 切到書籤子分頁再讓書籤卡片捲過去
    watch(bookmarkReveal, (r) => { if (r) regexView.value = 'bookmarks' })
    return {
      t,
      config: AppConfig(),
      regexView,
      views: computed(() => [
        { id: 'generator' as const, label: t('ppz.regex.view_generator') },
        { id: 'bookmarks' as const, label: t('ppz.regex.view_bookmarks') }
      ])
    }
  }
})
</script>

<style>
.settings-panel .sub-tabs {
  flex-shrink: 0;
}
.settings-panel .rx-bm-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(18em, 100%), 1fr));
  gap: 12px;
}
.settings-panel .rx-bm-cards .card-head .grow {
  flex: 1;
}
.settings-panel .rx-bm-cards .lead {
  margin: 0;
}
</style>
