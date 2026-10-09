<!--
  Poe Regex 物品詞綴數值頁(第 37 步,2026-10-04):`item_mod_values`(PoE1)/ `item_mod_values_poe2`(PoE2)。
  第一次開頁才載入兩語 stats.ndjson(store `ensureItemMods`);幾千條詞綴,所以先篩選(搜尋繁中 / 英文模板、常用分類、只看已勾選)
  再交給 RegexAlgoList.vue 畫(`rows-only`,已勾選的永遠在最上面,其餘最多 CAP 列)。篩選是純函式 `filterItemMods`(regex/src/pages/item-mods.ts)。
  搜尋字 / 分類記在 store 的 `views[page.id]`(與語料頁相同,不存檔)。
-->
<template>
  <section class="card rx-imv" data-regex="imv" :data-page="page.id" :data-phase="phase">
    <p v-if="phase === 'error'" class="rx-bad" data-regex="imv-error">
      {{ t('ppz.regex.imv_failed', { error: state.error }) }}
      <button class="btn sm" data-regex="imv-retry" @click="retry">{{ t('ppz.regex.retry') }}</button>
    </p>
    <p v-else-if="phase !== 'ready'" class="rx-loading pulse" data-regex="imv-loading">{{ t('ppz.regex.imv_loading') }}</p>
    <template v-else>
      <div class="rx-toolbar">
        <input v-model="view.search" class="input sm rx-search" type="search" :placeholder="t('ppz.regex.imv_search_ph')"
          data-regex="imv-search">
        <select v-model.number="view.group" class="select sm" data-regex="imv-group">
          <option :value="-1">{{ t('ppz.regex.group_all') }} ({{ page.entries.length }})</option>
          <option v-for="(g, i) in groups" :key="i" :value="i">{{ g }} ({{ counts[i] }})</option>
        </select>
        <label class="chk rx-imv-picked">
          <input v-model="pickedOnly" type="checkbox" data-regex="imv-picked-only">
          <span>{{ t('ppz.regex.imv_picked_only') }}</span>
        </label>
        <span class="grow" />
        <span class="dim num rx-imv-count" data-regex="imv-count">{{ t('ppz.regex.imv_count', { shown: filtered.rows.length, total: filtered.total }) }}</span>
      </div>
      <p class="dim rx-imv-note" data-regex="imv-note">{{ t('ppz.regex.imv_note') }}</p>
      <p v-if="formsMissing" class="rx-bad" data-regex="imv-forms-missing">{{ t('ppz.regex.imv_forms_missing') }}</p>
      <p v-if="filtered.total > filtered.rows.length" class="dim rx-imv-more" data-regex="imv-more">
        {{ t('ppz.regex.imv_more', { n: filtered.total - filtered.rows.length }) }}
      </p>
      <p v-if="!filtered.rows.length" class="rx-empty" data-regex="imv-empty">{{ t('ppz.regex.empty_filter') }}</p>
    </template>
  </section>
  <RegexAlgoList v-if="phase === 'ready' && filtered.rows.length" :page="page" :rows-only="filtered.rows"
    :hint="t('ppz.regex.imv_hint')" />
</template>

<script lang="ts">
import { computed, defineComponent, shallowRef, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { filterItemMods, itemModGroupCounts, type AlgoPage } from '@exile-appraiser/regex'
import { AppConfig } from '@/web/Config'
import RegexAlgoList from './RegexAlgoList.vue'
import { picksOf, retryItemMods, useRegexStore } from './store'

/** 篩選後最多畫幾列(已勾選的另外全部畫) */
const CAP = 150

export default defineComponent({
  components: { RegexAlgoList },
  props: {
    page: { type: Object as PropType<AlgoPage>, required: true }
  },
  setup (props) {
    const { t } = useI18n()
    const store = useRegexStore()
    const config = AppConfig()
    const pickedOnly = shallowRef(false)
    const state = computed(() => store.itemMods[props.page.game])
    const groups = computed(() => props.page.groups.map((g, i) => (config.uiLanguage === 'en' ? props.page.groupsEn[i] : '') || g))
    const filtered = computed(() => filterItemMods(props.page, picksOf(props.page.id), {
      search: store.view.value.search,
      group: store.view.value.group,
      pickedOnly: pickedOnly.value
    }, CAP))
    return {
      t,
      state,
      phase: computed(() => state.value.phase),
      formsMissing: computed(() => state.value.formsMissing),
      view: store.view,
      groups,
      counts: computed(() => itemModGroupCounts(props.page)),
      pickedOnly,
      filtered,
      retry: () => retryItemMods(props.page.game)
    }
  }
})
</script>

<style>
.rx-imv {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rx-imv-picked {
  font-size: var(--fs-xs);
}
.rx-imv-count {
  font-size: var(--fs-xs);
}
.rx-imv-note,
.rx-imv-more {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
</style>
