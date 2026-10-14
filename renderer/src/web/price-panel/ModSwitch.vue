<template>
  <!-- 查價面板 B 改版(2026-10-14):詞綴列左側開關,行為等同原本的勾選框(click / type 由使用端經 attrs 傳入) -->
  <button role="switch" :aria-checked="on ? 'true' : 'false'" :aria-label="label"
    class="mod-switch" :class="{ on }"><span class="knob" aria-hidden="true" /></button>
</template>

<script setup lang="ts">
defineProps<{ on: boolean, label?: string }>()
</script>

<style scoped>
.mod-switch {
  position: relative;
  flex: none;
  width: 2.3em;
  height: 1.38em;
  border: 0;
  border-radius: 0.69em;
  padding: 0;
  cursor: pointer;
  background: var(--edge-2);
  transition: background-color 0.12s;
}
.mod-switch.on {
  background: var(--gold);
}
.mod-switch:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.knob {
  position: absolute;
  top: 0.15em;
  left: 0.15em;
  width: 1.08em;
  height: 1.08em;
  border-radius: 50%;
  background: var(--surface-0-c);
  transition: left 0.12s;
}
.mod-switch.on .knob {
  left: 1.07em;
}
</style>
