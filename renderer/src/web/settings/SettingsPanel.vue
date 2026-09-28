<!--
  設定面板(WP2):PobTools 語彙 —— 金底線分頁(.tab)+ 每頁用 .card(左 3px 金邊)分組、.label 區段標題、
  欄位 .input/.select/.chk、切換 .seg。分頁內容在 ./tabs/;列版面 .srow 定義在本檔(unscoped,限 .settings-panel 內)。
  分頁狀態在 ./tabState.ts(托盤「設定」「關於」直接指定分頁)。
-->
<template>
  <div class="settings-panel">
    <nav class="tabs settings-tabs" role="tablist">
      <button v-for="tb in tabs" :key="tb.id" class="tab" :class="{ on: tab === tb.id }" role="tab"
        :aria-selected="tab === tb.id" :data-tab="tb.id" @click="tab = tb.id">{{ t(tb.key) }}</button>
      <span class="grow" />
      <button class="btn ghost sm settings-back" @click="$emit('close')">{{ t('ppz.back') }}</button>
    </nav>
    <div class="settings-body">
      <component :is="tabComponent" />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import GeneralTab from './tabs/General.vue'
import PriceCheckTab from './tabs/PriceCheck.vue'
import HotkeysTab from './tabs/Hotkeys.vue'
import RegexTab from './tabs/Regex.vue'
import AboutTab from './tabs/About.vue'
import { settingsTab as lastTab, type TabId } from './tabState'

export default defineComponent({
  emits: ['close'],
  setup () {
    const { t } = useI18n()
    const tabs: Array<{ id: TabId, key: string }> = [
      { id: 'general', key: 'ppz.tab_general' },
      { id: 'price-check', key: 'ppz.tab_price_check' },
      { id: 'hotkeys', key: 'ppz.tab_hotkeys' },
      { id: 'regex', key: 'ppz.tab_regex' },
      { id: 'about', key: 'ppz.tab_about' }
    ]
    const components = {
      general: GeneralTab,
      'price-check': PriceCheckTab,
      hotkeys: HotkeysTab,
      regex: RegexTab,
      about: AboutTab
    }
    return {
      t,
      tabs,
      tab: lastTab,
      tabComponent: computed(() => components[lastTab.value])
    }
  }
})
</script>

<style>
.settings-panel {
  position: relative; /* 關於頁授權 modal 蓋在面板內 */
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface-0);
}
.settings-tabs {
  flex-shrink: 0;
  align-items: center;
  padding: 0 8px;
  background: var(--surface-1);
  overflow-x: auto;
}
.settings-tabs .tab {
  align-self: stretch;
}
.settings-tabs .grow {
  flex: 1;
}
.settings-back {
  align-self: center;
  margin-left: 8px;
}
.settings-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 一列:左標籤、右控制項;窄面板(overlay 固定寬)下標籤欄約佔三分之一 */
.settings-panel .srow {
  display: grid;
  grid-template-columns: minmax(80px, 34%) minmax(0, 1fr);
  align-items: center;
  gap: 4px 12px;
  min-height: 30px;
  padding: 2px 0;
}
.settings-panel .srow > .k {
  font-size: var(--fs-xs);
  color: var(--ink-2);
}
.settings-panel .srow > .ctl {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.settings-panel .srow > .ctl > .input,
.settings-panel .srow > .ctl > .select {
  flex: 1;
  min-width: 0;
}
.settings-panel .srow > .note {
  grid-column: 2;
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.settings-panel .srow > .err {
  grid-column: 1 / -1;
  font-size: var(--fs-xs);
  color: var(--bad);
}
.settings-panel .chk-row {
  display: flex;
  min-height: 28px;
  align-items: center;
}
.settings-panel .foot {
  margin-top: 6px;
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.settings-panel .placeholder {
  color: var(--ink-3);
  font-size: var(--fs-sm);
}
</style>
