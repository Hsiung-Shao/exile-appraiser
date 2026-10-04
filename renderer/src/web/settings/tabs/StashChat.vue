<!--
  設定 › 倉庫與聊天(第 39 步整理;原「聊天指令」分頁 2026-10-01 + 原「熱鍵與視窗」的倉庫頁籤捲動)。
  聊天指令移植自 Awakened PoE Trade `renderer/src/web/settings/chat.vue`(MIT,Copyright (c) 2020 Alexander Drozdov;
  `LICENSES/awakened-poe-trade.MIT`)。exile-appraiser 改動:
  - 版面改成 pobtools 的卡片 / 列;HotkeyInput 用本專案的(keydown 組字串、Esc / Backspace / Delete 清除)。
  - 倉庫搜尋(APT 的 stash-search widget 只取熱鍵部分):熱鍵 → Ctrl+F → 貼上 → Enter;Poe Regex 頁「加到倉庫搜尋」帶入。
  - 倉庫頁籤捲動(第 15 步,移植 APT hotkeys.vue 的 stashScroll):Ctrl + 滾輪 / 停用(main/src/stash-scroll.ts)。
  - 每列顯示熱鍵問題(遊戲保留鍵 / 與其他熱鍵重複 / 被其他程式佔用),規則同 main(`hotkey-conflicts.ts`);
    這些熱鍵與項目綁在一起,留在這一頁編輯,「熱鍵」總表唯讀列出並可跳來這裡。
  - 三個功能都只在 overlay 模式(main `shortcut-actions.ts` / `stash-scroll.ts`)→ 設定不是 overlay 時整頁只顯示一句說明 + 前往「遊戲」。
-->
<template>
  <overlay-gate v-if="!config.overlayMode" />
  <template v-else>
    <section class="card" data-setting="stash-search">
      <div class="card-head">
        <span class="label">{{ t('ppz.chat.stash_section') }}</span>
      </div>
      <p class="lead">{{ t('ppz.chat.stash_hint') }}</p>
      <p v-if="!config.stashSearch.length" class="foot" data-setting="stash-empty">{{ t('ppz.chat.stash_empty') }}</p>
      <div v-for="(s, i) in config.stashSearch" :key="`s${i}`" class="chat-row" :data-stash-row="i">
        <input v-model.trim="s.text" class="input sm chat-text num" maxlength="250" :placeholder="t('ppz.chat.stash_placeholder')" :data-setting="`stash-text-${i}`" spellcheck="false">
        <div class="chat-ctl">
          <span class="dim chat-len">{{ s.text.length }}/250</span>
          <hotkey-input v-model="s.hotkey" class="chat-hotkey" :data-setting="`stash-hotkey-${i}`" />
          <button class="btn ghost sm" :data-action="`stash-remove-${i}`" @click="config.stashSearch.splice(i, 1)">{{ t('ppz.chat.remove') }}</button>
        </div>
        <span v-if="issueText(`stash:${i}`, s.hotkey)" class="err" :data-issue="`stash:${i}`">{{ issueText(`stash:${i}`, s.hotkey) }}</span>
      </div>
      <div class="chat-add">
        <button class="btn sm" data-action="stash-add" :disabled="config.stashSearch.length >= max" @click="config.stashSearch.push({ text: '', hotkey: '' })">+ {{ t('ppz.chat.stash_add') }}</button>
      </div>
    </section>

    <section class="card" data-setting="stash-scroll-section">
      <div class="card-head">
        <span class="label">{{ t('ppz.stash_scroll') }}</span>
        <help-tip id="stash-scroll" data-setting="stash-scroll-hint" :text="t('ppz.stash_scroll_hint')" />
      </div>
      <div class="srow">
        <span class="k">{{ t('ppz.stash_scroll_k') }}</span>
        <div class="ctl">
          <select v-model="config.stashScroll" class="select sm" data-setting="stash-scroll">
            <option :value="true">{{ t('ppz.stash_scroll_ctrl_wheel') }}</option>
            <option :value="false">{{ t('ppz.stash_scroll_off') }}</option>
          </select>
        </div>
        <span class="note">{{ t('ppz.stash_scroll_note') }}</span>
      </div>
    </section>

    <section class="card" data-setting="chat-commands">
      <div class="card-head">
        <span class="label">{{ t('ppz.chat.section') }}</span>
        <help-tip id="chat-commands">
          <span class="help-p">{{ t('ppz.chat.help') }}</span>
          <span class="help-p">{{ t('ppz.chat.last_hint') }}</span>
        </help-tip>
      </div>
      <p class="lead">{{ t('ppz.chat.hint') }}</p>
      <div v-for="(c, i) in config.commands" :key="`c${i}`" class="chat-row" :data-chat-row="i">
        <input v-model.trim="c.text" class="input sm chat-text" :placeholder="t('ppz.chat.text_placeholder')" :data-setting="`chat-text-${i}`" spellcheck="false">
        <div class="chat-ctl">
          <label class="chk"><input v-model="c.send" type="checkbox" :data-setting="`chat-send-${i}`"><span>{{ t('ppz.chat.send') }}</span></label>
          <hotkey-input v-model="c.hotkey" class="chat-hotkey" :data-setting="`chat-hotkey-${i}`" />
          <button class="btn ghost sm" :data-action="`chat-remove-${i}`" @click="config.commands.splice(i, 1)">{{ t('ppz.chat.remove') }}</button>
        </div>
        <span v-if="issueText(`cmd:${i}`, c.hotkey)" class="err" :data-issue="`cmd:${i}`">{{ issueText(`cmd:${i}`, c.hotkey) }}</span>
      </div>
      <div class="chat-add">
        <button class="btn sm" data-action="chat-add" :disabled="config.commands.length >= max" @click="addCommand">+ {{ t('ppz.chat.add') }}</button>
        <button class="btn ghost sm" data-action="chat-reset" @click="resetCommands">{{ t('ppz.chat.reset') }}</button>
      </div>
    </section>
  </template>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig, MAX_TEXT_ENTRIES, defaultCommands } from '@/web/Config'
import HotkeyInput from '../HotkeyInput.vue'
import HelpTip from '../HelpTip.vue'
import OverlayGate from '../OverlayGate.vue'
import { useHotkeyIssues } from '../useHotkeyIssues'

export default defineComponent({
  components: { HotkeyInput, HelpTip, OverlayGate },
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    // 衝突 / 保留鍵 / 被佔用:與熱鍵總表同一套(2026-10-01 抽成 useHotkeyIssues)
    const { issueText } = useHotkeyIssues()
    return {
      t,
      config,
      max: MAX_TEXT_ENTRIES,
      issueText,
      addCommand () {
        config.commands.push({ text: '', hotkey: '', send: true })
      },
      resetCommands () {
        config.commands = defaultCommands()
      }
    }
  }
})
</script>

<style>
.settings-panel .chat-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
  border-bottom: 1px solid var(--edge-0);
}
.settings-panel .chat-row:last-of-type {
  border-bottom: 0;
}
.settings-panel .chat-text {
  width: 100%;
  min-width: 0;
}
.settings-panel .chat-ctl {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.settings-panel .chat-ctl .chk {
  margin-right: auto;
}
.settings-panel .chat-hotkey {
  width: 11em;
}
.settings-panel .chat-len {
  margin-right: auto;
  font-size: var(--fs-2xs);
}
.settings-panel .chat-add {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.settings-panel .chat-row .err {
  font-size: var(--fs-xs);
  color: var(--bad);
}
</style>
