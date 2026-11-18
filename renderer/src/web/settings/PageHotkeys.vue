<!--
  功能頁頂端「這頁的熱鍵」(2026-11-18 設定重整,方案 B):唯讀列出這一頁功能用到的全域熱鍵(鍵帽),
  「在熱鍵總表修改 ›」跳到熱鍵總表(jumpToTab:總表頂端出現「← 回到 …」)。全域熱鍵仍只在總表編輯(settings-ia.test.ts 守門)。
  列取自 hotkey-table.ts `hotkeyTable()`,`ids` = 總表列 id;目前模式 / 遊戲沒有的列不畫,一列都沒有就整條不畫。
-->
<template>
  <div v-if="rows.length" class="page-hk" data-setting="page-hotkeys">
    <span class="page-hk-lbl">{{ t('ppz.page_hotkeys.label') }}</span>
    <span v-for="r in rows" :key="r.id" class="page-hk-item" :data-page-hk="r.id">
      <span>{{ t(r.label) }}</span>
      <span v-if="r.keys.length" class="keys"><kbd v-for="(k, i) in r.keys" :key="i" class="keycap">{{ k }}</kbd></span>
      <kbd v-else class="keycap empty">{{ t('ppz.hk.unset') }}</kbd>
    </span>
    <span class="grow" />
    <button class="hk-link" data-action="page-hotkeys-edit" @click="gotoTable($event)">{{ t('ppz.page_hotkeys.edit') }}</button>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { mergeTwoHotkeys } from '@ipc/KeyToCode'
import { AppConfig } from '@/web/Config'
import { hotkeyTable } from './hotkey-table'
import { normalizeHotkey } from './hotkey-conflicts'
import { jumpToTab, settingsTab } from './tabState'

/** 熱鍵字串 → 鍵帽("Ctrl + Alt + D" → Ctrl / Alt / D) */
export function hotkeyKeys (hotkey: string): string[] {
  return hotkey.split(' + ').map(s => s.trim()).filter(Boolean)
}

export default defineComponent({
  props: {
    /** 熱鍵總表的列 id(hotkey-table.ts) */
    ids: { type: Array as PropType<string[]>, required: true }
  },
  setup (props) {
    const { t } = useI18n()
    const config = AppConfig()
    const rows = computed(() => {
      const all = hotkeyTable({ ...config, regexBookmarkHotkeys: [] }, { overlay: config.overlayMode }).flatMap(g => g.rows)
      return props.ids.flatMap(id => {
        const r = all.find(x => x.id === id)
        if (!r || r.kind !== 'edit') return []
        const hk = r.hold ? mergeTwoHotkeys(normalizeHotkey(config.hotkeyHold), normalizeHotkey(config.hotkey)) : (config[r.field] ?? '')
        return [{ id: r.id, label: r.label, keys: hotkeyKeys(hk) }]
      })
    })
    return {
      t,
      rows,
      gotoTable (e: Event) {
        const body = (e.currentTarget as HTMLElement | null)?.closest('.settings-body')
        jumpToTab(settingsTab.value, 'hotkeys', body?.scrollTop ?? 0)
        console.log(`[settings] ${settingsTab.value} → 熱鍵總表`)
      }
    }
  }
})
</script>

<style>
.settings-panel .page-hk {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5em 1.2em;
  padding: 0.55em 1em;
  border: 1px dashed var(--edge-1);
  border-radius: var(--radius-m);
  font-size: var(--fs-xs);
}
.settings-panel .page-hk-lbl {
  color: var(--ink-2);
}
.settings-panel .page-hk-item {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  color: var(--ink-1);
}
.settings-panel .page-hk .grow {
  flex: 1;
}
.settings-panel .page-hk .keys {
  display: inline-flex;
  gap: 0.25em;
}
/* 鍵帽(設定重整的招牌細節;熱鍵總表的輸入框也用同一種外觀) */
.settings-panel .keycap {
  font-family: ui-monospace, Consolas, monospace;
  font-size: var(--fs-2xs);
  line-height: 1.5;
  padding: 0 0.45em;
  border-radius: 4px;
  background: var(--surface-3);
  border: 1px solid var(--edge-2);
  border-bottom-width: 2px;
  color: var(--ink-0);
  white-space: nowrap;
}
.settings-panel .keycap.empty {
  font-family: inherit;
  color: var(--ink-3);
  background: none;
  border-style: dashed;
  border-bottom-width: 1px;
}
.settings-panel .hk-link {
  appearance: none;
  border: 0;
  background: none;
  padding: 0;
  color: var(--gold);
  font: inherit;
  cursor: pointer;
}
.settings-panel .hk-link:hover {
  text-decoration: underline;
}
.settings-panel .hk-link:focus-visible {
  outline: 1px solid var(--gold);
  outline-offset: 2px;
}
</style>
