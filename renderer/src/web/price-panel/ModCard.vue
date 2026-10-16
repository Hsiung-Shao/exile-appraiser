<template>
  <!-- 查價面板 B 改版(2026-10-14):詞綴 / 偽屬性(總和)卡片(標題 + 已選數);2026-10-16 可折疊(原始詞綴卡) -->
  <section class="mod-card" :data-card="id">
    <button v-if="collapsible" type="button" class="mod-card-h toggle" data-part="card-toggle"
      :aria-expanded="collapsed ? 'false' : 'true'"
      @click="emit('update:collapsed', !collapsed)">
      <i class="fas chev" :class="collapsed ? 'fa-chevron-right' : 'fa-chevron-down'" aria-hidden="true"></i>
      <span data-part="card-title">{{ title }}</span>
      <span class="grow" />
      <span data-part="card-count" class="count">{{ count }}</span>
    </button>
    <div v-else class="mod-card-h">
      <span data-part="card-title">{{ title }}</span>
      <span class="grow" />
      <span data-part="card-count" class="count">{{ count }}</span>
    </div>
    <slot v-if="!collapsible || !collapsed" />
  </section>
</template>

<script setup lang="ts">
defineProps<{ id: string, title: string, count: string, collapsible?: boolean, collapsed?: boolean }>()
const emit = defineEmits<{ (e: 'update:collapsed', value: boolean): void }>()
</script>

<style scoped>
.mod-card {
  display: flex;
  flex-direction: column;
  padding: 0.6em 0.85em 0.4em;
  border: 1px solid var(--edge-0);
  border-radius: 0.9em;
  background: var(--surface-1);
}
.mod-card + .mod-card {
  margin-top: 0.6em;
}
.mod-card-h {
  display: flex;
  align-items: center;
  gap: 0.6em;
  padding: 0 0.15em 0.3em;
  font-size: 0.92em;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-2);
}
.mod-card-h.toggle {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.mod-card-h.toggle:hover {
  color: var(--ink-1);
}
.mod-card-h.toggle:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: 0.4em;
}
.chev {
  font-size: 0.8em;
  width: 0.9em;
}
.grow {
  flex: 1;
}
.count {
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
</style>
