<template>
  <mod-seg
    v-if="show"
    data-action="fractured-toggle"
    :aria-label="t('ppz.fractured_toggle.group')"
    :options="options"
    :model-value="mode"
    @update:model-value="choose"
  />
</template>

<script lang="ts">
// exile-appraiser: 自寫(非上游移植)。破裂詞綴列下方的「一般 / 破裂」二選一:選破裂改送 fractured stat id。
// 2026-10-14 B 改版:呈現層已重寫(原本單一「破裂」切換鈕 → 二選一 ModSeg);邏輯仍在 fractured-toggle.ts;
// 整份 stats 由 FiltersBlock provide(FRACTURED_FILTERS_KEY)。與 poe1 同名元件同外觀。
import { defineComponent, PropType, computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import ModSeg from "@/web/price-panel/ModSeg.vue";
import type { ParsedItem } from "@/parser";
import type { StatFilter } from "./interfaces";
import {
  FRACTURED_FILTERS_KEY,
  canToggleFractured,
  fracturedMode,
  selectFracturedMode,
  type FracturedMode,
} from "./fractured-toggle";

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
    const show = computed(() => canToggleFractured(props.filter, props.item));
    const mode = computed(() => fracturedMode(props.filter));
    const { t } = useI18n();
    const options = computed(() => [
      {
        value: "normal",
        label: t("ppz.fractured_toggle.normal"),
        title: t("ppz.fractured_toggle.title_normal"),
      },
      {
        value: "fractured",
        label: t("ppz.fractured_toggle.label"),
        title: t("ppz.fractured_toggle.title_off"),
        strong: true,
      },
    ]);
    function choose(value: string) {
      selectFracturedMode(allFilters(), props.filter, value as FracturedMode);
    }
    return { t, show, mode, options, choose };
  },
});
</script>
