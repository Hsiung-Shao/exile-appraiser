<!--
  設定 › 熱鍵與視窗:熱鍵用 HotkeyInput(按鍵擷取,Esc / Backspace 清除)。
  main 的 Shortcuts.updateActions 回傳 { ok, error }(Config.ts 的 hotkeyRegistration);
  error 形如 `hotkey "Ctrl + D", "Shift + Space" is already registered by another application`,
  依引號裡的熱鍵對回欄位,在該欄位下方以 --bad 顯示;對不回任何欄位的錯誤顯示在熱鍵卡片底部。
  遊戲保留鍵 / 與其他熱鍵重複也顯示在欄位下方(useHotkeyIssues,涵蓋全部熱鍵,含 PoE2 兩個區塊與聊天指令)。
  倉庫頁籤捲動(第 15 步,移植 APT hotkeys.vue 的 stashScroll):Ctrl + 滾輪 / 停用;只在 overlay 模式、遊戲在前景時有效(main/src/stash-scroll.ts)。
  PoE2 的兩張辨識卡片(褻瀆自動辨識、符文塑形自動查價)共用 OcrScanSection.vue(2026-10-01 使用者要求設定對等):
  啟用、狀態、掃描間隔(100–3000 ms)、區域 + 在遊戲上框選 / 清除、暫停 / 繼續熱鍵、框選區域熱鍵、最近耗時;
  各自保留專屬設定(褻瀆:OCR 語言包狀態;符文:台服提示、顏色門檻)。兩者的熱鍵已從上方通用熱鍵卡片移入各自區塊;
  褻瀆原本「進階:手動輸入比例」四個數字欄位已移除(舊設定檔的 ocrRegion 照常讀取)。
  第 11 步:兩張辨識卡片之後是共用的「徽章外觀」卡片(BadgeStyleSection.vue;字體 / 大小 / 粗體 / 符文三段色 / 外框陰影 + 即時預覽)。
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
      <span v-if="issueText('quick', quickHotkey)" class="err" data-issue="quick">{{ issueText('quick', quickHotkey) }}</span>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.hotkey_locked') }}</span>
      <div class="ctl">
        <hotkey-input v-model="config.hotkeyLocked" data-setting="hotkey-locked" />
      </div>
      <span v-if="issueText('locked', config.hotkeyLocked)" class="err" data-issue="locked">{{ issueText('locked', config.hotkeyLocked) }}</span>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.overlay_key') }}</span>
      <div class="ctl">
        <hotkey-input v-model="config.overlayKey" data-setting="overlay-key" />
      </div>
      <span v-if="issueText('overlay', config.overlayKey)" class="err" data-issue="overlay">{{ issueText('overlay', config.overlayKey) }}</span>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.stash_scroll') }}</span>
      <div class="ctl">
        <select v-model="config.stashScroll" class="select sm" data-setting="stash-scroll">
          <option :value="true">{{ t('ppz.stash_scroll_ctrl_wheel') }}</option>
          <option :value="false">{{ t('ppz.stash_scroll_off') }}</option>
        </select>
      </div>
    </div>
    <p class="foot" data-setting="stash-scroll-hint">{{ t('ppz.stash_scroll_hint') }}</p>
    <p v-if="config.game === 'poe2'" class="foot" data-setting="scan-hotkeys-moved">{{ t('ppz.scan.hotkeys_moved') }}</p>
    <p v-if="otherError" class="err-line">{{ t('ppz.hotkey_error', { error: otherError }) }}</p>
    <p class="foot">{{ t('ppz.hotkey_capture_hint') }}</p>
  </section>

  <!-- WP-S:靈魂之井褻瀆自動辨識(只有 PoE2) -->
  <ocr-scan-section v-if="config.game === 'poe2'" kind="reveal">
    <template #extra>
      <div class="srow">
        <span class="k">{{ t('ppz.ocr.status') }}</span>
        <div class="ctl">
          <span class="ocr-status" :class="ocrStatus.kind" data-setting="ocr-status">{{ ocrStatus.text }}</span>
          <button v-if="canCheck" class="btn ghost sm" data-action="ocr-check" :disabled="checking" @click="checkOcr">{{ t('ppz.ocr.check') }}</button>
        </div>
      </div>
      <p v-if="ocrStatus.kind === 'bad' && ocrAvail && !ocrAvail.ok && ocrAvail.error === 'lang-missing'" class="err-line" data-setting="ocr-lang-missing">{{ t(ocrWantsEn ? 'ppz.ocr.err_lang_missing_en' : 'ppz.ocr.err_lang_missing') }}</p>
      <div class="chk-row">
        <label class="chk"><input v-model="config.revealShowAllCandidates" type="checkbox" data-setting="reveal-show-all"><span>{{ t('ppz.ocr.show_all_candidates') }}</span></label>
      </div>
      <p class="foot">{{ t('ppz.ocr.show_all_candidates_hint') }}</p>
    </template>
    <template #foot>
      <p class="foot">{{ t('ppz.ocr.cpu_hint') }}</p>
      <p class="foot">{{ t('ppz.ocr.privacy') }}</p>
    </template>
  </ocr-scan-section>

  <!-- WP-R2:符文塑形面板自動查價(只有 PoE2) -->
  <ocr-scan-section v-if="config.game === 'poe2'" kind="runeshape">
    <template #top>
      <p v-if="config.realm === 'tw'" class="err-line warn" data-setting="runeshape-tw">{{ t('ppz.runeshape.tw_no_source') }}</p>
    </template>
    <template #extra>
      <div class="srow">
        <span class="k">{{ t('ppz.runeshape.thresholds') }}</span>
        <div class="ctl">
          <span class="dim">{{ t('ppz.runeshape.threshold_low') }}</span>
          <input v-model.lazy.number="thresholdDraft.low" class="input sm rs-num" type="number" min="0" step="0.1" data-setting="runeshape-threshold-low" @change="applyThresholds">
          <span class="dim">{{ t('ppz.runeshape.threshold_high') }}</span>
          <input v-model.lazy.number="thresholdDraft.high" class="input sm rs-num" type="number" min="0" step="0.5" data-setting="runeshape-threshold-high" @change="applyThresholds">
          <span class="dim">{{ t('ppz.runeshape.unit_ex') }}</span>
        </div>
      </div>
    </template>
    <template #foot>
      <p class="foot">{{ t('ppz.runeshape.cpu_hint') }}</p>
      <p class="foot">{{ t('ppz.runeshape.display_hint') }}</p>
    </template>
  </ocr-scan-section>

  <!-- 第 11 步:OCR 徽章外觀(符文與褻瀆共用;只有 PoE2) -->
  <badge-style-section v-if="config.game === 'poe2'" />

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
import { computed, defineComponent, onMounted, reactive, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OcrAvailability } from '@ipc/types'
import { AppConfig, hostConfigSettled, normRuneshapeThresholds } from '@/web/Config'
import { afterHostConfigApplied } from '@/web/host-config-sync'
import { ocrWantsEnglish } from '@/web/ocr-lang'
import { Host } from '@/web/background/IPC'
import { mergeTwoHotkeys } from '@ipc/KeyToCode'
import HotkeyInput from '../HotkeyInput.vue'
import OcrScanSection from '../OcrScanSection.vue'
import BadgeStyleSection from '../BadgeStyleSection.vue'
import { normalizeHotkey } from '../hotkey-conflicts'
import { useHotkeyIssues } from '../useHotkeyIssues'

export default defineComponent({
  components: { HotkeyInput, OcrScanSection, BadgeStyleSection },
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    const { issueText, otherError } = useHotkeyIssues()
    /** 快速查價 = 按住鍵 + 主鍵(main 以合併後的字串註冊,被佔用的錯誤也是這個字串) */
    const quickHotkey = computed(() => mergeTwoHotkeys(normalizeHotkey(config.hotkeyHold), normalizeHotkey(config.hotkey)))

    // ---- WP-S:OCR 語言包狀態(褻瀆卡片專屬) ----
    const ocrAvail = shallowRef<OcrAvailability | undefined | null>(null)
    const checking = shallowRef(false)
    const canCheck = Host.isElectron && !Host.isPreview
    async function checkOcr () {
      if (!canCheck) return
      checking.value = true
      try {
        ocrAvail.value = await Host.ocrRevealAvailable()
      } catch (e) {
        ocrAvail.value = { ok: false, error: 'spawn-failed', message: String(e) }
      } finally {
        checking.value = false
      }
    }
    onMounted(() => { if (config.game === 'poe2') void checkOcr() })
    // 第 22 步:OCR 語言包跟著客戶端語言(main 收到設定後換語言包)→ 設定送到 main 之後重新檢查
    watch(() => config.language, () => {
      if (config.game === 'poe2' && canCheck) void afterHostConfigApplied(hostConfigSettled, () => { void checkOcr() }, 0)
    })
    /** 缺的是英文語言包(main 回報想用的語言包;舊 main 沒回報 → 依目前的客戶端語言) */
    const ocrWantsEn = computed(() => ocrWantsEnglish(ocrAvail.value, config.language))
    const ocrStatus = computed(() => {
      if (!canCheck) return { kind: 'dim', text: t('ppz.ocr.status_preview') }
      const a = ocrAvail.value
      if (checking.value || a === null) return { kind: 'dim', text: t('ppz.ocr.status_checking') }
      if (a === undefined) return { kind: 'dim', text: t('ppz.ocr.status_preview') }
      if (a.ok) return { kind: 'good', text: t('ppz.ocr.status_ok', { lang: a.lang }) }
      if (a.error === 'lang-missing') return { kind: 'bad', text: t(ocrWantsEn.value ? 'ppz.ocr.status_missing_en' : 'ppz.ocr.status_missing', { langs: a.langs?.join(', ') || '—' }) }
      return { kind: 'bad', text: t('ppz.ocr.status_error', { error: a.message ?? a.error }) }
    })

    // ---- WP-R2:符文塑形顏色門檻(符文卡片專屬) ----
    const thresholdDraft = reactive({ low: config.runeshapeThresholds.low, high: config.runeshapeThresholds.high })
    watch(() => config.runeshapeThresholds, (v) => { thresholdDraft.low = v.low; thresholdDraft.high = v.high })
    function applyThresholds () {
      config.runeshapeThresholds = normRuneshapeThresholds({ low: Number(thresholdDraft.low), high: Number(thresholdDraft.high) })
      thresholdDraft.low = config.runeshapeThresholds.low
      thresholdDraft.high = config.runeshapeThresholds.high
    }

    return {
      t, config, issueText, otherError, quickHotkey,
      ocrAvail, ocrStatus, ocrWantsEn, checking, canCheck, checkOcr,
      thresholdDraft, applyThresholds
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
.settings-panel .ocr-status { font-size: var(--fs-sm); }
.settings-panel .ocr-status.good { color: var(--good, var(--ink-0)); }
.settings-panel .ocr-status.bad { color: var(--bad); }
.settings-panel .ocr-status.dim { color: var(--ink-2); }
/* WP-S2 */
.settings-panel .ocr-region-status { font-size: var(--fs-sm); color: var(--ink-0); font-variant-numeric: tabular-nums; }
.settings-panel .ocr-region-status.unset { color: var(--ink-2); }
.settings-panel .ocr-pick-na { color: var(--ink-2); }
/* WP-R2 */
.settings-panel .rs-num { flex: 0 0 5.5em !important; min-width: 0; }
</style>
