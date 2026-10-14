<!--
  查價面板 B 改版 P4(2026-10-14):掛單卡標題列右側「方塊 / 長條」切換(aria-pressed)。
  兩代 TradeListing / TradeBulk 以 `@/web/price-panel/ListingLayoutToggle.vue` 使用,v-model = useListingLayout 的值。
  掛單卡共用樣式(.listing-*)也放這裡(unscoped,class 都以 listing- 開頭);根節點 `.listing-root` / 卡片 `.listing-card` / 內容 `.listing-body`
  不縮、不另開捲動區(守門 `renderer/test/listing-card-layout.test.ts`)。
-->
<template>
  <span class="listing-seg" role="group" :aria-label="t('ppz.listing.layout_group')" data-action="listing-layout">
    <button type="button" :aria-pressed="modelValue === 'grid' ? 'true' : 'false'" data-layout="grid"
      :aria-label="t('ppz.listing.layout_grid')" :title="t('ppz.listing.layout_grid')"
      @click="pick('grid')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>
    </button>
    <button type="button" :aria-pressed="modelValue === 'list' ? 'true' : 'false'" data-layout="list"
      :aria-label="t('ppz.listing.layout_list')" :title="t('ppz.listing.layout_list')"
      @click="pick('list')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
  </span>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ListingLayoutMode } from './listing-layout'

const props = defineProps<{ modelValue: ListingLayoutMode }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: ListingLayoutMode): void }>()
const { t } = useI18n()

function pick (mode: ListingLayoutMode) {
  if (mode !== props.modelValue) emit('update:modelValue', mode)
}
</script>

<style>
/* ---- 掛單卡(兩代 TradeListing / TradeBulk 共用;只用主題 token) ----
   掛單完整顯示、跟著面板(`.price-main`)一起捲動:CheckedItem 是 `.layout-column`(height: 100% = 面板捲動區高度),
   根節點 / 卡片若可縮(min-height: 0)會被 flex 壓到只剩標題列,內層捲動區再把掛單裁掉(2026-10-14 修正)→ 一律 flex: none、內層不捲動 */
.listing-root {
  display: flex;
  flex-direction: column;
  flex: none;
}
.listing-card {
  display: flex;
  flex-direction: column;
  flex: none;
  gap: 0.4em;
  padding: 0.6em;
  border-radius: var(--radius-m, 8px);
  background: var(--surface-1);
  border: 1px solid var(--edge-0);
}
.listing-body {
  display: flex;
  flex-direction: column;
  /* clip 不會把另一軸變成捲動容器(hidden 會讓 overflow-y 變 auto) */
  overflow-x: clip;
}
.listing-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5em;
  padding: 0 0.15em;
  font-size: var(--fs-sm, 0.92em);
  color: var(--ink-2);
}
.listing-head-title {
  font-weight: 700;
  letter-spacing: 0.04em;
}
.listing-head-sub {
  font-weight: 400;
  font-family: var(--font-mono);
}
.listing-spacer { flex: 1; }

.listing-seg {
  display: inline-flex;
  border: 1px solid var(--edge-1);
  border-radius: 0.75em;
  overflow: hidden;
  flex: none;
}
.listing-seg > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.7em;
  padding: 0 0.6em;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}
.listing-seg > button:hover { color: var(--ink-0); }
.listing-seg > button[aria-pressed="true"] {
  background: var(--surface-3);
  color: var(--ink-0);
}
.listing-seg svg {
  width: 0.95em;
  height: 0.95em;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

/* 方塊:兩欄小卡片 */
.listing-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45em;
}
.listing-tile {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25em 0.55em;
  min-width: 0;
  padding: 0.55em 0.7em;
  border-radius: 0.7em;
  background: var(--surface-0);
  border: 1px solid var(--edge-0);
  font-size: var(--fs-sm, 0.92em);
}
.listing-tile.is-placeholder { min-height: 2.6em; }
.listing-tile.is-market {
  background: var(--surface-2);
  border-color: var(--edge-2);
  color: var(--ink-1);
}
.listing-price {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  padding: 0.05em 0.45em;
  border-radius: 0.45em;
  background: var(--gold-soft);
  color: var(--gold);
  font-family: var(--font-mono);
  font-weight: 700;
  white-space: nowrap;
}
.listing-price img {
  width: 1.25em;
  height: 1.25em;
}
.listing-meta {
  color: var(--ink-1);
  white-space: nowrap;
}
.listing-time {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  margin-left: auto;
  color: var(--ink-3);
  font-size: 0.92em;
  white-space: nowrap;
}
.listing-badge {
  padding: 0 0.35em;
  border-radius: 0.3em;
  background: var(--ink-1);
  color: var(--surface-0-c);
  white-space: nowrap;
}
</style>
