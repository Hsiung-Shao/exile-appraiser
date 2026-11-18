<!--
  設定 › 聊天指令(2026-11-18 設定重整:原「倉庫與聊天」拆成「倉庫」(Stash.vue:倉庫搜尋 / 頁籤捲動 / 倉庫價格)與本頁)。
  聊天指令移植自 Awakened PoE Trade `renderer/src/web/settings/chat.vue`(MIT,Copyright (c) 2020 Alexander Drozdov;
  `LICENSES/awakened-poe-trade.MIT`)。exile-appraiser 改動:
  - 版面改成 pobtools 的卡片 / 列;HotkeyInput 用本專案的(keydown 組字串、Esc / Backspace / Delete 清除)。
  - 每列顯示熱鍵問題(遊戲保留鍵 / 與其他熱鍵重複 / 被其他程式佔用),規則同 main(`hotkey-conflicts.ts`);
    聊天指令熱鍵只在這一頁編輯(2026-10-14 使用者裁定,熱鍵總表不列,衝突檢查仍涵蓋)。
  - 只在 overlay 模式(main `shortcut-actions.ts`)→ 設定不是 overlay 時整頁只顯示一句說明 + 前往「遊戲」。
  - `.chat-row` 等列樣式也給倉庫頁的倉庫搜尋用(unscoped)。
-->
<template>
  <overlay-gate v-if="!config.overlayMode" />
  <template v-else>
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
          <hotkey-input v-model="c.hotkey" optional class="chat-hotkey" :data-setting="`chat-hotkey-${i}`" />
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
