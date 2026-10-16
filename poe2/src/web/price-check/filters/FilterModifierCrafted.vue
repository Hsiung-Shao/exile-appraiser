<template>
  <mod-seg
    v-if="show"
    data-action="crafted-toggle"
    :aria-label="t('ppz.crafted_toggle.group')"
    :options="options"
    :model-value="mode"
    @update:model-value="choose"
  />
</template>

<script lang="ts">
// exile-appraiser: 自寫(非上游移植)。2026-10-16 工藝詞綴列下方的「一般 / 工藝」二選一:選工藝改送 crafted stat id。
// 邏輯在 crafted-toggle.ts;外觀照 FilterModifierFractured.vue;整份 stats 由 FiltersBlock provide(FRACTURED_FILTERS_KEY)。
import { defineComponent, PropType, computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import ModSeg from "@/web/price-panel/ModSeg.vue";
import type { ParsedItem } from "@/parser";
import type { StatFilter } from "./interfaces";
import { FRACTURED_FILTERS_KEY } from "./fractured-toggle";
import {
  canToggleCrafted,
  craftedMode,
  selectCraftedMode,
  type CraftedMode,
} from "./crafted-toggle";

export default defineComponent({
  components: { ModSeg },
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
    const show = computed(() => canToggleCrafted(props.filter));
    const mode = computed(() => craftedMode(props.filter));
    const { t } = useI18n();
    const options = computed(() => [
      {
        value: "normal",
        label: t("ppz.crafted_toggle.normal"),
        title: t("ppz.crafted_toggle.title_normal"),
      },
      {
        value: "crafted",
        label: t("ppz.crafted_toggle.label"),
        title: t("ppz.crafted_toggle.title_on"),
        strong: true,
      },
    ]);
    function choose(value: string) {
      selectCraftedMode(allFilters(), props.filter, value as CraftedMode);
    }
    return { t, show, mode, options, choose };
  },
});
</script>
