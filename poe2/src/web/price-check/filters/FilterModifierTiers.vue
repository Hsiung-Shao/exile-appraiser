<template>
  <div
    v-if="tags.length"
    class="flex items-center text-xs leading-none gap-x-1"
  >
    <span v-for="tag of tags" :class="$style[tag.type]">{{
      t("filters.tier", [tag.tier])
    }}</span>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, computed } from "vue";
import { useI18n } from "vue-i18n";
import { ItemCategory, ParsedItem } from "@/parser";
import { FilterTag, StatFilter } from "./interfaces";
import { AppConfig } from "@/web/Config";
import { PriceCheckWidget } from "@/web/overlay/widgets";

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
    const alwaysShowTier = computed(
      () => AppConfig<PriceCheckWidget>("price-check")!.alwaysShowTier,
    );
    const tags = computed(() => {
      const { filter, item } = props;
      if (
        item.category === ItemCategory.Map ||
        item.category === ItemCategory.Tablet
      ) {
        return [];
      }
      const out: Array<{ type: string; tier: number }> = [];
      for (const source of filter.sources) {
        const tier = source.modifier.info.tier;
        if (!tier) continue;

        if (
          (filter.tag === FilterTag.Explicit ||
            filter.tag === FilterTag.Desecrated ||
            filter.tag === FilterTag.Fractured ||
            filter.tag === FilterTag.Crafted ||
            filter.tag === FilterTag.Pseudo ||
            filter.tag === FilterTag.Property) &&
          item.category !== ItemCategory.Jewel &&
          item.category !== ItemCategory.ClusterJewel &&
          item.category !== ItemCategory.MemoryLine
        ) {
          if (tier === 1) out.push({ type: "tier-1", tier });
          else if (tier === 2) out.push({ type: "tier-2", tier });
          else if (alwaysShowTier.value)
            out.push({ type: "tier-3-plus", tier });
        } else if (tier >= 2) {
          // fractured, explicit-* filters
          out.push({ type: "not-tier-1", tier });
        }
      }
      out.sort((a, b) => a.tier - b.tier);
      return out;
    });

    const { t } = useI18n();
    return { t, tags };
  },
});
</script>

<style lang="postcss" module>
.tier-1,
.tier-2,
.not-tier-1,
.tier-3-plus {
  @apply rounded px-1;
}

.tier-1 {
  @apply bg-yellow-500 text-black;
}
.tier-2 {
  @apply border -my-px border-yellow-500 text-yellow-500;
}
/* exile-appraiser: T1 黃底黑字保留(固定底色);灰階別名底的標籤改 token 前景 / 邊(原本黑字黑邊在深色主題看不見) */
.tier-3-plus {
  @apply bg-surface-3 text-ink-1;
}
.not-tier-1 {
  @apply bg-surface-3 text-ink-1 border -my-px border-edge-2;
}
</style>
