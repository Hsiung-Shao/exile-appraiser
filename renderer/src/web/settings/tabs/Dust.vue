<!--
  設定 › 拆粉排行(2026-09-30 起;原本停靠在查價面板下方)。內容就是 ../../dust/DustPanel.vue,
  填滿設定視窗右側內容區(SettingsWindow.vue 在這一頁替 .settings-body 加 .fill:不捲動、子元素撐滿,
  表格自己虛擬捲動)。選項 / 標記 / 隱藏照舊存 userData/dust_ui.json(../../dust/store.ts)。
-->
<template>
  <dust-panel class="settings-dust" />
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import DustPanel from '../../dust/DustPanel.vue'

export default defineComponent({
  components: { DustPanel }
})
</script>

<style>
.settings-panel .settings-dust {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--edge-0);
  border-radius: var(--radius-m);
  overflow: hidden;
  container-type: inline-size;
  container-name: settings-dust;
}
/* 窄:面板內距收小,寬度留給表格 */
@container settings-dust (max-width: 520px) {
  .settings-panel .settings-dust .dust-body { padding: 6px; gap: 6px; }
}
</style>
