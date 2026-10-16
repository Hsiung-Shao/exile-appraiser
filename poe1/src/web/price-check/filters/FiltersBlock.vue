<template>
  <div>
    <div class="flex flex-wrap items-center pb-3 gap-2">
      <filter-btn-logical v-if="searchSub"
        :filter="searchSub" :text="searchSub.name ?? searchSub.baseType!" />
      <filter-btn-numeric v-if="filters.linkedSockets"
        :filter="filters.linkedSockets" :name="t('item.linked_sockets')" />
      <filter-btn-numeric v-if="filters.mapTier"
        :filter="filters.mapTier" :name="t('item.map_tier')" />
      <filter-btn-logical v-if="filters.mapCompletionReward" readonly
        :filter="{ disabled: false }" :text="t('item.map_foil_reward', [filters.mapCompletionReward.name])" />
      <filter-btn-numeric v-if="filters.areaLevel"
        :filter="filters.areaLevel" :name="t('item.area_level')" />
      <filter-btn-logical v-if="filters.ultimatum && ultimatumText"
        :filter="filters.ultimatum" :text="ultimatumText" />
      <filter-btn-numeric v-if="filters.sentinelCharge"
        :filter="filters.sentinelCharge" :name="t('item.sentinel_charge')" />
      <filter-btn-numeric v-if="filters.itemLevel"
        :filter="filters.itemLevel" :name="t('item.item_level')" />
      <filter-btn-numeric v-if="filters.stackSize"
        :filter="filters.stackSize" :name="t('item.stock')" />
      <filter-btn-numeric v-if="filters.whiteSockets"
        :filter="filters.whiteSockets" :name="t('item.white_sockets')" />
      <filter-btn-numeric v-if="filters.gemLevel"
        :filter="filters.gemLevel" :name="t('item.gem_level')" />
      <filter-btn-numeric v-if="filters.quality"
        :filter="filters.quality" :name="t('item.quality')" />
      <template v-if="filters.influences">
        <filter-btn-logical v-for="influence of filters.influences" :key="influence.value"
          :filter="influence" :text="influence.value" :img="`/images/influence-${influence.value}.png`" />
      </template>
      <filter-btn-logical v-if="filters.rarity?.value === 'magic'"
        :filter="filters.rarity" text="Magic" />
      <filter-btn-logical v-if="filters.unidentified"
        :filter="filters.unidentified" :text="t('item.unidentified')" />
      <filter-btn-logical v-if="filters.veiled"
        :filter="filters.veiled" :text="t('item.veiled')" />
      <filter-btn-logical v-if="filters.foil"
        :filter="filters.foil" :text="t('item.foil_unique')" />
      <filter-btn-logical v-if="filters.mirrored && !filters.mirrored.hidden" active
        :filter="filters.mirrored" :text="t(filters.mirrored.disabled ? 'item.not_mirrored' : 'item.mirrored')" />
      <filter-btn-logical v-if="filters.split && !filters.split.hidden" active
        :filter="filters.split" :text="t(filters.split.disabled ? 'item.not_split' : 'item.split')" />
      <filter-btn-logical v-if="hasStats"
        :collapse="statsVisibility.disabled"
        :filter="statsVisibility"
        :active="totalSelectedMods > 0"
        :text="(totalSelectedMods > 0)
          ? t('filters.selected_some', [totalSelectedMods, stats.length])
          : t('filters.selected_none')"
      />
    </div>
    <div v-if="!statsVisibility.disabled && hasStats" class="mb-4 mt-1">
      <div v-if="presets.length > 1" :class="$style.presets" role="group">
        <button v-for="preset in presets" type="button"
          :class="[$style.presetBtn, { [$style.active]: preset.active }]"
          :aria-pressed="preset.active ? 'true' : 'false'"
          @click="selectPreset(preset.id)"
        >{{ t(preset.id) }}</button>
      </div>
      <form @submit.prevent="handleStatsSubmit">
        <report-inline v-if="showUnknownMods" mode="summary" :count="item.unknownModifiers.length" />
        <mod-card v-if="showModsCard" id="mods"
          :title="t('ppz.mod_cards.mods')"
          :count="t('ppz.mod_cards.count', [cards.mods.selected, cards.mods.rows.length])">
          <template v-for="filter of cards.mods.rows">
            <filter-group v-if="filter.group" :key="`group_${filter.meta.tag}_${filter.meta.text}`"
              :group="filter"
              :item="item" />
            <filter-modifier v-else :key="`${filter.tag}_${filter.text}`"
              :filter="filter"
              :item="item"
              :show-sources="showFilterSources" />
          </template>
          <div v-if="!filteredStats.length && !showUnknownMods"
            class="py-2 text-ink-2">{{ t('filters.empty') }}</div>
          <template v-if="showUnknownMods">
            <unknown-modifier v-for="stat of item.unknownModifiers" :key="stat.type + '/' + stat.text"
              :stat="stat" />
          </template>
        </mod-card>
        <mod-card v-if="cards.pseudo.rows.length" id="pseudo"
          :title="t('ppz.mod_cards.pseudo')"
          :count="t('ppz.mod_cards.count', [cards.pseudo.selected, cards.pseudo.rows.length])">
          <template v-for="filter of cards.pseudo.rows">
            <filter-group v-if="filter.group" :key="`group_${filter.meta.tag}_${filter.meta.text}`"
              :group="filter"
              :item="item" />
            <filter-modifier v-else :key="`${filter.tag}_${filter.text}`"
              :filter="filter"
              :item="item"
              :show-sources="showFilterSources" />
          </template>
        </mod-card>
        <input type="submit" class="hidden" />
      </form>
      <div class="flex items-center gap-x-4 mt-2">
        <button type="button" @click="statsVisibility.disabled = !statsVisibility.disabled" :class="$style.footBtn"
          >{{ t('filters.collapse') }} <i class="fas fa-chevron-up pl-1 text-xs"></i></button>
        <ui-toggle v-if="filteredStats.length !== stats.length"
          v-model="showHidden" class="text-gray-400">{{ t('filters.hidden_toggle') }}</ui-toggle>
        <ui-toggle
          v-model="showFilterSources" class="ml-auto text-gray-400">{{ t('filters.mods_toggle') }}</ui-toggle>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// exile-appraiser: 2026-10-14 B 改版:本檔呈現層已重寫(可見詞綴依來源分「詞綴」/「偽屬性(總和)」兩張卡片 ModCard、
// 預設組合改分段鈕、收合列改膠囊;隱藏 / 收合 / 詞綴來源切換、篩選資料不動),記錄在 docs/poe2-port-notes.md「查價面板 B 改版」。
// exile-appraiser: 多 import provide(破裂切換鈕要整份 stats)
import { defineComponent, watch, shallowRef, shallowReactive, computed, PropType, provide } from 'vue'
import { useI18n } from 'vue-i18n'
import UiToggle from '@/web/ui/UiToggle.vue'
import FilterModifier from './FilterModifier.vue'
import FilterGroup from './FilterGroup.vue'
import FilterBtnNumeric from './FilterBtnNumeric.vue'
import FilterBtnLogical from './FilterBtnLogical.vue'
import UnknownModifier from './UnknownModifier.vue'
// exile-appraiser: 就地回報(2026-10-08):有未解析詞綴時在清單最上方顯示條數 +「回報問題」(沒有宿主注入時不畫)
import ReportInline from '@/web/ui/ReportInline.vue'
import ModCard from '@/web/price-panel/ModCard.vue'
import { splitModCards } from '@/web/price-panel/mod-cards'
import { ItemFilters, FilterOrGroup } from './interfaces'
import { FRACTURED_FILTERS_KEY } from './fractured-toggle'
import { ParsedItem, ItemRarity, ItemCategory } from '@/parser'

export default defineComponent({
  name: 'FiltersBlock',
  emits: ['submit', 'preset'],
  components: {
    FilterModifier,
    FilterGroup,
    FilterBtnNumeric,
    FilterBtnLogical,
    UnknownModifier,
    ReportInline,
    ModCard,
    UiToggle
  },
  props: {
    presets: {
      type: Array as PropType<Array<{ id: string, active: boolean }>>,
      required: true
    },
    filters: {
      type: Object as PropType<ItemFilters>,
      required: true
    },
    stats: {
      type: Array as PropType<FilterOrGroup[]>,
      required: true
    },
    item: {
      type: Object as PropType<ParsedItem>,
      required: true
    }
  },
  setup (props, ctx) {
    // exile-appraiser: 破裂切換鈕(FilterModifierFractured.vue)打開時取消勾選同 id 的隱藏孿生
    provide(FRACTURED_FILTERS_KEY, () => props.stats)
    const statsVisibility = shallowReactive({ disabled: false })
    const showHidden = shallowRef(false)
    const showFilterSources = shallowRef(false)

    watch(() => props.item, () => {
      showHidden.value = false
      statsVisibility.disabled = false
    })

    const showUnknownMods = computed(() =>
      props.item.unknownModifiers.length &&
      props.item.category !== ItemCategory.Sentinel &&
      props.item.category !== ItemCategory.Map
    )

    const { t } = useI18n()

    const filteredStats = computed(() => {
      const show = showHidden.value
      return props.stats.filter(s => {
        if (s.group) {
          return Boolean(s.meta.hidden) === show
        }
        return Boolean(s.hidden) === show
      })
    })
    const cards = computed(() => splitModCards(filteredStats.value))

    return {
      t,
      statsVisibility,
      showHidden,
      showFilterSources,
      totalSelectedMods: computed(() => {
        return props.stats.filter(stat => {
          if (stat.group) {
            return !stat.meta.disabled
          }
          return !stat.disabled
        }).length
      }),
      filteredStats,
      cards,
      // 詞綴卡:有列、或要放未解析詞綴 / 空清單提示時才畫
      showModsCard: computed(() =>
        cards.value.mods.rows.length > 0 || Boolean(showUnknownMods.value) || !cards.value.pseudo.rows.length),
      searchSub: computed(() => {
        const { filters } = props
        const activeSearch = (filters.searchRelaxed && !filters.searchRelaxed.disabled)
          ? filters.searchRelaxed
          : filters.searchExact
        return activeSearch.sub
      }),
      showUnknownMods,
      // 最後通牒雕刻:一顆按鈕代表整組條件(挑戰/獎勵/需求獻祭),關掉就三個都不送。
      // 用交易站自己的措辭,因為使用者接著就是去看交易站的結果 —— 那與物品上的
      // 文字不同(物品寫「存活」、交易站寫「倖存」),兩者靠 ident 對接。
      ultimatumText: computed(() => {
        const ultimatum = props.filters.ultimatum
        if (!ultimatum) return ''
        const parts: string[] = []
        if (ultimatum.challenge) parts.push(t(`ultimatum.${ultimatum.challenge}`))
        if (ultimatum.reward) parts.push(t(`ultimatum.${ultimatum.reward}`))
        if (ultimatum.sacrifice) parts.push(ultimatum.sacrifice)
        return parts.join(' · ')
      }),
      hasStats: computed(() =>
        props.stats.length ||
        (showUnknownMods.value && props.item.rarity === ItemRarity.Unique) ||
        props.presets.length > 1),
      handleStatsSubmit () {
        ctx.emit('submit')
      },
      selectPreset (id: string) {
        ctx.emit('preset', id)
      }
    }
  }
})
</script>

<style lang="postcss" module>
.presets {
  display: inline-flex;
  margin-bottom: 0.5em;
  border: 1px solid var(--edge-1);
  border-radius: 0.8em;
  overflow: hidden;
}

.presetBtn {
  min-width: 3rem;
  padding: 0.15em 0.8em;
  color: var(--ink-2);

  &:hover {
    color: var(--ink-1);
  }

  &.active {
    background: var(--surface-3);
    color: var(--ink-0);
    font-weight: 700;
  }
}

.footBtn {
  padding: 0.2em 0.9em;
  border: 1px solid var(--edge-1);
  border-radius: 999px;
  background: var(--surface-1);
  color: var(--ink-2);
  line-height: 1.4;

  &:hover {
    color: var(--ink-1);
    border-color: var(--edge-2);
  }
}
</style>
