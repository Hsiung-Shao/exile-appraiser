<!--
  Poe Regex「已選(合併)」檢視(WP-C):目前遊戲各頁的勾選數與每頁貢獻長度、自訂文字與排除詞(chips)、合併衝突。
  合併規則在 regex/src/combine.ts;這裡只顯示與編輯 custom / excludes。
-->
<template>
  <section class="card rx-comb" data-regex="combined">
    <div class="rx-toolbar">
      <span class="label rx-comb-title">{{ t('ppz.regex.combined_title', { game: gameLabel(selGame) }) }}</span>
      <span class="grow" />
      <button class="btn sm" data-regex="clear-all" :disabled="!pages.length" @click="clearAllPicks">{{ t('ppz.regex.clear_all') }}</button>
    </div>

    <p v-if="!pages.length" class="rx-comb-empty">{{ t('ppz.regex.combined_empty') }}</p>
    <table v-else class="rx-comb-table" data-regex="combined-pages">
      <thead>
        <tr>
          <th>{{ t('ppz.regex.col_page') }}</th>
          <th class="num">{{ t('ppz.regex.col_picked') }}</th>
          <th class="num">{{ t('ppz.regex.col_length') }}</th>
          <th class="num">{{ t('ppz.regex.col_unresolved') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in pages" :key="x.page.id" :data-page="x.page.id">
          <td>
            <a href="#" class="rx-comb-link" @click.prevent="switchPage(x.page.id)">{{ pageTitle(x.page) }}</a>
            <span v-if="x.algo" class="chip soft rx-comb-kind">{{ t('ppz.regex.kind_algo') }}</span>
          </td>
          <td class="num" data-col="picked">{{ x.n }}</td>
          <td class="num" data-col="length">{{ x.contrib?.length ?? 0 }}</td>
          <td class="num" :class="{ warn: (x.contrib?.unresolved ?? 0) > 0 }" data-col="unresolved">{{ x.contrib?.unresolved ?? 0 }}</td>
        </tr>
        <tr v-if="combined && combined.custom.length" data-page="@custom">
          <td>{{ t('ppz.regex.custom') }}</td>
          <td class="num">{{ combined.custom.length }}</td>
          <td class="num" data-col="length">{{ combined.customLength }}</td>
          <td class="num">—</td>
        </tr>
        <tr v-if="combined && combined.excludes.length" data-page="@excludes">
          <td>{{ t('ppz.regex.excludes') }}</td>
          <td class="num">{{ combined.excludes.length }}</td>
          <td class="num" data-col="length">{{ combined.excludesLength }}</td>
          <td class="num">—</td>
        </tr>
      </tbody>
    </table>

    <div v-for="kind in kinds" :key="kind" class="rx-chips-block" :data-regex="`${kind}-block`">
      <div class="rx-chips-head">
        <span class="label">{{ t(`ppz.regex.${kind}`) }}</span>
        <span class="dim">{{ t(`ppz.regex.${kind}_hint`) }}</span>
      </div>
      <div class="rx-chips">
        <span v-for="(c, i) in ui[kind]" :key="c" class="rx-chip" :data-chip="c">
          {{ c }}<button class="rx-chip-x" :title="t('ppz.regex.remove')" :data-regex="`${kind}-remove`" @click="removeCustom(kind, i)">×</button>
        </span>
        <input v-model="drafts[kind]" class="input sm rx-chip-input" :placeholder="t(`ppz.regex.${kind}_ph`)"
          :data-regex="`${kind}-input`" @keydown.enter.prevent="add(kind)">
        <button class="btn sm" :disabled="!drafts[kind].trim()" :data-regex="`${kind}-add`" @click="add(kind)">{{ t('ppz.regex.add') }}</button>
      </div>
      <p v-if="kind === 'custom' && ui.custom.length" class="dim rx-chips-note">{{ t('ppz.regex.custom_unverified') }}</p>
    </div>

    <details v-if="combined && combined.conflicts.length" class="rx-details" open data-regex="conflicts">
      <summary class="rx-warn">{{ t('ppz.regex.conflicts', { n: combined.conflicts.length }) }}</summary>
      <ul>
        <li v-for="(c, i) in combined.conflicts" :key="i" :data-kind="c.kind">
          {{ t(`ppz.regex.conflict_${c.kind}`, { page: c.page ? pageTitleById(c.page) : '', text: c.text }) }}
        </li>
      </ul>
    </details>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { isAlgoPage, type RegexPage } from '@exile-appraiser/regex'
import { AppConfig } from '@/web/Config'
import { addCustom, clearAllPicks, gameLabel, removeCustom, switchPage, useRegexStore } from './store'

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const store = useRegexStore()
    const config = AppConfig()
    const uiEn = computed(() => config.uiLanguage === 'en')
    const drafts = reactive({ custom: '', excludes: '' })
    const pageTitle = (p: RegexPage) => (uiEn.value ? p.titleEn : '') || p.title

    const pages = computed(() => store.pickedPages.value.map(x => ({
      ...x,
      algo: isAlgoPage(x.page),
      contrib: store.combined.value?.perPage.find(c => c.id === x.page.id)
    })))

    return {
      t,
      ui: store.ui,
      selGame: store.selGame,
      combined: store.combined,
      pages,
      drafts,
      kinds: ['custom', 'excludes'] as Array<'custom' | 'excludes'>,
      gameLabel,
      pageTitle,
      pageTitleById: (id: string) => { const p = store.pageById(id); return p ? pageTitle(p) : id },
      switchPage,
      clearAllPicks,
      removeCustom,
      add (kind: 'custom' | 'excludes') {
        if (addCustom(kind, drafts[kind])) drafts[kind] = ''
      }
    }
  }
})
</script>

<style>
.rx-comb {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rx-comb-title {
  margin: 0 !important;
}
.rx-comb-empty {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
.rx-comb-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}
.rx-comb-table th {
  padding: 4px 8px;
  border-bottom: 1px solid var(--edge-1);
  color: var(--ink-3);
  font-size: var(--fs-2xs);
  font-weight: 600;
  text-align: left;
}
.rx-comb-table td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--edge-0);
  color: var(--ink-1);
}
.rx-comb-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.rx-comb-table .warn {
  color: var(--warn);
}
.rx-comb-link {
  color: var(--ink-0);
  text-decoration: none;
}
.rx-comb-link:hover {
  color: var(--gold);
  text-decoration: underline;
}
.rx-comb-kind {
  margin-left: 6px;
}
.rx-chips-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rx-chips-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.rx-chips-head .label {
  margin: 0 !important;
}
.rx-chips-head .dim,
.rx-chips-note {
  margin: 0;
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.rx-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}
.rx-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 3px 1px 9px;
  border: 1px solid var(--edge-1);
  border-radius: 11px;
  background: var(--surface-1);
  color: var(--ink-0);
  font-size: var(--fs-xs);
}
.rx-chip-x {
  border: 0;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  font-size: var(--fs-sm);
  line-height: 1;
  padding: 0 4px;
}
.rx-chip-x:hover {
  color: var(--bad);
}
.rx-chip-input {
  flex: 0 1 180px;
  min-width: 120px;
}
</style>
