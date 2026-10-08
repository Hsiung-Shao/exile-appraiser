<template>
  <div class="flex flex-row justify-between border-b border-gray-700 ppz-unknown-mod">
    <!-- exile-appraiser: ppz-unknown-mod = 就地回報列的左右間隔與淡黃底(樣式在 renderer ui/ReportInline.vue) -->
    <div class="py-2 flex flex-col">
      <div class="pb-1 flex items-baseline">
        <i class="w-5 shrink-0 fas fa-exclamation-triangle text-orange-400"></i>
        <div
          class="search-text mr-1 relative flex min-w-0"
          style="line-height: 1rem"
        >
          <span class="truncate"><ItemModifierText :text="stat.text" /></span>
          <span class="search-text-full whitespace-pre-wrap cursor-default"
            ><ItemModifierText :text="stat.text"
          /></span>
        </div>
      </div>
      <div class="ml-5 text-xs leading-none">
        <span class="text-gray-600">{{ t(stat.type) }} &mdash; </span>
        <span class="text-orange-400">{{ t("Not recognized modifier") }}</span>
      </div>
    </div>
    <!-- exile-appraiser: 就地回報(2026-10-08) -->
    <div class="py-2 pl-2 flex items-end shrink-0">
      <report-inline mode="mod" :detail="stat.text" />
    </div>
  </div>
</template>

<script lang="ts">
import { useI18n } from "vue-i18n";
import { ParsedItem } from "@/parser";
import ItemModifierText from "../../ui/ItemModifierText.vue";
import { defineComponent, PropType } from "vue";
// exile-appraiser: 就地回報(2026-10-08):未解析詞綴旁直接放「回報這條」(沒有宿主注入時不畫)
import ReportInline from "@/web/ui/ReportInline.vue";
// exile-appraiser: 移除「重新載入交易站資料」鈕(ReloadTradeData):本專案的交易站 data 是離線快照(data/poe2/trade),
// 重載不會多認得任何詞綴;它的「重試物品」又靠上游 Host.selfDispatch(本專案沒有)。

export default defineComponent({
  components: { ItemModifierText, ReportInline },
  props: {
    stat: {
      type: Object as PropType<ParsedItem["unknownModifiers"][number]>,
      required: true,
    },
    itemText: {
      type: String,
      required: true,
    },
  },
  setup() {
    const { t } = useI18n();

    return { t };
  },
});
</script>
