<template>
  <mod-seg v-if="options.length"
    data-action="mechanism"
    :aria-label="t('ppz.mechanism.group')"
    :options="options"
    :model-value="mode"
    @update:model-value="choose" />
</template>

<script lang="ts">
// exile-appraiser: 自寫(非上游移植)。2026-10-16 隨機詞綴列下方的機制選擇「一般 / 破裂 / 工藝」
// (依該 stat 在交易站有的分類;只有一般時不輸出)。邏輯在 mechanism-toggle.ts;
// 整份 stats 由 FiltersBlock provide(FRACTURED_FILTERS_KEY)。與 poe2 同名元件同外觀。
import { defineComponent, PropType, computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import ModSeg from '@/web/price-panel/ModSeg.vue'
// 2026-10-16:「機制」開關(關著時只有模式被改過、不是原本機制的列顯示)
import { useShowMechanism } from '@/web/price-panel/useShowMechanism'
import type { ParsedItem } from '@/parser'
import type { FilterOrGroup, StatFilter } from './interfaces'
import { FRACTURED_FILTERS_KEY } from './fractured-toggle'
import { mechanismDefault, mechanismMode, mechanismOptions, selectMechanism, type MechanismMode } from './mechanism-toggle'

export default defineComponent({
  components: { ModSeg },
  props: {
    filter: {
      type: Object as PropType<StatFilter>,
      required: true
    },
    item: {
      type: Object as PropType<ParsedItem>,
      default: undefined
    }
  },
  setup (props) {
    const allFilters = inject<() => readonly FilterOrGroup[]>(FRACTURED_FILTERS_KEY, () => [])
    const { t } = useI18n()
    const mode = computed(() => mechanismMode(props.filter))
    const { show } = useShowMechanism()
    const options = computed(() => (props.filter.hidden != null || (!show.value && mode.value === mechanismDefault(props.filter)))
      ? []
      : mechanismOptions(props.filter, props.item).map(value => ({
        value,
        label: t(`ppz.mechanism.${value}`),
        title: (value === 'normal' || value === 'any') ? t(`ppz.mechanism.title_${value}`) : undefined,
        strong: value !== 'normal' && value !== 'any'
      })))
    function choose (value: string) {
      const stats = allFilters().filter((f): f is StatFilter => !f.group)
      selectMechanism(stats, props.filter, value as MechanismMode)
    }
    return { t, mode, options, choose }
  }
})
</script>
