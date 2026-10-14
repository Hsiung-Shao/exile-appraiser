<!--
  查價面板 B 改版 P4(2026-10-14):通貨「兌換條件」的「用什麼買」膠囊(圖示 + 名稱 · 筆數,aria-pressed)。
  選擇狀態與筆數沿用兩代 TradeBulk 原本的 selectedCurr / listed.total。
-->
<template>
  <button type="button" class="listing-chip" :aria-pressed="pressed ? 'true' : 'false'" :title="title"
    data-action="listing-pay-with" @click="$emit('select')">
    <img :src="icon" alt="">
    <span>{{ label }} · {{ count }}</span>
  </button>
</template>

<script setup lang="ts">
defineProps<{ icon: string, label: string, count: string | number, pressed: boolean, title?: string }>()
defineEmits<{ (e: 'select'): void }>()
</script>

<style>
.listing-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  height: 2.2em;
  padding: 0 0.75em 0 0.3em;
  border: 1px solid var(--edge-1);
  border-radius: 1.1em;
  background: var(--surface-0);
  color: var(--ink-2);
  font-family: var(--font-mono);
  cursor: pointer;
  white-space: nowrap;
}
.listing-chip img {
  width: 1.6em;
  height: 1.6em;
  filter: grayscale(1);
  opacity: 0.75;
}
.listing-chip:hover { color: var(--ink-0); }
.listing-chip[aria-pressed="true"] {
  border-color: var(--gold);
  color: var(--ink-0);
}
.listing-chip[aria-pressed="true"] img {
  filter: none;
  opacity: 1;
}
</style>
