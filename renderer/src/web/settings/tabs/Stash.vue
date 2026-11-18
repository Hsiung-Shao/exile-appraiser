<!--
  設定 › 倉庫(2026-11-18 設定重整,方案 B):倉庫相關設定集中一頁 ——
  - PoE1 倉庫價格疊層(原「自動辨識」頁的倉庫卡片 + 共用 OCR 卡片 + 徽章外觀;門檻 `stashThresholds` 混沌石);
    顯示方式改成兩張並排、各附一句說明的選項卡(`stashTriggerMode`)。
  - 倉庫頁籤捲動、倉庫搜尋(原「倉庫與聊天」頁;移植 APT,MIT,見 Chat.vue 檔頭)。
  - 頁頂「這頁的熱鍵」唯讀列出倉庫價格的暫停 / 框選熱鍵(在熱鍵總表編輯);倉庫搜尋熱鍵與項目綁在一起,留在這裡編輯。
  三個功能都只在 overlay 模式 → 設定不是 overlay 時整頁只顯示 OverlayGate。設定鍵 / 行為不變。
-->
<template>
  <overlay-gate v-if="!config.overlayMode" />
  <template v-else>
    <page-hotkeys :ids="['stashToggle', 'stashRegion']" />

    <!-- PoE1 倉庫價格疊層(碎片頁) -->
    <ocr-scan-section v-if="config.game === 'poe1'" kind="stash">
      <template #top>
        <p v-if="config.realm === 'tw'" class="foot warn" data-setting="stash-tw">{{ t('ppz.stash.tw_no_source') }}</p>
        <!-- 2026-10-15 顯示方式:自動偵測 / 按熱鍵顯示(`stashTriggerMode`;熱鍵 = 熱鍵總表的倉庫價格) -->
        <div class="choice-cards" role="radiogroup" :aria-label="t('ppz.stash.trigger_mode')" data-setting="stash-trigger-mode">
          <label v-for="m in triggerModes" :key="m.id" class="choice-card" :class="{ on: m.on }" :data-value="m.id">
            <input type="radio" name="stash-trigger-mode" :checked="m.on" @change="config.stashTriggerMode = m.id">
            <span>
              <span class="choice-title">{{ m.title }}</span>
              <span class="choice-desc">{{ m.desc }}</span>
            </span>
          </label>
        </div>
      </template>
      <template #extra>
        <div class="chk-row">
          <label class="chk"><input v-model="config.stashShowNames" type="checkbox" data-setting="stash-show-names"><span>{{ t('ppz.stash.show_names') }}</span></label>
          <help-tip id="stash-show-names" :text="t('ppz.stash.show_names_hint')" />
        </div>
        <div class="chk-row">
          <label class="chk"><input v-model="config.stashReadQuantity" type="checkbox" data-setting="stash-read-quantity"><span>{{ t('ppz.stash.read_quantity') }}</span></label>
          <help-tip id="stash-read-quantity" :text="t('ppz.stash.read_quantity_hint')" />
        </div>
      </template>
    </ocr-scan-section>
    <ocr-shared-section v-if="config.game === 'poe1'" />
    <badge-style-section v-if="config.game === 'poe1'" />

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
          <hotkey-input v-model="s.hotkey" optional class="chat-hotkey" :data-setting="`stash-hotkey-${i}`" />
          <button class="btn ghost sm" :data-action="`stash-remove-${i}`" @click="config.stashSearch.splice(i, 1)">{{ t('ppz.chat.remove') }}</button>
        </div>
        <span v-if="issueText(`stash:${i}`, s.hotkey)" class="err" :data-issue="`stash:${i}`">{{ issueText(`stash:${i}`, s.hotkey) }}</span>
      </div>
      <div class="chat-add">
        <button class="btn sm" data-action="stash-add" :disabled="config.stashSearch.length >= max" @click="config.stashSearch.push({ text: '', hotkey: '' })">+ {{ t('ppz.chat.stash_add') }}</button>
      </div>
    </section>
  </template>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig, MAX_TEXT_ENTRIES } from '@/web/Config'
import HotkeyInput from '../HotkeyInput.vue'
import HelpTip from '../HelpTip.vue'
import OverlayGate from '../OverlayGate.vue'
import OcrScanSection from '../OcrScanSection.vue'
import OcrSharedSection from '../OcrSharedSection.vue'
import BadgeStyleSection from '../BadgeStyleSection.vue'
import PageHotkeys from '../PageHotkeys.vue'
import { useHotkeyIssues } from '../useHotkeyIssues'

export default defineComponent({
  components: { HotkeyInput, HelpTip, OverlayGate, OcrScanSection, OcrSharedSection, BadgeStyleSection, PageHotkeys },
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    const { issueText } = useHotkeyIssues()
    return {
      t,
      config,
      max: MAX_TEXT_ENTRIES,
      issueText,
      triggerModes: computed(() => [
        { id: 'auto' as const, on: config.stashTriggerMode !== 'hotkey', title: t('ppz.stash.trigger_auto'), desc: t('ppz.stash.trigger_auto_desc') },
        { id: 'hotkey' as const, on: config.stashTriggerMode === 'hotkey', title: t('ppz.stash.trigger_hotkey'), desc: t('ppz.stash.trigger_hotkey_desc') }
      ])
    }
  }
})
</script>

<style>
/* 兩張並排、各附一句說明的選項卡(設定重整;容器窄時直排) */
.settings-panel .choice-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14em, 1fr));
  gap: 0.6em;
  margin: 0.2em 0 0.6em;
}
.settings-panel .choice-card {
  display: flex;
  align-items: flex-start;
  gap: 0.7em;
  padding: 0.7em 0.9em;
  border-radius: var(--radius-m);
  background: var(--surface-2);
  border: 1px solid var(--edge-0);
  cursor: pointer;
}
.settings-panel .choice-card:hover {
  background: var(--surface-hover);
}
.settings-panel .choice-card.on {
  background: var(--surface-3);
  border-color: color-mix(in srgb, var(--gold) 55%, transparent);
}
.settings-panel .choice-card input {
  margin: 0.25em 0 0;
  accent-color: var(--gold);
}
.settings-panel .choice-card:has(input:focus-visible) {
  outline: 1px solid var(--gold);
  outline-offset: 1px;
}
.settings-panel .choice-title {
  display: block;
  color: var(--ink-0);
}
.settings-panel .choice-card:not(.on) .choice-title {
  color: var(--ink-1);
}
.settings-panel .choice-desc {
  display: block;
  font-size: var(--fs-2xs);
  color: var(--ink-2);
}
</style>
