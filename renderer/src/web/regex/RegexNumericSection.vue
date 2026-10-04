<!--
  Poe Regex 數值區(第 32 步,2026-10-04):地圖詞綴 / 換界石詞綴頁頂端的可收合區塊(階級、物品數量、稀有度、怪群大小…)。
  原本是下拉選單裡的獨立頁「地圖數值條件 / 換界石數值條件」,使用者找不到;現在與詞綴輸出合成同一條正則
  (store `pageCombined` / `combined` 走 `combineSels`,數值區緊接宿主頁)。
  列 UI 重用 RegexAlgoList.vue(`embedded`);預設展開,收合狀態存在 regex_state.json 的 `collapsed`,
  收合時標題列仍顯示已設條件的摘要(regex/src/view.ts `sectionSummary`)。
-->
<template>
  <section class="card rx-sec" data-regex="section" :data-page="section.id" :data-host="hostId"
    :data-collapsed="collapsed ? '1' : '0'">
    <button type="button" class="rx-sec-head" data-regex="section-toggle" :aria-expanded="!collapsed"
      :title="t(collapsed ? 'ppz.regex.section_expand' : 'ppz.regex.section_collapse')" @click="toggle">
      <span class="rx-sec-caret" aria-hidden="true">{{ collapsed ? '▸' : '▾' }}</span>
      <span class="rx-sec-title">{{ t('ppz.regex.section_title') }}</span>
      <span class="rx-sec-count num" data-regex="section-count">{{ t('ppz.regex.section_count', { n: picked.length, total: section.entries.length }) }}</span>
      <span v-if="contrib > 0" class="rx-sec-len num" data-regex="section-length">{{ t('ppz.regex.section_length', { n: contrib }) }}</span>
      <span v-if="collapsed" class="rx-sec-summary" data-regex="section-summary">
        <template v-if="summary.length">
          <span v-for="(s, i) in summary" :key="s.id" class="rx-sec-item" :class="{ bad: !s.cond }" :data-id="s.id">
            <template v-if="i"> · </template>{{ s.label }} {{ s.cond ?? t('ppz.regex.algo_invalid') }}
          </span>
        </template>
        <span v-else class="dim">{{ t('ppz.regex.section_none') }}</span>
      </span>
    </button>
    <RegexAlgoList v-if="!collapsed" :page="section" embedded />
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { sectionSummary, type AlgoPage } from '@exile-appraiser/regex'
import { AppConfig } from '@/web/Config'
import RegexAlgoList from './RegexAlgoList.vue'
import { isCollapsed, picksOf, setCollapsed, useRegexStore, valueOf } from './store'

export default defineComponent({
  components: { RegexAlgoList },
  props: {
    section: { type: Object as PropType<AlgoPage>, required: true }
  },
  setup (props) {
    const { t } = useI18n()
    const store = useRegexStore()
    const config = AppConfig()
    const hostId = computed(() => props.section.sectionOf ?? props.section.id)
    const collapsed = computed(() => isCollapsed(hostId.value))
    const picked = computed(() => picksOf(props.section.id))
    return {
      t,
      hostId,
      collapsed,
      picked,
      /** 這一區在目前單頁輸出裡的貢獻字數(片段 + 分隔) */
      contrib: computed(() => store.pageCombined.value?.perPage.find(c => c.id === props.section.id)?.length ?? 0),
      summary: computed(() => sectionSummary(props.section, picked.value, e => valueOf(props.section.id, e),
        config.uiLanguage === 'en' ? 'en' : 'zh')),
      toggle () {
        setCollapsed(hostId.value, !collapsed.value)
      }
    }
  }
})
</script>

<style>
.rx-sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rx-sec-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.rx-sec-head:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
  border-radius: var(--radius-s);
}
.rx-sec-caret {
  width: 1em;
  color: var(--ink-2);
}
.rx-sec-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--ink-0);
}
.rx-sec-count,
.rx-sec-len {
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.rx-sec-summary {
  flex: 1 1 100%;
  min-width: 0;
  padding-left: 1.6em;
  font-size: var(--fs-xs);
  color: var(--ink-2);
}
.rx-sec-summary .dim {
  color: var(--ink-3);
}
.rx-sec-item.bad {
  color: var(--bad);
}
</style>
