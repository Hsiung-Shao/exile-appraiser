<template>
  <button :class="[$style.btn, { [$style.active]: (active != null) ? active : !filter.disabled }]"
    @click="toggle"
  >
    <img v-if="img" :src="img" class="w-5 h-5">
    <span class="pl-1">{{ t(text) }}</span>
    <i v-if="collapse" class="pl-2 text-xs text-gray-400"
      :class="filter.disabled ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" />
  </button>
</template>

<script setup lang="ts">
// exile-appraiser: 2026-10-14 B 改版:本檔呈現層已重寫(外觀改成物品標頭膠囊;行為不動),記錄在 docs/poe2-port-notes.md「查價面板 B 改版」。
import { type PropType } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  filter: {
    type: Object as PropType<{ disabled: boolean }>, // will be mutated directly, instead of emit
    required: true
  },
  text: { type: String, required: true },
  img: { type: String, default: undefined },
  readonly: { type: Boolean, default: undefined },
  active: { type: Boolean, default: undefined },
  collapse: { type: Boolean, default: undefined }
})

const { t } = useI18n()

function toggle () {
  const { filter, readonly } = props
  if (!readonly) {
    filter.disabled = !filter.disabled
  }
}
</script>

<style lang="postcss" module>
.btn {
  /* 2026-10-14 B 改版:物品標頭膠囊 */
  display: flex;
  align-items: center;
  height: 1.85em;
  padding: 0 0.75em 0 0.45em;
  border: 1px solid var(--edge-1);
  border-radius: 999px;
  background: var(--surface-1);
  color: var(--ink-2);

  &:hover {
    border-color: var(--edge-2);
  }

  &.active {
    border-color: var(--gold-dim);
    background: var(--gold-soft);
    color: var(--ink-0);
  }
}
</style>
