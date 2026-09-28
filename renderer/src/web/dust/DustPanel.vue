<!--
  拆粉排行面板(WP-B;WP-Q 起一律停靠在查價下方,App.vue 的 .price-stack,入口是標題列的「⚖」顯示/收合)。
  標題列(一行):⚖ 標題、聯盟(唯讀,來自標題列選擇)· divine 匯率 · 資料時間、重新整理(usePoeninja().load(true))、
       選項展開/收合 ▾、收合 ✕(emit close)。
       台服:poe.ninja 沒有台服價格 → 提示 + 切到國際服;PoE2:拆粉只適用 PoE1。
  選項卡(.card,預設收合):ilvl、品質(.seg 0/20)、催化劑(auto/never)、gold 估值、效率指標、最低 dust、最高 gold、
       隱藏無價/低信心/已隱藏、交易站腐化與掛單時間、計算前提說明。選項與標記/隱藏存 userData/dust_ui.json(./store.ts);
       選項卡展開與否只在本次執行記住(不進檔)。
  表格在 ./DustTable.vue(虛擬捲動)。計算邏輯全在 @exile-appraiser/core/dust(有 vitest)。
-->
<template>
  <div class="dust-panel" data-panel="dust" :data-docked="docked ? '' : undefined">
    <header class="dust-head" data-dust="top">
      <span class="dust-title">⚖ {{ t('ppz.dust.title') }}</span>
      <span class="dust-meta">
        <span class="v" data-dust="league" :title="`${t('ppz.dust.league')}:${league || '—'}`">{{ league || '—' }}</span>
        <span class="sep">·</span>
        <span class="v num" data-dust="rate" :title="t('ppz.dust.rate')">{{ xchgRate ? t('ppz.dust.rate_value', { n: fmtRate(xchgRate) }) : '—' }}</span>
        <span class="sep">·</span>
        <span class="v" data-dust="time" :title="`${t('ppz.dust.data_time')}:${fetchedText}`">{{ fetchedText }}</span>
      </span>
      <button class="btn ghost sm dust-icon" :class="{ pulse: ninjaLoading }" data-action="dust-refresh"
        :disabled="ninjaLoading || !canPrice" :title="ninjaLoading ? t('ppz.dust.refreshing') : t('ppz.dust.refresh')"
        :aria-label="t('ppz.dust.refresh')" @click="refresh">⟳</button>
      <button class="btn ghost sm" :class="{ on: optsOpen }" data-action="dust-options" :aria-expanded="optsOpen"
        :title="optsOpen ? t('ppz.dust.options_hide') : t('ppz.dust.options_show')" @click="optsOpen = !optsOpen">{{ t('ppz.dust.options') }} {{ optsOpen ? '▴' : '▾' }}</button>
      <button class="btn ghost sm dust-icon" data-action="dust-close" :title="t('ppz.dust.collapse')" :aria-label="t('ppz.dust.collapse')"
        @click="$emit('close')">✕</button>
    </header>

    <div v-if="game !== 'poe1'" class="strip warn" data-strip="dust-poe2">{{ t('ppz.dust.poe1_only') }}</div>
    <div v-else-if="realm === 'tw'" class="strip warn" data-strip="dust-tw">
      <span class="grow">{{ t('ppz.dust.tw_hint') }}</span>
      <button class="btn sm" data-action="dust-switch-intl" @click="switchIntl">{{ t('ppz.switch_to_intl') }}</button>
    </div>
    <div v-else-if="!hasTarget" class="strip" data-strip="dust-no-league">{{ t('ppz.dust.no_league') }}</div>
    <div v-if="ninjaError && canPrice" class="strip bad" data-strip="dust-ninja-error">
      <span class="grow truncate">{{ t('ppz.ninja.error', { error: ninjaError }) }}</span>
      <button class="btn sm" data-action="dust-retry-ninja" @click="refresh">{{ t('Retry') }}</button>
    </div>
    <div v-if="saveError" class="strip bad" data-strip="dust-save-error">{{ t('ppz.dust.save_failed', { error: saveError }) }}</div>

    <div class="dust-body">
      <section v-if="optsOpen" class="card dust-opts" data-dust="options">
        <label class="dust-opt">
          <span class="k">{{ t('ppz.dust.opt_ilvl') }}</span>
          <input v-model.number="o.ilvl" class="input sm num dust-n" type="number" min="1" max="100" data-opt="ilvl">
        </label>
        <span class="dust-opt">
          <span class="k">{{ t('ppz.dust.opt_quality') }}</span>
          <span class="seg" data-opt="quality">
            <button v-for="q in [0, 20]" :key="q" :class="{ on: o.quality === q }" :data-value="q" @click="o.quality = (q as 0 | 20)">{{ q }}%</button>
          </span>
        </span>
        <span class="dust-opt" :title="t('ppz.dust.opt_catalyst_tip')">
          <span class="k">{{ t('ppz.dust.opt_catalyst') }}</span>
          <span class="seg" data-opt="catalyst">
            <button v-for="c in (['auto', 'never'] as const)" :key="c" :class="{ on: o.catalyst === c }" :data-value="c"
              @click="o.catalyst = c">{{ t(`ppz.dust.catalyst_${c}`) }}</button>
          </span>
        </span>
        <label class="dust-opt" :title="t('ppz.dust.opt_gold_value_tip')">
          <span class="k">{{ t('ppz.dust.opt_gold_value') }}</span>
          <input v-model.number="o.goldValueChaos" class="input sm num dust-n" type="number" min="0" step="0.1" data-opt="gold-value">
        </label>
        <label class="dust-opt wide">
          <span class="k">{{ t('ppz.dust.opt_metric') }}</span>
          <select v-model="o.metric" class="select sm" data-opt="metric">
            <option v-for="m in metrics" :key="m" :value="m">{{ t(`ppz.dust.metric_${m.replace(/\//g, '_')}`) }}</option>
          </select>
        </label>
        <label class="dust-opt">
          <span class="k">{{ t('ppz.dust.opt_min_dust') }}</span>
          <input v-model.number="o.minDust" class="input sm num dust-n wide-n" type="number" min="0" step="1000" data-opt="min-dust">
        </label>
        <label class="dust-opt">
          <span class="k">{{ t('ppz.dust.opt_max_gold') }}</span>
          <input v-model.number="o.maxGold" class="input sm num dust-n wide-n" type="number" min="0" step="1000" data-opt="max-gold">
        </label>
        <span class="dust-checks">
          <label class="chk"><input v-model="o.hideNoPrice" type="checkbox" data-opt="hide-no-price">{{ t('ppz.dust.hide_no_price') }}</label>
          <label class="chk"><input v-model="o.hideLowConfidence" type="checkbox" data-opt="hide-low-conf">{{ t('ppz.dust.hide_low_conf') }}</label>
          <label class="chk"><input v-model="o.hideHidden" type="checkbox" data-opt="hide-hidden">{{ t('ppz.dust.hide_hidden') }}</label>
        </span>
        <label class="dust-opt">
          <span class="k">{{ t('ppz.dust.opt_corrupted') }}</span>
          <select v-model="o.corrupted" class="select sm" data-opt="corrupted">
            <option v-for="c in (['any', 'false', 'true'] as const)" :key="c" :value="c">{{ t(`ppz.dust.corrupted_${c}`) }}</option>
          </select>
        </label>
        <label class="dust-opt">
          <span class="k">{{ t('ppz.dust.opt_indexed') }}</span>
          <select v-model="o.indexed" class="select sm" data-opt="indexed">
            <option v-for="i in indexedOptions" :key="i" :value="i">{{ t(`ppz.dust.indexed_${i}`) }}</option>
          </select>
        </label>
        <p class="dust-note">{{ t('ppz.dust.assumption') }}</p>
      </section>

      <div class="dust-listbar">
        <input v-model="search" class="input sm dust-search" type="search" :placeholder="t('ppz.dust.search_ph')" data-dust="search">
        <span class="dim dust-stats" data-dust="stats">{{ t('ppz.dust.stats', statsParams) }}</span>
      </div>

      <div v-if="phase === 'loading' || phase === 'idle'" class="dust-state pulse" data-dust="loading">{{ t('ppz.dust.loading') }}</div>
      <div v-else-if="phase === 'error'" class="card bad dust-state" data-dust="load-error">
        <span class="label">{{ t('ppz.dust.load_failed', { error: loadError }) }}</span>
        <button class="btn sm" data-action="dust-reload" @click="load(true)">{{ t('Retry') }}</button>
      </div>
      <dust-table v-else :rows="visible" />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { DUST_INDEXED_OPTIONS, DUST_METRICS } from '@exile-appraiser/core/dust'
import { AppConfig } from '@/web/Config'
import { usePoeninja } from '@/web/background/Prices'
import { useLeagues } from '@/web/background/Leagues'
import DustTable from './DustTable.vue'
import { useDustStore } from './store'

export default defineComponent({
  components: { DustTable },
  props: {
    /** 停靠在查價下方(WP-Q 起唯一版面;保留 prop 讓呼叫端表明意圖、樣式可掛 data-docked)。 */
    docked: { type: Boolean, default: true }
  },
  emits: ['close'],
  setup () {
    const { t } = useI18n()
    const store = useDustStore()
    const ninja = usePoeninja()
    const leagues = useLeagues()
    const config = AppConfig()
    /** 選項卡展開(預設收合,停靠時省高度)。 */
    const optsOpen = shallowRef(false)

    onMounted(() => {
      void store.load()
      // 開面板 = 有人要看價格:標記興趣,快照過期才抓(poe.ninja 只有國際服)
      ninja.queuePricesFetch()
    })

    const canPrice = computed(() => config.game === 'poe1' && config.realm === 'intl' && Boolean(leagues.selected.value?.isPopular))

    const fetchedText = computed(() => {
      const at = ninja.lastFetchedAt.value
      if (!at || !store.snapshot.value) return t('ppz.dust.never')
      return new Date(at).toLocaleString(config.uiLanguage === 'en' ? 'en-US' : 'zh-TW', { dateStyle: 'short', timeStyle: 'short' })
    })

    const statsParams = computed(() => {
      const s = store.ranked.value.stats
      return { shown: store.visible.value.length, total: s.total, priced: s.priced, low: s.lowConfidence }
    })

    return {
      t,
      optsOpen,
      o: store.ui.options,
      phase: store.phase,
      loadError: store.loadError,
      saveError: store.saveError,
      visible: store.visible,
      search: store.search,
      league: store.league,
      load: store.load,
      metrics: DUST_METRICS,
      indexedOptions: DUST_INDEXED_OPTIONS,
      statsParams,
      xchgRate: ninja.xchgRate,
      ninjaLoading: ninja.isLoading,
      ninjaError: ninja.lastError,
      fetchedText,
      canPrice,
      hasTarget: canPrice,
      game: computed(() => config.game),
      realm: computed(() => config.realm),
      fmtRate: (n: number) => Math.round(n).toLocaleString(config.uiLanguage === 'en' ? 'en-US' : 'zh-TW'),
      refresh () { void ninja.load(true) },
      switchIntl () { config.realm = 'intl' }
    }
  }
})
</script>

<style>
.dust-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface-0);
}
.dust-panel .grow { flex: 1; }
/* 標題列一行:標題 | 聯盟·匯率·時間(可縮、省略號) | ⟳ 選項▾ ✕ */
.dust-panel .dust-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 2px 6px 2px 10px;
  border-bottom: 1px solid var(--edge-0);
  background: var(--surface-1);
  font-size: var(--fs-xs);
  white-space: nowrap;
}
.dust-panel .dust-title { font-weight: 600; color: var(--ink-0); flex-shrink: 0; }
.dust-panel .dust-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 5px;
  overflow: hidden;
  color: var(--ink-1);
}
.dust-panel .dust-meta .v { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dust-panel .dust-meta [data-dust="league"] { flex: 0 1 auto; max-width: 11em; }
.dust-panel .dust-meta [data-dust="rate"] { flex: 0 0 auto; }
.dust-panel .dust-meta [data-dust="time"] { flex: 0 1 auto; color: var(--ink-2); }
.dust-panel .dust-meta .sep { color: var(--ink-3); flex-shrink: 0; }
.dust-panel .dust-head .btn { flex-shrink: 0; }
.dust-panel .dust-head .btn.on { background: var(--gold-soft); color: var(--ink-0); }
.dust-panel .dust-icon { width: 24px; padding: 0; justify-content: center; font-size: var(--fs-md); line-height: 1; }
.dust-panel .dust-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px 10px;
}
.dust-panel .dust-opts {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  padding: 8px 12px;
}
.dust-panel .dust-opt { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); }
.dust-panel .dust-opt .k { color: var(--ink-2); white-space: nowrap; }
.dust-panel .dust-opt.wide .select { min-width: 9em; }
.dust-panel .dust-n { width: 4.2em; padding: 0 6px; }
.dust-panel .dust-n.wide-n { width: 6.5em; }
.dust-panel .dust-checks { display: inline-flex; flex-wrap: wrap; gap: 4px 12px; }
.dust-panel .dust-listbar { flex-shrink: 0; display: flex; align-items: center; gap: 10px; }
.dust-panel .dust-search { flex: 1; min-width: 0; }
.dust-panel .dust-stats { font-size: var(--fs-2xs); white-space: nowrap; }
.dust-panel .dust-state { padding: 16px; color: var(--ink-2); font-size: var(--fs-sm); display: flex; gap: 10px; align-items: center; }
.dust-panel .dust-note { flex-basis: 100%; margin: 0; font-size: var(--fs-2xs); color: var(--ink-3); white-space: normal; }
</style>
