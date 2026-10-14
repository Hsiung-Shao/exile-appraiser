<!--
  查價面板 B 改版 P4(2026-10-14):通貨「兌換條件」卡右上「● 只看在線」開關(aria-pressed)。
  只負責呈現;值由兩代 TradeBulk 綁到原本的篩選狀態(PoE1 `filters.trade.offline`、PoE2 `filters.trade.listingType`),
  篩選改變後 CheckedItem 原本的 watch 會重新查詢。
-->
<template>
  <button type="button" class="listing-online" :aria-pressed="modelValue ? 'true' : 'false'"
    data-action="listing-online-only" @click="$emit('update:modelValue', !modelValue)">
    <span class="listing-online-dot" aria-hidden="true">●</span>{{ t('ppz.listing.online_only') }}
  </button>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ modelValue: boolean }>()
defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
const { t } = useI18n()
</script>

<style>
.listing-online {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  height: 1.9em;
  padding: 0 0.75em;
  border: 1px solid var(--edge-1);
  border-radius: 0.75em;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  white-space: nowrap;
}
.listing-online-dot { color: var(--ink-4); }
.listing-online[aria-pressed="true"] {
  color: var(--ok);
  border-color: color-mix(in srgb, var(--ok) 45%, transparent);
  background: color-mix(in srgb, var(--ok) 8%, transparent);
}
.listing-online[aria-pressed="true"] .listing-online-dot { color: var(--ok); }
</style>
