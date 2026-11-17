<!--
  exile-appraiser:移植自 Awakened PoE Trade `renderer/src/web/map-check/SettingsMatcherEntry.vue`(MIT,© Alexander Drozdov)。
  耦合點:標記以 stat ref 為鍵(上游 matchStr);UiRadio 改用 `@/web/ui/…`(renderer);標籤字串改 `ppz.map_check.tag_*`
  (上游 `map.mods.*` 不在 app_i18n);列高用 em(設定視窗獨立字級);Tailwind 4 `@reference` 與 class 改名。
-->
<template>
  <div :class="$style['row']" >
    <div class="flex-1 flex items-center px-2 gap-x-1 whitespace-nowrap min-w-0">
      <span v-if="matcher.tag === StatTag.Outdated" :class="[$style['tag'], $style['tag-outdated']]">{{ t('ppz.map_check.tag_outdated') }}</span>
      <span v-if="matcher.tag === StatTag.HeistExclusive" :class="[$style['tag'], $style['tag-heist']]">{{ t('ppz.map_check.tag_heist') }}</span>
      <span v-if="matcher.tag === StatTag.UberMapExclusive" :class="[$style['tag'], $style['tag-uber']]">{{ t('ppz.map_check.tag_uber') }}</span>
      <span class="truncate">{{ matcher.matchStr }}</span>
    </div>
    <div class="flex items-baseline gap-x-4" :class="{ [$style['controls-auto-hide']]: !removable() }">
      <ui-radio v-model="decision" value="w" class="p-1" />
      <ui-radio v-model="decision" value="d" class="p-1" />
      <ui-radio v-model="decision" value="g" class="p-1" />
      <button v-if="removable()" @click="remove"
        class="flex items-center mx-1 py-1" :class="{ 'text-red-400': matcher.tag === StatTag.Outdated }">
        <i class="w-4" :class="(matcher.tag === StatTag.Outdated) ? 'fas fa-trash-alt' : 'fas fa-times'"></i>
      </button>
      <div v-else class="w-6" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import UiRadio from '@/web/ui/UiRadio.vue'
import { StatMatcher, StatTag, decisionHasColor, decisionCreate, MapCheckStat } from './common.js'

export default defineComponent({
  emits: [],
  components: { UiRadio },
  props: {
    matcher: {
      type: Object as PropType<StatMatcher>,
      required: true
    },
    selectedStats: {
      type: Array as PropType<MapCheckStat[]>,
      required: true
    },
    profile: {
      type: Number,
      required: true
    }
  },
  setup (props) {
    const { t } = useI18n()

    const entry = computed(() => props.selectedStats
      .find(({ ref }) => ref === props.matcher.ref))

    const decision = computed<string>({
      get () {
        if (!entry.value) return '-'
        return entry.value.decision[props.profile - 1]
      },
      set (value) {
        const newSet = decisionCreate(value, props.profile, entry.value?.decision)
        if (!entry.value) {
          props.selectedStats.push({
            ref: props.matcher.ref,
            decision: newSet
          })
        } else {
          entry.value.decision = newSet
        }
      }
    })

    function remove () {
      if (entry.value) {
        // exile-appraiser: 上游 decision.value = '---' 會寫進三格;只清目前設定檔這一格
        decision.value = '-'
      }
    }

    return {
      t,
      entry,
      decision,
      removable () {
        return decisionHasColor(entry.value?.decision ?? '---', props.profile)
      },
      remove,
      StatTag
    }
  }
})
</script>

<style lang="postcss" module>
@reference "../../../../../renderer/src/theme/tailwind.css"; /* exile-appraiser: Tailwind 4,讓 @apply / theme() 認得 utility */

.row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 2em; /* exile-appraiser: 上游 h-8(rem);設定視窗有獨立字級 */
  cursor: default;
  line-height: 1;
}

.row:hover {
  @apply bg-gray-700;
}

.row:not(:hover) .controls-auto-hide {
  display: none !important;
}

.tag {
  @apply px-1;
  @apply rounded-sm;
  line-height: 1;
}
.tag-heist {
  @apply bg-red-800;
}
.tag-uber {
  @apply bg-gray-900;
  outline: 1px solid theme('colors.gray.700');
}
.tag-outdated {
  @apply bg-red-400 text-black;
}
</style>
