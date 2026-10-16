<template>
  <div :class="[$style.filter, { [$style.grouped]: grouped }]">
    <div v-if="showSourceInfo" :class="$style['mods']">
      <div class="pl-5 py-1" v-for="(source, idx) of filter.sources" :key="idx">
        <source-info :source="source" :filter="filter" />
      </div>
    </div>
    <div class="flex flex-col min-w-0 flex-1">
      <div class="flex items-center">
        <div class="flex items-center min-w-0 mr-2">
          <mod-switch :on="!isDisabled" :label="t('ppz.mod_cards.switch', [text])"
            :class="[$style.switch, { [$style.uncheckedHint]: isDisabled && groupExpanded }]"
            @click="toggleFilter" type="submit" />
          <button :class="[$style.labelBtn, { [$style.dim]: isDisabled }]" @click="smartToggle" type="submit">
            <img v-if="filter.mercenary?.icon"
              :src="filter.mercenary.icon">
            <span v-if="filter.not && miniFilter"
              :class="[$style.tag, $style['tag-not']]">{{ t('filters.tag_not') }}</span>
            <div class="search-text flex-1 relative flex min-w-0" style="line-height: 1rem;">
              <span class="truncate"><item-modifier-text :text="text" :roll="roll?.value" /></span>
              <span class="search-text-full whitespace-pre-wrap"><item-modifier-text :text="text" :roll="roll?.value" /></span>
            </div>
          </button>
          <button v-if="groupExpanded !== undefined"
            :class="$style.expandBtn" @click="toggleExpanded" type="button">
            <i :class="groupExpanded ? 'fas fa-chevron-down' : 'fas fa-chevron-right'" />
          </button>
        </div>
        <filter-modifier-tiers v-if="miniFilter && !showInputs"
          :filter="filter" :item="item"
          :class="{ 'mr-4': Boolean(rollOptions) }" />
        <slot name="inputs">
          <div v-if="showInputs"
            class="flex items-center gap-x-1 ml-auto">
            <div v-if="showQ20Notice" :class="$style['qualityLabel']">{{ t('item.prop_quality', [calcQuality]) }}</div>
            <mod-range>
              <template #min><input :class="$style['rollInput']" :placeholder="t('min')" :aria-label="t('min')" :min="roll?.bounds?.min" :max="roll?.bounds?.max" :step="changeStep" type="number"
                ref="inputMinEl"
                v-model.number="inputMin" @focus="inputFocus($event, 'min')" @mousewheel.stop></template>
              <template #max><input :class="$style['rollInput']" :placeholder="t('max')" :aria-label="t('max')" :min="roll?.bounds?.min" :max="roll?.bounds?.max" :step="changeStep" type="number"
                ref="inputMaxEl"
                v-model.number="inputMax" @focus="inputFocus($event, 'max')" @mousewheel.stop></template>
            </mod-range>
          </div>
          <filter-modifier-options v-else-if="miniFilter && rollOptions"
            :class="$style.miniRollOptions"
            show-checked="currentDisabled"
            :options="rollOptions"
            :filter="filter" />
        </slot>
      </div>
      <div class="flex pt-px" :class="{ [$style.dim]: isDisabled }" v-if="!miniFilter">
        <div :class="$style.lead" class="flex items-start">
          <ui-popover v-if="isHidden" tag-name="div" class="flex" placement="right-start" boundary="#price-window">
            <template #target>
              <span class="text-xs leading-none text-gray-600 cursor-pointer">
                <i class="fas fa-eye-slash" :class="{ 'faa-ring': !isDisabled }"></i>
              </span>
            </template>
            <template #content>
              <div style="max-width: 18.5rem;">{{ hiddenReason }}</div>
            </template>
          </ui-popover>
        </div>
        <div class="flex-1 min-w-0 flex items-start gap-x-2">
          <span v-if="filter.not"
            :class="[$style['tag'], $style['tag-not']]">{{ t('filters.tag_not') }}</span>
          <span v-if="showTag && tag === 'pseudo'" :class="$style.sub">{{ t('ppz.mod_cards.from_n', [filter.sources.length]) }}</span>
          <span v-else-if="showTag"
            :class="[$style['tag'], $style[`tag-${tag}`]]">{{ t(`filters.tag_${tag.replace('-', '_')}`) }}{{ (filter.sources.length > 1) ? ` x ${filter.sources.length}` : null }}</span>
          <filter-modifier-tiers :filter="filter" :item="item" />
          <filter-modifier-options v-if="rollOptions"
            show-checked="always"
            :options="rollOptions"
            :filter="filter" />
        </div>
        <stat-roll-slider v-if="roll && roll.bounds && showBounds()"
          class="ml-2 mr-4" style="width: 12.5rem;"
          v-model="sliderValue"
          :roll="roll.value"
          :dp="roll.dp"
          :bounds="roll.bounds"
        />
        <div :class="$style.rangeSpace" />
      </div>
      <!-- exile-appraiser: 2026-10-16 隨機詞綴的機制選擇「一般 / 破裂 / 工藝」(自寫 FilterModifierMechanism.vue;不適用時不輸出任何元素) -->
      <filter-modifier-mechanism v-if="!miniFilter" :class="$style.leadIndent" class="mt-1 self-start" :filter="filter" :item="item" />
      <!-- 破裂的 pseudo 退路列(已汙染 / 已鏡像、破裂詞綴被偽屬性吃掉)仍用「一般 / 破裂」二選一(自寫 FilterModifierFractured.vue;不適用時不輸出任何元素) -->
      <filter-modifier-fractured v-if="!miniFilter && filter.tag === 'pseudo'" :class="$style.leadIndent" class="mt-1 self-start" :filter="filter" :item="item" />
    </div>
    <modifier-anointment class="self-center" :filter="filter" />
  </div>
</template>

<script lang="ts">
// exile-appraiser: 2026-10-14 B 改版:本檔呈現層已重寫(勾選框 → 開關 ModSwitch、最小 / 最大 → 範圍膠囊 ModRange、
// 偽屬性列「來自 N 條詞綴」、未選用列變淡;行為 / 資料不動),記錄在 docs/poe2-port-notes.md「查價面板 B 改版」。
// exile-appraiser: ui/ 元件住在 renderer package,相對路徑 ../../ui 改成 @/web/ui alias
import { defineComponent, PropType, computed, ref, nextTick, useCssModule, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiPopover from '@/web/ui/Popover.vue'
import StatRollSlider from '@/web/ui/StatRollSlider.vue'
import ItemModifierText from '@/web/ui/ItemModifierText.vue'
import ModifierAnointment from './FilterModifierAnointment.vue'
import FilterModifierOptions, { RollOption } from './FilterModifierOptions.vue'
import FilterModifierTiers from './FilterModifierTiers.vue'
// exile-appraiser: 破裂切換鈕(自寫)
import FilterModifierFractured from './FilterModifierFractured.vue'
// exile-appraiser: 2026-10-16 機制選擇(自寫)
import FilterModifierMechanism from './FilterModifierMechanism.vue'
import ModSwitch from '@/web/price-panel/ModSwitch.vue'
import ModRange from '@/web/price-panel/ModRange.vue'
import { AppConfig } from '@/web/Config'
import { ItemCategory, ItemRarity, ParsedItem } from '@/parser'
import { FilterTag, StatFilter, INTERNAL_TRADE_IDS, ItemHasEmptyModifier } from './interfaces'
import SourceInfo from './SourceInfo.vue'
import { SearchMode as MercSearchMode } from './pseudo/mercenary.js'

export default defineComponent({
  // exile-appraiser: 多註冊 FilterModifierFractured / FilterModifierMechanism
  components: { ItemModifierText, ModifierAnointment, FilterModifierOptions, FilterModifierTiers, FilterModifierFractured, FilterModifierMechanism, SourceInfo, StatRollSlider, UiPopover, ModSwitch, ModRange },
  emits: ['update:groupExpanded'],
  props: {
    filter: {
      type: Object as PropType<StatFilter>,
      required: true
    },
    item: {
      type: Object as PropType<ParsedItem>,
      required: true
    },
    showSources: {
      type: Boolean
    },
    groupExpanded: {
      type: Boolean,
      default: undefined
    },
    grouped: {
      type: Boolean
    }
  },
  setup (props, ctx) {
    const $style = useCssModule()

    watch(() => props.filter.disabled && props.groupExpanded, (uncheckedHint) => {
      if (!uncheckedHint) return

      const animations = document.getAnimations().filter(animation =>
        animation instanceof CSSAnimation &&
        animation.animationName === $style.uncheckedHintAnim)
      const time = animations.find(animation =>
        animation.currentTime !== 0)?.currentTime ?? 0
      for (const animation of animations) {
        animation.currentTime = time
      }
    }, { flush: 'post' })

    const showTag = computed(() =>
      props.filter.tag !== FilterTag.Property &&
      props.filter.tag !== FilterTag.MercenarySupport &&
      props.filter.tradeId[0] !== 'item.has_empty_modifier' &&
      props.item.info.refName !== 'Chronicle of Atzoatl' &&
      props.item.info.refName !== 'Mirrored Tablet' &&
      props.item.info.refName !== 'Filled Coffin' &&
      props.item.category !== ItemCategory.Gem &&
      !(props.item.rarity === ItemRarity.Unique && props.filter.tag === FilterTag.Explicit && (props.filter.roll?.bounds || props.filter.hidden) && !props.grouped)
    )

    const showQ20Notice = computed(() => {
      return [
        'item.armour',
        'item.evasion_rating',
        'item.energy_shield',
        'item.ward',
        'item.total_dps',
        'item.physical_dps'
      ].includes(props.filter.tradeId[0])
    })

    const calcQuality = computed(() => Math.max(20, props.item.quality || 0))

    const inputMinEl = ref<HTMLInputElement | null>(null)
    const inputMaxEl = ref<HTMLInputElement | null>(null)

    const sliderValue = computed<Array<number | '' | undefined>>({
      get () {
        const roll = props.filter.roll!
        return [roll.min, roll.max]
      },
      set (value) {
        if (typeof value[0] === 'number') {
          props.filter.roll!.min = value[0]
          nextTick(() => {
            inputMinEl.value!.focus()
          })
        } else if (typeof value[1] === 'number') {
          props.filter.roll!.max = value[1]
          nextTick(() => {
            inputMaxEl.value!.focus()
          })
        }
        props.filter.disabled = false
      }
    })

    function inputFocus (e: FocusEvent, type: 'min' | 'max') {
      const target = e.target as HTMLInputElement
      if (target.value === '') {
        if (type === 'max') {
          props.filter.roll!.max = props.filter.roll!.default.max
        } else if (type === 'min') {
          props.filter.roll!.min = props.filter.roll!.default.min
        }
        nextTick(() => {
          target.select()
        })
      } else {
        target.select()
      }
      props.filter.disabled = false
    }

    function toggleFilter (e: MouseEvent) {
      if (e.detail === 0) return
      e.preventDefault()

      props.filter.disabled = !props.filter.disabled
    }

    function toggleExpanded () {
      ctx.emit('update:groupExpanded', !props.groupExpanded)
    }

    function smartToggle (e: MouseEvent) {
      if (e.detail === 0) return
      e.preventDefault()

      if (!props.filter.disabled && props.groupExpanded === true) {
        ctx.emit('update:groupExpanded', false)
      } else {
        props.filter.disabled = !props.filter.disabled

        if (!props.filter.disabled && props.groupExpanded === false) {
          ctx.emit('update:groupExpanded', true)
        }
      }
    }

    const { t } = useI18n()

    return {
      t,
      showTag,
      showQ20Notice,
      calcQuality,
      inputMinEl,
      inputMaxEl,
      sliderValue,
      inputMin: computed({
        get () { return props.filter.roll!.min },
        set (value: '' | number | undefined) { props.filter.roll!.min = value }
      }),
      inputMax: computed({
        get () { return props.filter.roll!.max },
        set (value: '' | number | undefined) { props.filter.roll!.max = value }
      }),
      tag: computed(() => props.filter.tag),
      miniFilter: computed(() => !props.filter.hidden && (
        props.filter.tag === FilterTag.MercenarySupport ||
        (props.filter.tag === FilterTag.Property && props.item.info.refName === 'Mercenary Warrant') ||
        props.item.info.refName === 'Chronicle of Atzoatl' ||
        props.item.info.refName === 'Mirrored Tablet' ||
        props.item.info.refName === 'Filled Coffin' ||
        props.item.category === ItemCategory.Gem
      )),
      // TODO: change
      changeStep: computed(() => props.filter.roll!.dp ? 0.01 : 1),
      showInputs: computed(() => props.filter.roll != null && !props.filter.oils),
      rollOptions: computed<RollOption[] | undefined>(() => {
        if (props.filter.tag === FilterTag.MercenarySupport && props.filter.option) {
          return [
            { text: t('filters.option_merc_required'), value: MercSearchMode.Required },
            { text: t('filters.option_merc_optional'), value: MercSearchMode.Optional }
          ]
        } else if (props.filter.tradeId[0] === 'item.has_empty_modifier') {
          return [
            { text: t('filters.option_empty_affix'), value: ItemHasEmptyModifier.Any },
            { text: t('filters.option_empty_prefix'), value: ItemHasEmptyModifier.Prefix },
            { text: t('filters.option_empty_suffix'), value: ItemHasEmptyModifier.Suffix }
          ]
        }
      }),
      fontSize: computed(() => AppConfig().fontSize),
      isDisabled: computed(() => props.filter.disabled),
      text: computed(() => {
        if (!INTERNAL_TRADE_IDS.includes(props.filter.tradeId[0])) {
          return props.filter.text
        } else {
          return t(props.filter.tradeId[0], ['#', '#'])
        }
      }),
      roll: computed(() => props.filter.roll),
      isHidden: computed(() => props.filter.hidden != null),
      hiddenReason: computed(() => t(props.filter.hidden!)),
      showSourceInfo: computed(() =>
        props.showSources &&
        props.filter.sources.length &&
        props.filter.option == null && (
          props.filter.tag === FilterTag.Pseudo ||
          (
            props.filter.sources.length >= 2 ||
            props.filter.sources[0].modifier.info.name != null ||
            props.filter.sources[0].modifier.info.tier != null ||
            props.filter.sources[0].modifier.info.rank != null
          )
        )),
      showBounds: () => props.item.rarity === ItemRarity.Unique,
      inputFocus,
      toggleFilter,
      toggleExpanded,
      smartToggle
    }
  }
})
</script>

<style lang="postcss" module>
.filter {
  padding: 0.4em 0;
  min-height: 2.9em;
  display: flex;
  align-items: center;
  position: relative;
}
.filter.grouped {
  padding-left: 2.9em;
}

/* B 改版:開關 + 間距 = 第二列 / 二選一的縮排寬度(.lead / .leadIndent) */
.switch {
  margin-right: 0.6em;

  &.uncheckedHint {
    animation: uncheckedHintAnim 0.5s ease-out infinite alternate;
  }
}
.lead {
  width: 2.9em;
  flex: none;
}
.leadIndent {
  margin-left: 2.9em;
}
.rangeSpace {
  width: 7em;
  flex: none;
}
.dim {
  opacity: 0.6;
}
.sub {
  font-size: 0.85em;
  color: var(--ink-2);
  line-height: 1.2;
}

@keyframes uncheckedHintAnim {
  from {
    background-color: var(--edge-1);
  }
  to {
    background-color: var(--ink-3);
  }
}

.labelBtn {
  display: flex;
  align-items: baseline;
  min-width: 0;
  text-align: left;

  & > img {
    width: theme('width.4');
    margin-right: theme('spacing.1');
    position: relative;
    top: 2px;
    margin-top: -99px; /* not allowed to extend baseline */
  }

  & > .tag {
    margin-right: theme('spacing.1');
  }
}

.expandBtn {
  display: flex;
  min-width: theme('width.5');
  padding-left: theme('spacing[1.5]');
  color: theme('colors.gray.500');
  margin-top: -99px; /* not allowed to extend baseline */
}

.rollInput {
  /* 外觀由 ModRange 的 :slotted(input) 決定 */
  &::placeholder {
    font-size: 0.85em;
  }

  &:focus {
    cursor: none;
  }
}

.qualityLabel {
  @apply text-gray-500;
  @apply border border-gray-700;
  @apply rounded;
  @apply px-2;
  text-align: center;
}

.miniRollOptions {
  margin: -99px 0; /* not allowed to extend baseline */
  margin-left: auto;
}

.mods {
  @apply border-b-4 border-gray-500;
  background: linear-gradient(to bottom, theme('colors.gray.800') , theme('colors.gray.900') );
  @apply -mx-4 px-4;
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  pointer-events: none;
  z-index: 10;
}

.filter:not(:hover) > .mods {
  display: none;
}

.tag {
  @apply px-1;
  @apply rounded;
  @apply text-xs;
  line-height: 1;
  overflow: hidden;
  text-overflow: clip;
}
.tag-variant {
  @apply bg-yellow-700 text-yellow-100; }
.tag-eldritch {
  background: linear-gradient(to right, theme('colors.red.700'), theme('colors.blue.700'));
}
.tag-explicit-shaper,
.tag-explicit-elder,
.tag-explicit-crusader,
.tag-explicit-hunter,
.tag-explicit-redeemer,
.tag-explicit-warlord,
.tag-explicit-delve,
.tag-explicit-veiled,
.tag-explicit-incursion,
.tag-explicit-infamous,
.tag-explicit-essence {
  display: flex;
  align-items: center;
  @apply -mx-1 pl-0.5 gap-x-0.5 text-gray-600;
  text-shadow: 0 0 4px theme('colors.gray.900');
  overflow: clip visible;
  min-width: 0;

  &::before {
    background-size: contain;
    @apply w-5 h-5 -my-5;
    content: '';
    flex-shrink: 0;
  }
}
.tag-explicit-shaper::before {
  background-image: url('/images/influence-Shaper.png'); }
.tag-explicit-elder::before {
  background-image: url('/images/influence-Elder.png'); }
.tag-explicit-crusader::before {
  background-image: url('/images/influence-Crusader.png'); }
.tag-explicit-hunter::before {
  background-image: url('/images/influence-Hunter.png'); }
.tag-explicit-redeemer::before {
  background-image: url('/images/influence-Redeemer.png'); }
.tag-explicit-warlord::before {
  background-image: url('/images/influence-Warlord.png'); }
.tag-explicit-delve::before {
  background-image: url('/images/delve.png'); }
.tag-explicit-veiled::before {
  background-image: url('/images/veiled.png'); }
.tag-explicit-incursion::before {
  background-image: url('/images/incursion.png'); }
.tag-explicit-infamous::before {
  background-image: url('/images/mercenary.png'); }
.tag-explicit-essence::before {
  background-image: url('/images/essence.png'); }

.tag-corrupted,
.tag-brick {
  @apply bg-red-700 text-red-100; }
/* exile-appraiser: 固定底色的標籤(裂痕/天譴/穢生/附魔)保留原本的黑/白字 —— 底色不隨主題變,字色也不該變;
   底色是灰階別名(gray-700 = --surface-2)的偽屬性/非標籤改成 token 前景,灰字標籤改 --ink-3(原 gray-600 = 邊框色,讀不清)。 */
.tag-fractured {
  @apply bg-yellow-400 text-black; }
.tag-crafted, .tag-synthesised {
  @apply bg-blue-600 text-blue-100; }
.tag-implicit,
.tag-explicit,
.tag-mercenary-primary,
.tag-mercenary-secondary,
.tag-mercenary-utility,
.tag-filter-group {
  @apply -mx-1 text-ink-3;
  text-shadow: 0 0 4px theme('colors.gray.900');
}
.tag-scourge {
  @apply bg-orange-600 text-white; }
.tag-foulborn {
  @apply bg-pink-700 text-white; }
.tag-vestigial {
  @apply bg-purple-600 text-purple-100; }
.tag-enchant {
  @apply bg-indigo-200 text-black; }
.tag-pseudo,
.tag-not {
  @apply bg-surface-3 text-ink-1; }
</style>

<style lang="postcss">
.search-text-full {
  position: absolute;
  left: 0px;
  right: 0px;
  top: -2px;
  padding-top: 2px;
  padding-bottom: 1px;
  z-index: 10;

  .search-text:not(:hover) & {
    display: none;
  }

  .search-text:hover & {
    @apply bg-gray-700;
  }
}
</style>
