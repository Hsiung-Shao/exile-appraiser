<template>
  <div v-if="d" class="flex flex-row items-start" data-tooltip="item">
    <!-- exile-appraiser: 移植自 Exiled Exchange 2 TooltipItem.vue(MIT);PoE1 插槽(顏色 + 連線)以文字行顯示,圖示不疊插槽 -->
    <div v-if="d.icon" class="bg-surface-2" :class="$style['i-w-' + iconWidth]">
      <img :src="d.icon.url" class="max-w-full max-h-full mx-auto" alt="">
    </div>
    <div class="flex flex-col bg-black text-center">
      <div class="flex flex-col items-center justify-center text-base px-8" :class="[$style[headerStyle], headerText]" data-tooltip-title>
        <div v-for="(t, i) in d.title" :key="i">{{ t }}</div>
      </div>
      <div class="flex flex-col p-1 text-center">
        <template v-for="(section, index) in sections" :key="section.key">
          <div :data-section="section.key">
            <div v-for="(mod, j) in section.content" :key="j" class="flex items-center justify-between gap-1">
              <span class="grow text-center">
                <template v-if="mod.segments">
                  <span v-for="(sg, k) in mod.segments" :key="k" :class="sg.value ? $style[`c-${sg.color}`] : 'text-gray-400'">{{ sg.text }}</span>
                </template>
                <span v-else :class="mod.values ? 'text-gray-400' : $style[`c-${mod.color}`]">{{ mod.text }}</span>
                <template v-for="(v, k) in mod.segments ? [] : (mod.values ?? [])" :key="k">
                  <span v-if="k">, </span>
                  <span :class="$style[`c-${v.color}`]">{{ v.text }}</span>
                </template>
              </span>
              <span v-if="mod.tier" :class="tierClass(mod.tier)">{{ mod.tier }}</span>
            </div>
          </div>
          <div v-if="index < sections.length - 1" :class="$style[separatorStyle]" />
        </template>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// exile-appraiser(2026-10-15):PoE1 查價結果懸停浮窗的物品卡片。
// 移植自 Exiled Exchange 2(MIT,Kvan7/Exiled-Exchange-2 renderer/src/web/price-check/trade/TooltipItem.vue)改寫成 PoE1 資料
// (display-item.ts 的 DisplayItem:多值屬性各自上色、破裂 / 工藝詞綴獨立一區、PoE1 稀有度含寶石 / 通貨 / 命運卡)。
// 文字一律來自交易站回應或繁中化結果(display-zh.ts),本元件不翻譯。
import { computed, defineComponent, PropType } from 'vue'
import type { DisplayItem, DisplayLine } from './display-item'

const HEADER: Record<string, string> = {
  Normal: 'Normal', Magic: 'Magic', Rare: 'Rare', Unique: 'Unique', Relic: 'Unique',
  Gem: 'Gem', Currency: 'Currency', Divination: 'Currency'
}

export default defineComponent({
  props: {
    item: {
      type: Object as PropType<DisplayItem | undefined>,
      default: undefined
    }
  },
  setup (props) {
    const d = computed(() => props.item)
    const sections = computed(() => {
      const item = d.value
      if (!item) return []
      const all: Array<{ key: string, content: DisplayLine[] | undefined }> = [
        { key: 'nameBlock', content: item.nameBlock },
        { key: 'itemProps', content: item.itemProps },
        { key: 'enchantMods', content: item.enchantMods },
        { key: 'implicitMods', content: item.implicitMods },
        {
          key: 'explicitMods',
          content: [
            ...(item.fracturedMods ?? []),
            ...(item.explicitMods ?? []),
            ...(item.craftedMods ?? []),
            ...(item.veiledMods ?? [])
          ]
        },
        { key: 'itemTags', content: item.itemTags }
      ]
      return all.filter((s): s is { key: string, content: DisplayLine[] } => !!s.content?.length)
    })
    const rarityKey = computed(() => HEADER[d.value?.rarity ?? 'Normal'] ?? 'Normal')
    return {
      d,
      sections,
      iconWidth: computed(() => Math.min(Math.max(d.value?.icon?.w ?? 1, 1), 3)),
      headerStyle: computed(() => {
        const r = rarityKey.value
        return (r === 'Rare' || r === 'Unique' || r === 'Magic') ? `${r}-title` : 'Normal-title'
      }),
      headerText: computed(() => {
        const r = rarityKey.value
        return r === 'Gem' ? 'text-gem' : r === 'Currency' ? 'text-currency' : `text-${r.toLowerCase()}`
      }),
      separatorStyle: computed(() => {
        const r = rarityKey.value
        return (r === 'Rare' || r === 'Unique' || r === 'Magic') ? `${r}-separator` : 'plain-separator'
      }),
      tierClass (tier: string) {
        return { 'text-blue-300': tier.startsWith('S'), 'text-red-300': tier.startsWith('P') }
      }
    }
  }
})
</script>

<style lang="postcss" module>
@reference "../../../../../renderer/src/theme/tailwind.css";
.i-w-1 { @apply w-12; }
.i-w-2 { @apply w-24; }
.i-w-3 { @apply w-36; }

/* 白字改 --ink-0(提示框在 .pob-dark 深色島內,仍是亮字);其餘照 EE2 的數值顏色 */
.c-0 { @apply text-ink-0; }
.c-1 { @apply text-indigo-500; }
.c-2 { @apply text-red-500; }
.c-3 { @apply text-ink-0; }
.c-4 { @apply text-red-700; }
.c-5 { @apply text-blue-700; }
.c-6 { @apply text-yellow-500; }
.c-7 { @apply text-pink-800; }
.c-8729 { @apply text-indigo-300; }
.c-8730 { @apply text-orange-300; }
.c-8734 { @apply text-indigo-300; }
.c-8735 { @apply text-gray-500; }

/* 標題底圖與分隔線(與 PoE2 TooltipItem 同一組圖,renderer/public/images/item-display) */
.Normal-title, .Magic-title { @apply h-[34px]; }
.Rare-title, .Unique-title { @apply h-14; }
.Normal-title, .Magic-title, .Rare-title, .Unique-title {
  background-position: top left, top right, top center;
  background-repeat: no-repeat, no-repeat, repeat-x;
}
.Normal-title {
  background-image: url("/images/item-display/normal-left.png"), url("/images/item-display/normal-right.png"), url("/images/item-display/normal-middle.png");
  background-size: 29px auto, 29px auto, 29px auto;
}
.Magic-title {
  background-image: url("/images/item-display/magic-left.png"), url("/images/item-display/magic-right.png"), url("/images/item-display/magic-middle.png");
  background-size: 29px auto, 29px auto, 29px auto;
}
.Rare-title {
  background-image: url("/images/item-display/rare-double-left.png"), url("/images/item-display/rare-double-right.png"), url("/images/item-display/rare-double-middle.png");
  background-size: 46px auto, 46px auto, 46px auto;
}
.Unique-title {
  background-image: url("/images/item-display/unique-double-left.png"), url("/images/item-display/unique-double-right.png"), url("/images/item-display/unique-double-middle.png");
  background-size: 46px auto, 46px auto, 46px auto;
}
.Rare-separator, .Magic-separator, .Unique-separator { @apply bg-center bg-no-repeat h-1; }
.Magic-separator { background-image: url("/images/item-display/separator-magic.png"); }
.Rare-separator { background-image: url("/images/item-display/separator-rare.png"); }
.Unique-separator { background-image: url("/images/item-display/separator-unique.png"); }
.plain-separator { @apply block h-[2px] bg-linear-to-r/srgb from-transparent via-gray-400 to-transparent my-1; }
</style>
