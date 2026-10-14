<template>
  <!-- 查價面板 B 改版(2026-10-14):最小–最大範圍膠囊;輸入框由使用端以具名插槽放入(ref / v-model / 事件行為不變) -->
  <div data-part="range" class="mod-range"><slot name="min" /><span class="sep" aria-hidden="true">–</span><slot name="max" /></div>
</template>

<style scoped>
.mod-range {
  display: flex;
  align-items: center;
  flex: none;
  height: 2em;
  border: 1px solid var(--edge-1);
  border-radius: 1em;
  background: var(--surface-0);
  overflow: hidden;
  font-variant-numeric: tabular-nums;
}
.mod-range:focus-within {
  border-color: var(--edge-2);
}
.sep {
  color: var(--ink-4);
}
.mod-range :slotted(input) {
  width: 3.1em;
  height: 100%;
  border: 0;
  border-radius: 0;
  padding: 0 0.2em;
  background: transparent;
  color: var(--ink-0);
  text-align: center;
}
.mod-range :slotted(input::placeholder) {
  color: var(--ink-4);
}
.mod-range :slotted(input:focus) {
  background: var(--surface-2);
  outline: none;
}
</style>
