<template>
  <button
    v-if="show"
    type="button"
    data-action="fractured-toggle"
    :class="[$style.btn, { [$style.on]: on }]"
    :aria-pressed="on ? 'true' : 'false'"
    :title="
      t(
        on
          ? 'ppz.fractured_toggle.title_on'
          : 'ppz.fractured_toggle.title_off',
      )
    "
    @click="toggle"
  >
    <i class="fas fa-bolt" :class="$style.icon" aria-hidden="true" />
    <span>{{ t("ppz.fractured_toggle.label") }}</span>
  </button>
</template>

<script lang="ts">
// exile-appraiser: 自寫(非上游移植)。詞綴列下方的「破裂」切換鈕:破裂詞綴改送 fractured stat id。
// 邏輯在 fractured-toggle.ts;整份 stats 由 FiltersBlock provide(FRACTURED_FILTERS_KEY)。與 poe1 同名元件同外觀。
import { defineComponent, PropType, computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import type { ParsedItem } from "@/parser";
import type { StatFilter } from "./interfaces";
import {
  FRACTURED_FILTERS_KEY,
  applyFracturedToggle,
  canToggleFractured,
  isFracturedOn,
} from "./fractured-toggle";

export default defineComponent({
  props: {
    filter: {
      type: Object as PropType<StatFilter>,
      required: true,
    },
    item: {
      type: Object as PropType<ParsedItem>,
      required: true,
    },
  },
  setup(props) {
    const allFilters = inject<() => readonly StatFilter[]>(
      FRACTURED_FILTERS_KEY,
      () => [],
    );
    const show = computed(() => canToggleFractured(props.filter, props.item));
    const on = computed(() => isFracturedOn(props.filter));
    function toggle() {
      applyFracturedToggle(allFilters(), props.filter, !on.value);
    }
    const { t } = useI18n();
    return { t, show, on, toggle };
  },
});
</script>

<style lang="postcss" module>
.btn {
  @apply inline-flex items-center gap-x-1;
  @apply rounded-full border border-gray-600;
  @apply bg-gray-800 text-gray-400;
  @apply px-2;
  font-size: 0.8125rem;
  line-height: 1.15rem;

  &:hover {
    @apply border-gray-500 text-gray-300;
  }
}

.icon {
  font-size: 0.75em;
}

.on,
.on:hover {
  @apply border-gold bg-gold-soft text-gold font-bold;
}
</style>
