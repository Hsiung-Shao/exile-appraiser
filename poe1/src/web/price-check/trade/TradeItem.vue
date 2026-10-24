<template>
  <!-- exile-appraiser(2026-10-15):一筆掛單(長條 = 表格列、方塊 = 小卡片;原本寫在 TradeListing 裡),本元件持有懸停浮窗的 tippy -->
  <tr
    v-if="layout !== 'grid'"
    ref="target"
    data-listing-row
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <td class="px-2 whitespace-nowrap">
      <span :class="{ 'line-through': result.priceCurrency === 'exalted' }">{{ result.priceAmount }} {{ result.priceCurrency }}</span>
      <span v-if="result.listedTimes > 2" class="rounded-sm px-1 text-gray-800 bg-gray-400 ml-1 -mr-2"><span class="font-sans">×</span> {{ result.listedTimes }}</span>
      <span v-else-if="!result.hasFee" :class="$style.stashListing">
        <img :class="$style.stashIcon" src="/images/stash.png">
        <i v-if="!result.hasNote" class="fas fa-question" />
      </span>
    </td>
    <td v-if="item.stackSize" class="px-2 text-right">{{ result.stackSize }}</td>
    <td v-if="filters.itemLevel" class="px-2 whitespace-nowrap text-right">{{ result.itemLevel }}</td>
    <td v-if="item.category === 'Gem'" class="pl-2 whitespace-nowrap">{{ result.level }}</td>
    <td v-if="filters.quality || item.category === 'Gem'" class="px-2 whitespace-nowrap text-blue-400 text-right">{{ result.quality }}</td>
    <td class="pr-2 pl-4 whitespace-nowrap">
      <div class="inline-flex items-center">
        <div :class="[$style.accountStatus, $style[result.accountStatus]]"></div>
        <div class="ml-1 font-sans text-xs">{{ result.relativeDate }}</div>
      </div>
      <span v-if="!showSeller && result.isMine" class="rounded-sm px-1 text-gray-800 bg-gray-400 ml-1">{{ t('You') }}</span>
    </td>
    <td v-if="showSeller" class="px-2 whitespace-nowrap">
      <span v-if="result.isMine" class="rounded-sm px-1 text-gray-800 bg-gray-400">{{ t('You') }}</span>
      <span v-else class="font-sans text-xs">{{ showSeller === 'ign' ? result.ign : result.accountName }}</span>
    </td>
  </tr>
  <div
    v-else
    ref="target"
    class="listing-tile"
    data-listing="item"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <span class="listing-price"><span :class="{ 'line-through': result.priceCurrency === 'exalted' }">{{ result.priceAmount }} {{ result.priceCurrency }}</span></span>
    <span v-if="result.listedTimes > 2" class="listing-badge"><span class="font-sans">×</span> {{ result.listedTimes }}</span>
    <span v-else-if="!result.hasFee" :class="$style.stashListing">
      <img :class="$style.stashIcon" src="/images/stash.png">
      <i v-if="!result.hasNote" class="fas fa-question" />
    </span>
    <span v-if="item.stackSize" class="listing-meta">{{ t('ppz.listing.stock', { n: result.stackSize }) }}</span>
    <span v-if="filters.itemLevel" class="listing-meta">{{ t('ppz.listing.ilvl', { n: result.itemLevel }) }}</span>
    <span v-if="item.category === 'Gem'" class="listing-meta">{{ t('ppz.listing.gem_level', { n: result.level }) }}</span>
    <span v-if="filters.quality || item.category === 'Gem'" class="listing-meta text-blue-400">{{ t('ppz.listing.quality', { n: result.quality }) }}</span>
    <span class="listing-time">
      <span :class="[$style.accountStatus, $style[result.accountStatus]]"></span>
      <span class="font-sans">{{ result.relativeDate }}</span>
    </span>
    <span v-if="result.isMine" class="listing-badge">{{ t('You') }}</span>
    <span v-else-if="showSeller" class="listing-meta font-sans text-xs">{{ showSeller === 'ign' ? result.ign : result.accountName }}</span>
  </div>
  <!-- 浮窗內容的掛點:tippy 建立時整塊搬進浮窗;「關閉」不建 tippy 也不畫這塊(不會畫進表格裡)。方塊版面不佔 grid 格子 -->
  <div
    v-if="enabled"
    ref="content"
    data-tooltip-content
    :style="layout === 'grid' ? { display: 'contents' } : undefined"
  >
    <!-- 第一次懸停才掛浮窗內容(物品卡片不便宜) -->
    <tooltip-item v-if="isHovered && result.displayItem" :item="result.displayItem" />
  </div>
</template>

<script lang="ts">
// exile-appraiser(2026-10-15):PoE1 查價結果懸停顯示物品。tippy 設定照 PoE2 TradeItem.vue(移植自 Exiled Exchange 2,MIT):
// interactive、placement left、掛 document.body、flip 後備;「滑鼠懸停顯示物品」三選一 off / keybind(按住 Shift)/ always。
// 合併掛單(listedTimes > 1)顯示第一筆的物品(TradeListing 的 groupedResults 保留第一筆)。
import { defineComponent, onBeforeUnmount, onMounted, PropType, ref, shallowRef } from 'vue'
import tippy, { Instance } from 'tippy.js'
import 'tippy.js/dist/tippy.css'
import { useI18nNs } from '@/web/i18n'
import { AppConfig } from '@/web/Config'
import { PriceCheckWidget } from '@/web/overlay/interfaces'
import { ParsedItem } from '@/parser'
import { ItemFilters } from '../filters/interfaces'
import { PricingResult } from './pathofexile-trade'
import TooltipItem from './TooltipItem.vue'

export default defineComponent({
  name: 'TradeItem',
  components: { TooltipItem },
  props: {
    result: {
      type: Object as PropType<PricingResult & { listedTimes: number }>,
      required: true
    },
    item: {
      type: Object as PropType<ParsedItem>,
      required: true
    },
    filters: {
      type: Object as PropType<ItemFilters>,
      required: true
    },
    showSeller: {
      type: [Boolean, String] as PropType<PriceCheckWidget['showSeller']>,
      default: undefined
    },
    layout: {
      type: String as PropType<'grid' | 'list'>,
      default: 'list'
    }
  },
  setup () {
    const { t } = useI18nNs('trade_result')
    // 掛載當下的設定(TradeListing 每次查價重建,設定頁改了下一次查價生效)
    const mode = AppConfig<PriceCheckWidget>('price-check')?.itemHoverTooltip ?? 'keybind'
    const enabled = mode !== 'off'
    const target = shallowRef<HTMLElement | null>(null)
    const content = shallowRef<HTMLElement | null>(null)
    const isHovered = ref(false)
    let instance: Instance | undefined

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || !instance) return
      instance.enable()
      if (isHovered.value) instance.show()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || !instance) return
      instance.hide()
      instance.disable()
    }

    onMounted(() => {
      if (!enabled || !target.value || !content.value) return
      if (mode === 'keybind') {
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
      }
      instance = tippy(target.value, {
        content: content.value,
        interactive: true,
        theme: 'item-tooltip',
        trigger: 'mouseenter',
        placement: 'left',
        arrow: true,
        delay: [0, 0],
        animation: false,
        maxWidth: 'none',
        // 同 PoE2:掛 document.body 脫離 .price-main / .bg-host 的 overflow 裁切
        appendTo: () => document.body,
        // window 模式左邊放不下依序改右、下、上
        popperOptions: {
          modifiers: [{ name: 'flip', options: { fallbackPlacements: ['right', 'bottom', 'top'] } }]
        }
      })
      if (mode === 'keybind') instance.disable()
    })

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      instance?.destroy()
      instance = undefined
    })

    return { t, target, content, isHovered, enabled }
  }
})
</script>

<style lang="postcss" module>
@reference "../../../../../renderer/src/theme/tailwind.css"; /* exile-appraiser: Tailwind 4 升級(2026-10-24),讓 @apply / theme() 認得 utility */
.accountStatus {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 100%;

  /* &.online {} */
  &.offline { @apply bg-red-600; }
  &.afk { @apply bg-orange-500; }
}

.stashListing {
  position: relative;
  display: inline-block;
  @apply ml-1 -mr-1;

  & > i {
    position: absolute;
    line-height: inherit;
    left: 0;
    right: 0;
    text-align: center;
    text-shadow: 1px 1px 1px black;
  }
}

.stashIcon {
  filter: grayscale(1) opacity(0.5);
  display: inline-block;
  max-width: none;
  height: 1.25rem;
  vertical-align: bottom;
}
</style>

<style lang="postcss">
@reference "../../../../../renderer/src/theme/tailwind.css"; /* exile-appraiser: Tailwind 4 升級(2026-10-24),讓 @apply / theme() 認得 utility */
/* 浮窗外框透明(與 PoE2 TradeItem.vue 同一組全域規則;PoE1 單獨載入時也要有) */
.tippy-box[data-theme~="item-tooltip"] {
  @apply w-fit h-fit;
  @apply shadow-none bg-transparent;
}
div[data-tippy-root] .tippy-box[data-theme~="item-tooltip"] {
  @apply bg-transparent;
}
.tippy-box[data-theme~="item-tooltip"] .tippy-content {
  @apply p-0 w-fit h-fit;
}
.tippy-box[data-theme~="item-tooltip"] > .tippy-arrow::before {
  @apply text-ink-0;
}
</style>
