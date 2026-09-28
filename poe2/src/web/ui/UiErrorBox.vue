<!--
  exile-appraiser: 外觀改成 pobtools 的 .card(左 3px --bad 邊)、標題 --bad、actions 靠右;
  插槽介面(name / default / actions)與上游相同,poe1 的移植元件不用改。與 renderer/src/web/ui/UiErrorBox.vue 同一份(PoE2 的移植元件先找這裡)。
-->
<template>
  <div class="card bad" :class="$style.box">
    <h4 :class="$style.title">
      <slot name="name">Error comes here.</slot>
    </h4>
    <div :class="$style.body"><slot /></div>
    <div v-if="$slots.actions" :class="$style.actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'UiErrorBox'
})
</script>

<style module>
.box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.title {
  margin: 0;
  color: var(--bad);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.body {
  color: var(--ink-1);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
}
.body:empty {
  display: none;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}
</style>
