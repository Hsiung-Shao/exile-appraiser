<!--
  設定 › 聊天指令(2026-10-01)。移植自 Awakened PoE Trade `renderer/src/web/settings/chat.vue`(MIT,Copyright (c) 2020 Alexander Drozdov;
  `LICENSES/awakened-poe-trade.MIT`)。exile-appraiser 改動:
  - 版面改成 pobtools 的卡片 / 列;HotkeyInput 用本專案的(keydown 組字串、Esc / Backspace / Delete 清除)。
  - 同一頁加「倉庫搜尋」一區(APT 的 stash-search widget 只取熱鍵部分):熱鍵 → Ctrl+F → 貼上 → Enter。
  - 每列顯示熱鍵問題(遊戲保留鍵 / 與其他熱鍵重複 / 被其他程式佔用),規則同 main(`hotkey-conflicts.ts`)。
  - 熱鍵只在 overlay 模式、遊戲在前景時註冊(main `shortcut-actions.ts`);按下時會對遊戲送出按鍵(`main/src/text-box.ts`)。
-->
<template>
  <section class="card" data-setting="chat-commands">
    <span class="label">{{ t('ppz.chat.section') }}</span>
    <p class="hint">{{ t('ppz.chat.hint') }}</p>
    <p v-if="!isOverlay" class="err-line warn" data-setting="chat-overlay-only">{{ t('ppz.chat.overlay_only') }}</p>
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
    <p class="foot">{{ t('ppz.chat.last_hint') }}</p>
  </section>

  <section class="card" data-setting="stash-search">
    <span class="label">{{ t('ppz.chat.stash_section') }}</span>
    <p class="hint">{{ t('ppz.chat.stash_hint') }}</p>
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
    <p class="foot">{{ t('ppz.chat.stash_regex_hint') }}</p>
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig, MAX_TEXT_ENTRIES, defaultCommands } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import HotkeyInput from '../HotkeyInput.vue'
import { useHotkeyIssues } from '../useHotkeyIssues'

export default defineComponent({
  components: { HotkeyInput },
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    // 衝突 / 保留鍵 / 被佔用:與熱鍵與視窗分頁同一套(2026-10-01 抽成 useHotkeyIssues)
    const { issueText } = useHotkeyIssues()
    return {
      t,
      config,
      max: MAX_TEXT_ENTRIES,
      isOverlay: Host.isOverlay || !Host.isElectron || Host.isPreview,
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
