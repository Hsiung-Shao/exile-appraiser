<template>
  <div
    v-if="tags.length"
    class="flex items-center text-xs leading-none gap-x-1"
  >
    <span
      v-for="tag of tags"
      :class="[$style[tag.type], tag.inferred && $style['inferred']]"
      :title="tag.title"
      :data-tier-inferred="tag.inferred ? '' : undefined"
      >{{ tag.label
      }}<small v-if="tag.inferred" :class="$style['inferred-mark']">{{
        t("ppz.desecration.inferred")
      }}</small></span
    >
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, computed } from "vue";
import { useI18n } from "vue-i18n";
import { ItemCategory, ParsedItem } from "@/parser";
import { FilterTag, StatFilter } from "./interfaces";
import { AppConfig } from "@/web/Config";
import { PriceCheckWidget } from "@/web/overlay/widgets";
// exile-appraiser(WP-R):一般複製的褻瀆詞綴推定 Tier(info.tierInferred / tierCandidates)加「推定」小字與 tooltip
import {
  inferredTierLabel,
  inferredTierTitle,
  type Translate,
} from "@/desecration/display";

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
      const out: Array<{
        type: string;
        tier: number;
        label?: string;
        inferred?: boolean;
        title?: string;
      }> = [];
      for (const source of filter.sources) {
        const info = source.modifier.info;
        // exile-appraiser(WP-R):推定 Tier 一律顯示(不受 alwaysShowTier 限制 —— 一般複製唯一的 Tier 來源),
        // 多個候選顯示 `T2/T3`
        if (info.tierInferred) {
          const first = info.tierCandidates?.[0] ?? info.tier;
          if (!first) continue;
          out.push({
            type: first === 1 ? "tier-1" : first === 2 ? "tier-2" : "tier-3-plus",
            tier: first,
            label: inferredTierLabel(info, t as Translate),
            inferred: true,
            title: inferredTierTitle(info, t as Translate),
          });
          continue;
        }
        const tier = info.tier;
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
      return out.map((tag) => ({
        ...tag,
        label: tag.label ?? t("filters.tier", [tag.tier]),
      }));
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
/* exile-appraiser(WP-R):推定 Tier —— 虛線外框 + 「推定」小字,與遊戲給的 Tier 區分 */
.inferred {
  @apply border border-dashed -my-px;
  cursor: help;
}
.inferred-mark {
  @apply ml-0.5;
  font-size: 0.75em;
  opacity: 0.85;
}
</style>
