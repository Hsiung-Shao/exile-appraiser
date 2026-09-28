<!--
  設定 › 熱鍵與視窗:熱鍵用 HotkeyInput(按鍵擷取,Esc / Backspace 清除)。
  main 的 Shortcuts.updateActions 回傳 { ok, error }(Config.ts 的 hotkeyRegistration);
  error 形如 `hotkey "Ctrl + D", "Shift + Space" is already registered by another application`,
  依引號裡的熱鍵對回欄位,在該欄位下方以 --bad 顯示;對不回任何欄位的錯誤顯示在卡片底部。
-->
<template>
  <section class="card">
    <span class="label">{{ t('ppz.section_hotkeys') }}</span>
    <div class="srow">
      <span class="k">{{ t('ppz.hotkey') }}</span>
      <div class="ctl">
        <select v-model="config.hotkeyHold" class="select sm hold-select" data-setting="hotkey-hold" :title="t('ppz.hotkey_hold')">
          <option value="Ctrl">Ctrl</option>
          <option value="Alt">Alt</option>
        </select>
        <span class="dim">+</span>
        <hotkey-input v-model="config.hotkey" no-mod-keys data-setting="hotkey" />
      </div>
      <span v-if="failed.quick" class="err">{{ t('ppz.hotkey_conflict', { key: failed.quick }) }}</span>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.hotkey_locked') }}</span>
      <div class="ctl">
        <hotkey-input v-model="config.hotkeyLocked" data-setting="hotkey-locked" />
      </div>
      <span v-if="failed.locked" class="err">{{ t('ppz.hotkey_conflict', { key: failed.locked }) }}</span>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.overlay_key') }}</span>
      <div class="ctl">
        <hotkey-input v-model="config.overlayKey" data-setting="overlay-key" />
      </div>
      <span v-if="failed.overlay" class="err">{{ t('ppz.hotkey_conflict', { key: failed.overlay }) }}</span>
    </div>
    <p v-if="failed.other" class="err-line">{{ t('ppz.hotkey_error', { error: failed.other }) }}</p>
    <p class="foot">{{ t('ppz.hotkey_capture_hint') }}</p>
  </section>

  <section class="card">
    <span class="label">{{ t('ppz.section_window') }}</span>
    <div class="srow">
      <span class="k">{{ t('ppz.window_title_poe1') }}</span>
      <div class="ctl">
        <input v-model.lazy.trim="config.windowTitleBy.poe1" class="input sm" placeholder="Path of Exile" data-setting="window-title-poe1">
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.window_title_poe2') }}</span>
      <div class="ctl">
        <input v-model.lazy.trim="config.windowTitleBy.poe2" class="input sm" placeholder="Path of Exile 2" data-setting="window-title-poe2">
      </div>
    </div>
    <div class="chk-row">
      <label class="chk"><input v-model="config.autoSwitchGame" type="checkbox"><span>{{ t('ppz.auto_switch_game') }}</span></label>
    </div>
    <div class="chk-row">
      <label class="chk"><input v-model="config.overlayMode" type="checkbox"><span>{{ t('ppz.overlay_mode') }}</span></label>
    </div>
    <div class="chk-row">
      <label class="chk"><input v-model="config.overlayBackgroundClose" type="checkbox"><span>{{ t('ppz.background_close') }}</span></label>
    </div>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig, hotkeyRegistration } from '@/web/Config'
import { hotkeyToString, mergeTwoHotkeys } from '@ipc/KeyToCode'
import HotkeyInput from '../HotkeyInput.vue'

/** 同 main/src/Shortcuts.ts 的 normalizeHotkey(`Ctrl+D` / `ctrl + d` → `Ctrl + D`),用來把錯誤對回欄位。 */
function normalizeHotkey (hotkey: string): string {
  const keys = hotkey.split('+').map(s => s.trim()).filter(Boolean)
    .map(k => {
      const lower = k.toLowerCase()
      if (lower === 'ctrl' || lower === 'control') return 'Ctrl'
      if (lower === 'alt') return 'Alt'
      if (lower === 'shift') return 'Shift'
      return k.length === 1 ? k.toUpperCase() : k
    })
  return hotkeyToString(keys)
}

export default defineComponent({
  components: { HotkeyInput },
  setup () {
    const { t } = useI18n()
    const config = AppConfig()

    const failed = computed(() => {
      const res = { quick: '', locked: '', overlay: '', other: '' }
      const reg = hotkeyRegistration.value
      if (!reg || reg.ok || !reg.error) return res
      const keys = [...reg.error.matchAll(/"([^"]+)"/g)].map(m => m[1])
      const quick = mergeTwoHotkeys(normalizeHotkey(config.hotkeyHold), normalizeHotkey(config.hotkey))
      const locked = normalizeHotkey(config.hotkeyLocked)
      const overlay = normalizeHotkey(config.overlayKey)
      let matched = 0
      for (const k of keys) {
        if (k === quick) { res.quick = k; matched++ } else if (k === locked) { res.locked = k; matched++ } else if (k === overlay) { res.overlay = k; matched++ }
      }
      if (matched === 0) res.other = reg.error
      return res
    })

    return { t, config, failed }
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
</style>
