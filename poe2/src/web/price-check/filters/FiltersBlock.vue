<template>
  <div>
    <div class="flex justify-between">
      <div class="flex flex-wrap items-center pb-3 gap-2">
        <filter-btn-numeric
          v-if="filters.socketNumber"
          :filter="filters.socketNumber"
          :name="t('item.gem_sockets')"
        />
        <filter-btn-numeric
          v-if="filters.linkedSockets"
          :filter="filters.linkedSockets"
          :name="t('item.linked_sockets')"
        />
        <filter-btn-numeric
          v-if="filters.mapTier"
          :filter="filters.mapTier"
          :name="t('item.map_tier')"
        />
        <filter-btn-numeric
          v-if="filters.awardedAscendancyPoints"
          :filter="filters.awardedAscendancyPoints"
          :name="t('item.ascendancy_points')"
        />
        <filter-btn-numeric
          v-if="filters.areaLevel"
          :filter="filters.areaLevel"
          :name="t('item.area_level')"
        />
        <filter-btn-numeric
          v-if="filters.heistWingsRevealed"
          :filter="filters.heistWingsRevealed"
          :name="t('item.heist_wings_revealed')"
        />
        <filter-btn-numeric
          v-if="filters.sentinelCharge"
          :filter="filters.sentinelCharge"
          :name="t('item.sentinel_charge')"
        />
        <filter-btn-logical
          v-if="filters.mapBlighted"
          readonly
          :filter="{ disabled: false }"
          :text="filters.mapBlighted.value"
        />
        <filter-btn-logical
          v-if="filters.rarity?.value === 'magic'"
          readonly
          :filter="{ disabled: false }"
          text="Magic"
        />
        <filter-btn-logical
          v-if="filters.rarity?.value === 'normal'"
          readonly
          :filter="{ disabled: false }"
          text="Normal"
        />
        <filter-btn-logical
          v-if="filters.discriminator?.value"
          readonly
          :filter="{ disabled: false }"
          :text="filters.discriminator.value"
        />
        <filter-btn-numeric
          v-if="filters.itemLevel"
          :filter="filters.itemLevel"
          :name="t('item.item_level')"
        />
        <filter-btn-numeric
          v-if="filters.requires?.level"
          :filter="filters.requires?.level"
          :name="t('item.requires_level')"
        />
        <filter-btn-numeric
          v-if="filters.stackSize"
          :filter="filters.stackSize"
          :name="t('item.stock')"
        />
        <filter-btn-numeric
          v-if="filters.whiteSockets"
          :filter="filters.whiteSockets"
          :name="t('item.white_sockets')"
        />
        <filter-btn-numeric
          v-if="filters.augmentSockets"
          :filter="filters.augmentSockets"
          :name="t('item.augment_sockets')"
        />
        <filter-btn-numeric
          v-if="filters.gemLevel"
          :filter="filters.gemLevel"
          :name="t('item.gem_level')"
        />
        <filter-btn-numeric
          v-if="filters.quality"
          :filter="filters.quality"
          :name="t('item.quality')"
        />
        <template v-if="filters.influences">
          <filter-btn-logical
            v-for="influence of filters.influences"
            :key="influence.value"
            :filter="influence"
            :text="influence.value"
            :img="`/images/influence-${influence.value}.png`"
          />
        </template>
        <!-- Implicitly should only be tier or plain unid from create-item-filters -->
        <filter-btn-numeric
          v-if="filters.unidentifiedTier"
          :filter="filters.unidentifiedTier"
          :name="t('item.unidentified_tier')"
        />
        <filter-btn-logical
          v-else-if="filters.unidentified"
          :filter="filters.unidentified"
          :text="t('item.unidentified')"
        />
        <filter-btn-logical
          v-if="filters.veiled"
          :filter="filters.veiled"
          :text="t('item.veiled')"
        />
        <filter-btn-logical
          v-if="filters.foil"
          :filter="filters.foil"
          :text="t('item.foil_unique')"
        />
        <filter-btn-logical
          v-if="filters.mirrored"
          active
          :filter="filters.mirrored"
          :text="
            t(filters.mirrored.disabled ? 'item.not_mirrored' : 'item.mirrored')
          "
        />
        <filter-btn-logical
          v-if="filters.sanctified"
          active
          :filter="filters.sanctified"
          :text="
            t(
              filters.sanctified.disabled
                ? 'item.not_sanctified'
                : 'item.sanctified',
            )
          "
        />
        <filter-btn-logical
          v-if="filters.ultimatumHint"
          :filter="filters.ultimatumHint"
          :text="t(`item.${filters.ultimatumHint.value.toLowerCase()}`)"
        />

        <filter-btn-logical
          v-if="hasStats"
          :collapse="statsVisibility.disabled"
          :filter="statsVisibility"
          :active="totalSelectedMods > 0"
          :text="
            totalSelectedMods > 0
              ? t('filters.selected_some', [totalSelectedMods, stats.length])
              : t('filters.selected_none')
          "
        />
      </div>
      <div
        v-if="showItemEditor !== 'none'"
        class="flex items-center bg-gray-900 rounded-sm border border-gray-500 justify-center shrink-0 w-8 h-8"
      >
        <popover :delay="[0, 500]" placement="right">
          <template #target>
            <i
              v-if="canHaveCatalyst && !currentCatalyst"
              class="fas fa-question-circle text-gray-400 text-xl" />
            <img
              v-else-if="currentCatalyst"
              :src="currentCatalyst.icon"
              class="max-w-full max-h-full overflow-hidden" /><img
              v-else
              :src="
                item.augmentSockets?.augments.some((a) => a)
                  ? '/images/augments/rune.png'
                  : '/images/augments/empty-socket.png'
              "
              class="max-w-full max-h-full overflow-hidden"
          /></template>
          <template #content>
            <item-editor-v2 :item="item" />
          </template>
        </popover>
      </div>
    </div>
    <!-- Handled parse error -->
    <div v-if="!statsVisibility.disabled && hasStats" class="mb-4 mt-1">
      <div v-if="presets.length > 1" :class="$style.presets" role="group">
        <button
          v-for="preset in presets"
          type="button"
          :class="[$style.presetBtn, { [$style.active]: preset.active }]"
          :aria-pressed="preset.active ? 'true' : 'false'"
          @click="selectPreset(preset.id)"
        >
          {{ t(preset.id) }}
        </button>
      </div>
      <form @submit.prevent="handleStatsSubmit">
        <report-inline
          v-if="showUnknownMods"
          mode="summary"
          :count="item.unknownModifiers.length"
        />
        <mod-card
          v-if="showModsCard"
          id="mods"
          :title="t('ppz.mod_cards.mods')"
          :count="
            t('ppz.mod_cards.count', [
              cards.mods.selected,
              cards.mods.rows.length,
            ])
          "
        >
          <filter-modifier
            v-for="filter of cards.mods.rows"
            :key="filter.tag + '/' + filter.text"
            :filter="filter"
            :item="item"
            :show-sources="showFilterSources"
            @submit="handleStatsSubmit"
          />
          <div
            v-if="!filteredStats.length && !showUnknownMods"
            class="py-2 text-ink-2"
          >
            {{ t("filters.empty") }}
          </div>
          <template v-if="showUnknownMods">
            <unknown-modifier
              v-for="stat of item.unknownModifiers"
              :key="stat.type + '/' + stat.text"
              :stat="stat"
              :item-text="item.rawText"
            />
          </template>
          <template v-if="showMissingFracturedWarning">
            <div class="py-2 flex flex-col">
              <div class="pb-1 flex items-baseline">
                <i
                  class="w-5 shrink-0 fas fa-exclamation-triangle text-orange-400"
                ></i>
                <div
                  class="search-text mr-1 relative flex min-w-0"
                  style="line-height: 1rem"
                >
                  {{ t("Unable to determine fractured stat") }}
                </div>
              </div>
              <div class="ml-5 text-xs leading-none">
                <span class="text-gray-600"
                  >{{ t("filters.tag_explicit") }} &mdash;
                </span>
                <a
                  target="_blank"
                  href="https://www.pathofexile.com/forum/view-thread/3891367"
                  class="text-orange-400 underline hidden"
                  >Bug Report</a
                >
              </div>
            </div>
          </template>
        </mod-card>
        <!-- exile-appraiser: 2026-10-16 原始詞綴卡(被合計吃掉 / 本來藏起、現在列出的詞綴):可折疊、預設收起、換物品回收起 -->
        <mod-card
          v-if="cards.raw.rows.length"
          id="raw"
          :title="t('ppz.mod_cards.raw')"
          :count="
            t('ppz.mod_cards.count', [cards.raw.selected, cards.raw.rows.length])
          "
          collapsible
          v-model:collapsed="rawCollapsed"
        >
          <filter-modifier
            v-for="filter of cards.raw.rows"
            :key="filter.tag + '/' + filter.text"
            :filter="filter"
            :item="item"
            :show-sources="showFilterSources"
            @submit="handleStatsSubmit"
          />
        </mod-card>
        <mod-card
          v-if="cards.pseudo.rows.length"
          id="pseudo"
          :title="t('ppz.mod_cards.pseudo')"
          :count="
            t('ppz.mod_cards.count', [
              cards.pseudo.selected,
              cards.pseudo.rows.length,
            ])
          "
        >
          <filter-modifier
            v-for="filter of cards.pseudo.rows"
            :key="filter.tag + '/' + filter.text"
            :filter="filter"
            :item="item"
            :show-sources="showFilterSources"
            @submit="handleStatsSubmit"
          />
        </mod-card>
        <input type="submit" class="hidden" />
      </form>
      <div class="flex items-center gap-x-4 mt-2">
        <button
          type="button"
          @click="statsVisibility.disabled = !statsVisibility.disabled"
          :class="$style.footBtn"
        >
          {{ t("filters.collapse") }}
          <i class="fas fa-chevron-up pl-1 text-xs"></i>
        </button>
        <ui-toggle
          v-if="filteredStats.length !== stats.length"
          v-model="showHidden"
          class="text-gray-400"
          >{{ t(hiddenLabel) }}</ui-toggle
        >
        <!-- exile-appraiser: 2026-10-16「機制」開關(設定 showMechanism;關著時只有非一般模式的列顯示機制按鈕) -->
        <ui-toggle
          data-action="mechanism-visible"
          :model-value="showMechanism"
          @update:model-value="setShowMechanism"
          class="ml-auto text-gray-400"
          >{{ t("ppz.mechanism.toggle") }}</ui-toggle
        >
        <ui-toggle v-model="showFilterSources" class="text-gray-400">{{
          t("filters.mods_toggle")
        }}</ui-toggle>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// exile-appraiser: 2026-10-14 B 改版:本檔呈現層已重寫(可見詞綴依來源分「詞綴」/「偽屬性(總和)」兩張卡片 ModCard、
// 預設組合改分段鈕、收合列改膠囊;隱藏 / 收合 / 詞綴來源切換、篩選資料不動),記錄在 docs/poe2-port-notes.md「查價面板 B 改版」。
import {
  defineComponent,
  watch,
  shallowRef,
  shallowReactive,
  computed,
  PropType,
  provide, // exile-appraiser: 破裂切換鈕要整份 stats
} from "vue";
import { useI18n } from "vue-i18n";
import UiToggle from "@/web/ui/UiToggle.vue";
import ItemEditorV2 from "@/web/price-check/item-editor/ItemEditorV2.vue";
import FilterModifier from "./FilterModifier.vue";
import FilterBtnNumeric from "./FilterBtnNumeric.vue";
import FilterBtnLogical from "./FilterBtnLogical.vue";
import UnknownModifier from "./UnknownModifier.vue";
// exile-appraiser: 就地回報(2026-10-08):有未解析詞綴時在清單最上方顯示條數 +「回報問題」(沒有宿主注入時不畫)
import ReportInline from "@/web/ui/ReportInline.vue";
import ModCard from "@/web/price-panel/ModCard.vue";
import { splitModCards } from "@/web/price-panel/mod-cards";
// exile-appraiser: 2026-10-16「機制」開關
import { useShowMechanism } from "@/web/price-panel/useShowMechanism";
import { ItemFilters, StatFilter } from "./interfaces";
// exile-appraiser: 破裂切換鈕要整份 stats
import { FRACTURED_FILTERS_KEY } from "./fractured-toggle";
import {
  ParsedItem,
  ItemRarity,
  ItemCategory,
  itemIsModifiable,
} from "@/parser";
import FilterBtnDropdown from "./FilterBtnDropdown.vue";
import { ModifierType } from "@/parser/modifiers";
import Popover from "@/web/ui/Popover.vue";
import { getItemEditorType } from "../item-editor/item-editor.js";
import { ItemEditorType } from "@/parser/meta.js";
import { CATALYST_TYPES } from "@/assets/data/index.js";

export default defineComponent({
  name: "FiltersBlock",
  emits: ["submit", "preset"],
  components: {
    FilterModifier,
    FilterBtnNumeric,
    FilterBtnLogical,
    FilterBtnDropdown,
    ItemEditorV2,
    UnknownModifier,
    ReportInline,
    ModCard,
    Popover,
    UiToggle,
  },
  props: {
    presets: {
      type: Array as PropType<Array<{ id: string; active: boolean }>>,
      required: true,
    },
    filters: {
      type: Object as PropType<ItemFilters>,
      required: true,
    },
    stats: {
      type: Array as PropType<StatFilter[]>,
      required: true,
    },
    item: {
      type: Object as PropType<ParsedItem>,
      required: true,
    },
  },
  setup(props, ctx) {
    // exile-appraiser: 破裂切換鈕(FilterModifierFractured.vue)打開時取消勾選同 id 的隱藏孿生
    provide(FRACTURED_FILTERS_KEY, () => props.stats);
    const statsVisibility = shallowReactive({ disabled: false });
    const showHidden = shallowRef(false);
    const showFilterSources = shallowRef(false);
    // exile-appraiser: 2026-10-16 原始詞綴卡預設收起、換物品回收起;機制開關讀寫設定
    const rawCollapsed = shallowRef(true);
    const { show: showMechanism, setShow: setShowMechanism } =
      useShowMechanism();

    watch(
      () => props.item,
      () => {
        showHidden.value = false;
        statsVisibility.disabled = false;
        rawCollapsed.value = true;
      },
    );

    const showUnknownMods = computed(
      () =>
        props.item.unknownModifiers.length &&
        props.item.category !== ItemCategory.Sentinel &&
        !(
          props.item.category === ItemCategory.Map &&
          props.item.rarity === ItemRarity.Unique
        ),
    );

    const showItemEditor = computed(() => {
      if (!itemIsModifiable(props.item)) {
        // can still change socketed items on non-modifiable items
        return (props.item.augmentSockets?.augments.length ?? 0) > 0
          ? getItemEditorType(props.item)
          : ItemEditorType.None;
      }

      return getItemEditorType(props.item);
    });
    // For handling filling augments
    // watch(
    //   () => props.filters.itemEditorSelection?.value,
    //   (selected, prev) => {
    //     const normalCase = selected !== prev && props.filters.tempAugmentStorage;
    //     if (normalCase && selected !== undefined) {
    //       // If last wasn't empty
    //       if (
    //         prev !== "None" &&
    //         props.filters.tempAugmentStorage &&
    //         props.filters.tempAugmentStorage.length > 0
    //       ) {
    //         // Remove current augment
    //         handleRemoveItemEdits(
    //           props.stats,
    //           props.item,
    //           props.filters.tempAugmentStorage!,
    //         );
    //       }
    //       // If we didn't choose empty
    //       if (selected !== "None") {
    //         // add new augment
    //         handleApplyItemEdits(
    //           props.stats,
    //           props.item,
    //           props.filters.tempAugmentStorage!,
    //           selected,
    //         );
    //       }
    //     }
    //   },
    // );

    const { t } = useI18n();

    const filteredStats = computed(() => {
      if (showHidden.value) {
        return props.stats.filter((s) => s.hidden);
      } else {
        return props.stats.filter((s) => !s.hidden);
      }
    });
    const cards = computed(() => splitModCards(filteredStats.value));
    const showMissingFracturedWarning = computed(() => {
      return (
        // is fractured
        props.item.isFractured &&
        // on base item preset
        props.presets.some(
          (p) => p.id === "filters.preset_base_item" && p.active,
        ) &&
        // but item itself has no fractured mods
        !props.item.statsByType.some(
          (calc) => calc.type === ModifierType.Fractured,
        )
      );
    });

    return {
      t,
      statsVisibility,
      showHidden,
      showFilterSources,
      rawCollapsed,
      showMechanism,
      setShowMechanism,
      totalSelectedMods: computed(() => {
        return props.stats.filter((stat) => !stat.disabled).length;
      }),
      filteredStats,
      cards,
      // 詞綴卡:有列、或要放未解析詞綴 / 破裂提示 / 空清單提示時才畫
      showModsCard: computed(
        () =>
          cards.value.mods.rows.length > 0 ||
          Boolean(showUnknownMods.value) ||
          showMissingFracturedWarning.value ||
          !cards.value.pseudo.rows.length,
      ),
      showUnknownMods,
      hasStats: computed(
        () =>
          props.stats.length ||
          (showUnknownMods.value && props.item.rarity === ItemRarity.Unique) ||
          props.presets.length > 1,
      ),
      handleStatsSubmit() {
        ctx.emit("submit");
      },
      selectPreset(id: string) {
        ctx.emit("preset", id);
      },
      hiddenLabel: computed(() => {
        if (
          props.item.category === ItemCategory.Map ||
          props.item.category === ItemCategory.Waystone
        ) {
          return t("filters.hidden_explicit_toggle");
        } else {
          return t("filters.hidden_toggle");
        }
      }),
      showMissingFracturedWarning,
      showItemEditor,
      canHaveCatalyst: computed(() => {
        return (
          props.item.category === ItemCategory.Ring ||
          props.item.category === ItemCategory.Amulet ||
          props.item.category === ItemCategory.Jewel
        );
      }),
      currentCatalyst: computed(() => {
        if (
          !props.item.qualityType ||
          !props.item.quality ||
          showItemEditor.value !== ItemEditorType.Catalyst
        )
          return undefined;

        const catalysts =
          props.item.category === ItemCategory.Jewel
            ? CATALYST_TYPES.Refined
            : CATALYST_TYPES.Normal;

        return catalysts.find((c) => c.tags[1] === props.item.qualityType);
      }),
    };
  },
});
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
