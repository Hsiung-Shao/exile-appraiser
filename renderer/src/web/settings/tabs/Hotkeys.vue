<!--
  設定 › 熱鍵(第 39 步:熱鍵總表;原「熱鍵與視窗」分頁的視窗設定搬到「遊戲」、辨識卡片搬到「自動辨識」)。
  - 列由 ../hotkey-table.ts `hotkeyTable()` 產生,依功能分組(查價 / 設定選單 / 自動辨識 / 倉庫與聊天 / 正則),順序 = main 註冊順序。
  - `edit` 列直接在這裡編輯(HotkeyInput,按鍵擷取,Esc / Backspace 清除;快速查價 = 按住鍵 + 主鍵);
    `ref` 列(聊天指令、倉庫搜尋、個別正則書籤:熱鍵與項目綁在一起)唯讀,點「到 … 編輯」跳到該頁。
  - 衝突 / 遊戲保留鍵 / 被其他程式佔用 / 褻瀆與符文暫停鍵共用:useHotkeyIssues(與 main 註冊規則相同,涵蓋全部熱鍵),即時顯示在該列下方;
    main 回報對不回任何欄位的錯誤顯示在頁底。
  - 只在 overlay 模式註冊的組(設定選單、自動辨識、倉庫與聊天、正則)在設定不是 overlay 時不列,改顯示一句說明。
  - 自動辨識的暫停 / 繼續熱鍵只在該功能開著時註冊 → 功能關著時列下方標「功能關閉中」。
-->
<template>
  <section class="card hk-table" data-setting="hotkey-table">
    <div class="card-head">
      <span class="label">{{ t('ppz.section_hotkeys') }}</span>
    </div>
    <p class="lead">{{ t('ppz.hotkey_capture_hint') }}</p>
    <div v-for="g in groups" :key="g.id" class="hk-group" :data-hk-group="g.id">
      <div class="hk-group-head">
        <span class="sublabel">{{ t(g.title) }}</span>
        <help-tip v-if="g.id === 'scan'" id="hk-scan" :text="t('ppz.hk.scan_note')" />
        <span class="grow" />
        <button v-if="g.tab" class="btn ghost sm hk-goto" :data-goto="g.tab" @click="goto(g.tab)">{{ t('ppz.hk.edit_in', { page: tabName(g.tab) }) }}</button>
      </div>
      <p v-if="!g.rows.length" class="foot" :data-hk-empty="g.id">{{ t(g.id === 'stash-chat' ? 'ppz.hk.empty_stash_chat' : 'ppz.hk.empty') }}</p>
      <div v-for="r in g.rows" :key="r.id" class="srow" :class="{ ref: r.kind === 'ref' }" :data-hk-row="r.id">
        <template v-if="r.kind === 'edit'">
          <span class="k">{{ t(r.label) }}<template v-if="r.id === 'regexQuick'"> <help-tip id="hk-regex-quick" :text="t('ppz.regex.quick_hotkey_hint')" /></template></span>
          <div class="ctl">
            <template v-if="r.hold">
              <select v-model="config.hotkeyHold" class="select sm hold-select" data-setting="hotkey-hold" :title="t('ppz.hotkey_hold')" :aria-label="t('ppz.hotkey_hold')">
                <option value="Ctrl">Ctrl</option>
                <option value="Alt">Alt</option>
              </select>
              <span class="dim">+</span>
              <hotkey-input v-model="config.hotkey" no-mod-keys data-setting="hotkey" />
            </template>
            <hotkey-input v-else v-model="config[r.field]" :data-setting="FIELD_DS[r.field]" />
          </div>
          <span v-if="issueText(r.id, rowHotkey(r))" class="err" :data-issue="r.id">{{ issueText(r.id, rowHotkey(r)) }}</span>
          <span v-else-if="sharedText(r.id)" class="note" :data-shared="r.id">{{ sharedText(r.id) }}</span>
          <span v-else-if="r.needs && !config[r.needs] && rowHotkey(r)" class="note" :data-hk-off="r.id">{{ t('ppz.hk.off_note') }}</span>
        </template>
        <template v-else>
          <span class="k hk-ref-k">{{ t(r.label) }}</span>
          <div class="ctl">
            <button class="hk-ref" :data-goto="r.tab" :title="r.text" @click="goto(r.tab)">
              <span class="hk-ref-text">{{ r.text }}</span>
              <span class="hk-ref-key num" :class="{ unset: !r.hotkey }">{{ r.hotkey || t('ppz.hk.unset') }}</span>
            </button>
          </div>
          <span v-if="r.hotkey && issueText(r.id, r.hotkey)" class="err" :data-issue="r.id">{{ issueText(r.id, r.hotkey) }}</span>
        </template>
      </div>
    </div>
    <p v-if="!config.overlayMode" class="foot" data-setting="hk-window-only">{{ t('ppz.hk.window_only') }}</p>
    <p v-if="otherError" class="err-line">{{ t('ppz.hotkey_error', { error: otherError }) }}</p>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SettingsTabId } from '@ipc/types'
import { AppConfig } from '@/web/Config'
import { mergeTwoHotkeys } from '@ipc/KeyToCode'
import HotkeyInput from '../HotkeyInput.vue'
import HelpTip from '../HelpTip.vue'
import { normalizeHotkey } from '../hotkey-conflicts'
import { hotkeyTable, type HotkeyField, type HotkeyRow } from '../hotkey-table'
import { useHotkeyIssues } from '../useHotkeyIssues'
import { regexBookmarkHotkeyList } from '@/web/regex/bookmark-hotkeys'
import { SETTINGS_TABS } from '../settings-tabs'
import { settingsTab } from '../tabState'

/** 熱鍵欄位的 data-setting(沿用改版前各卡片的名稱,驗證腳本與文件照舊可用) */
const FIELD_DS: Record<HotkeyField, string> = {
  hotkey: 'hotkey',
  hotkeyLocked: 'hotkey-locked',
  overlayKey: 'overlay-key',
  hotkeyOcrReveal: 'hotkey-ocr-reveal',
  hotkeyOcrRegion: 'hotkey-ocr-region',
  hotkeyRuneshapeToggle: 'hotkey-runeshape-toggle',
  hotkeyRuneshapeRegion: 'hotkey-runeshape-region',
  hotkeyRegexQuick: 'hotkey-regex-quick'
}

export default defineComponent({
  components: { HotkeyInput, HelpTip },
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    const { issueText, sharedText, otherError } = useHotkeyIssues()
    const groups = computed(() => hotkeyTable({ ...config, regexBookmarkHotkeys: regexBookmarkHotkeyList.value }, { overlay: config.overlayMode }))
    /** 該列目前的熱鍵(快速查價 = 按住鍵 + 主鍵,main 以合併後的字串註冊,被佔用的錯誤也是這個字串) */
    function rowHotkey (r: HotkeyRow): string {
      if (r.kind === 'ref') return r.hotkey
      if (r.hold) return mergeTwoHotkeys(normalizeHotkey(config.hotkeyHold), normalizeHotkey(config.hotkey))
      return config[r.field] ?? ''
    }
    return {
      t,
      config,
      groups,
      FIELD_DS,
      rowHotkey,
      issueText,
      sharedText,
      otherError,
      tabName (id: SettingsTabId) {
        const def = SETTINGS_TABS.find(x => x.id === id)
        return def ? t(def.key) : id
      },
      goto (id: SettingsTabId) {
        settingsTab.value = id
        console.log(`[settings] 熱鍵總表 → ${id}`)
      }
    }
  }
})
</script>

<style>
.settings-panel .hold-select {
  flex: 0 0 72px !important;
}
.settings-panel .err-line {
  margin: 6px 0 0;
  font-size: var(--fs-xs);
  color: var(--bad);
}
.settings-panel .err-line.ok { color: var(--good, var(--ink-1)); }
.settings-panel .err-line.warn { color: var(--warn); }
.settings-panel .hk-group + .hk-group {
  margin-top: 0.5em;
  padding-top: 0.35em;
  border-top: 1px solid var(--edge-0);
}
.settings-panel .hk-group-head {
  display: flex;
  align-items: center;
  gap: 0.5em;
  min-height: 2em;
}
.settings-panel .hk-group-head .sublabel {
  margin: 0;
}
.settings-panel .hk-group-head .grow {
  flex: 1;
}
.settings-panel .hk-ref {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.75em;
  max-width: 100%;
  min-width: 0;
  padding: 0.2em 0.6em;
  border: 1px dashed var(--edge-1);
  border-radius: var(--radius-s);
  background: none;
  color: var(--ink-1);
  font-size: var(--fs-xs);
  text-align: left;
  cursor: pointer;
}
.settings-panel .hk-ref:hover {
  border-color: var(--gold);
  color: var(--ink-0);
}
.settings-panel .hk-ref:focus-visible {
  outline: 1px solid var(--gold);
  outline-offset: 1px;
}
.settings-panel .hk-ref-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-panel .hk-ref-key {
  flex: 0 0 auto;
  color: var(--ink-0);
  font-size: var(--fs-sm);
}
.settings-panel .hk-ref-key.unset {
  color: var(--ink-3);
  font-size: var(--fs-xs);
}
</style>
