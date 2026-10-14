<template>
  <!-- 查價面板 B 改版(2026-10-14):二選一(一般 / 破裂)小分段鈕 -->
  <span role="group" class="mod-seg">
    <button v-for="opt of options" :key="opt.value" type="button"
      :data-choice="opt.value"
      :aria-pressed="opt.value === modelValue ? 'true' : 'false'"
      :title="opt.title"
      :class="{ on: opt.value === modelValue, strong: opt.value === modelValue && opt.strong }"
      @click="pick(opt.value)">{{ opt.label }}</button>
  </span>
</template>

<script setup lang="ts">
export interface ModSegOption { value: string, label: string, title?: string, strong?: boolean }

const props = defineProps<{ options: ModSegOption[], modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

function pick (value: string) {
  if (value !== props.modelValue) emit('update:modelValue', value)
}
</script>

<style scoped>
.mod-seg {
  display: inline-flex;
  border: 1px solid var(--edge-1);
  border-radius: 0.8em;
  overflow: hidden;
}
.mod-seg button {
  height: 1.6em;
  padding: 0 0.75em;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: 0.85em;
  line-height: 1;
  cursor: pointer;
}
.mod-seg button:hover {
  color: var(--ink-1);
}
.mod-seg button.on {
  background: var(--surface-3);
  color: var(--ink-0);
  font-weight: 700;
}
.mod-seg button.strong {
  background: var(--gold-soft);
  color: var(--gold);
}
.mod-seg button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
</style>
