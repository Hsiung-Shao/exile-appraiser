<!--
  設定 › 熱鍵與視窗:熱鍵用 HotkeyInput(按鍵擷取,Esc / Backspace 清除)。
  main 的 Shortcuts.updateActions 回傳 { ok, error }(Config.ts 的 hotkeyRegistration);
  error 形如 `hotkey "Ctrl + D", "Shift + Space" is already registered by another application`,
  依引號裡的熱鍵對回欄位,在該欄位下方以 --bad 顯示;對不回任何欄位的錯誤顯示在卡片底部。
  WP-S:PoE2 時多一個「靈魂之井揭露 OCR」熱鍵與一張卡片(語言包狀態、進階搜尋範圍 ocrRegion、隱私說明)。
  2026-10-01:卡片改為「褻瀆自動辨識」:開關 revealAutoEnabled(預設開)、掃描間隔 revealIntervalMs、狀態(main `reveal-stats`:
  找到 / 尋找中 / 區域內沒找到改找整個畫面 / 暫停);原本的 OCR 熱鍵改為「暫停 / 繼續」。
  WP-S2:辨識區域改成狀態文字 + 「在遊戲上框選」(關設定面板、開 overlay 框選層 OcrRegionPicker.vue)+「清除」;
  四個數字欄位收進 <details>「進階」。瀏覽器預覽與 window 模式沒有 overlay → 不顯示框選鈕、改顯示說明。
  另有選用的框選熱鍵 hotkeyOcrRegion(預設空 = 不註冊)。
  WP-R2:PoE2 時另一張「符文塑形自動查價」卡片:開關(預設關)、面板區域(同一個框選層,target = runeshape)、
  掃描間隔 500–3000 ms、顏色門檻(崇高石)、暫停 / 繼續熱鍵(預設空)、最近耗時(renderer 收到的最後一次事件 + main `runeshape-stats` 平均)。
  WP-R2 §2:面板區域可不框 —— 未框選時 main 自動定位;狀態列(`runeshape-stats` 的 mode / panel / autoRegion)顯示
  「自動定位:已找到 / 尋找中」或手動區域「區域內沒找到面板」(手動區域不會自動改掃整個畫面)。
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
    <div v-if="config.game === 'poe2'" class="srow">
      <span class="k">{{ t('ppz.ocr.hotkey') }}</span>
      <div class="ctl">
        <hotkey-input v-model="config.hotkeyOcrReveal" data-setting="hotkey-ocr-reveal" />
      </div>
      <span v-if="failed.ocr" class="err">{{ t('ppz.hotkey_conflict', { key: failed.ocr }) }}</span>
    </div>
    <div v-if="config.game === 'poe2'" class="srow">
      <span class="k">{{ t('ppz.ocr.region.hotkey') }}</span>
      <div class="ctl">
        <hotkey-input v-model="config.hotkeyOcrRegion" data-setting="hotkey-ocr-region" />
      </div>
      <span v-if="failed.region" class="err">{{ t('ppz.hotkey_conflict', { key: failed.region }) }}</span>
    </div>
    <p v-if="failed.other" class="err-line">{{ t('ppz.hotkey_error', { error: failed.other }) }}</p>
    <p class="foot">{{ t('ppz.hotkey_capture_hint') }}</p>
  </section>

  <!-- WP-S:靈魂之井揭露面板 OCR(只有 PoE2) -->
  <section v-if="config.game === 'poe2'" class="card" data-setting="ocr-section">
    <span class="label">{{ t('ppz.ocr.section') }}</span>
    <p class="hint">{{ t('ppz.ocr.hint', { hotkey: config.hotkeyOcrReveal || '—' }) }}</p>
    <div class="chk-row">
      <label class="chk"><input v-model="config.revealAutoEnabled" type="checkbox" data-setting="reveal-auto-enabled"><span>{{ t('ppz.ocr.auto_enabled') }}</span></label>
    </div>
    <p v-if="config.revealAutoEnabled && revealStatus" class="err-line" :class="revealStatus.warn ? 'warn' : 'ok'"
      data-setting="reveal-scan-status" :data-status="revealStatus.code">{{ revealStatus.text }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.ocr.interval') }}</span>
      <div class="ctl">
        <input v-model.lazy.number="revealIntervalDraft" class="input sm rs-num" type="number" min="500" max="3000" step="100" data-setting="reveal-interval" @change="applyRevealInterval">
        <span class="dim">ms</span>
        <button v-if="canCheck" class="btn ghost sm" data-action="reveal-stats" @click="refreshRevealStats">{{ t('ppz.runeshape.refresh') }}</button>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.ocr.status') }}</span>
      <div class="ctl">
        <span class="ocr-status" :class="ocrStatus.kind" data-setting="ocr-status">{{ ocrStatus.text }}</span>
        <button v-if="canCheck" class="btn ghost sm" data-action="ocr-check" :disabled="checking" @click="checkOcr">{{ t('ppz.ocr.check') }}</button>
      </div>
    </div>
    <p v-if="ocrStatus.kind === 'bad' && ocrAvail && !ocrAvail.ok && ocrAvail.error === 'lang-missing'" class="err-line">{{ t('ppz.ocr.err_lang_missing') }}</p>
    <!-- WP-S2:辨識區域 = 狀態 + 「在遊戲上框選」「清除」;四個數字欄位收進「進階」摺疊 -->
    <div class="srow">
      <span class="k">{{ t('ppz.ocr.region.title') }}</span>
      <div class="ctl">
        <span class="ocr-region-status" :class="{ unset: !config.ocrRegion }" data-setting="ocr-region-status">{{ regionStatus }}</span>
      </div>
    </div>
    <div class="srow">
      <span class="k" />
      <div class="ctl">
        <button v-if="canPick" class="btn sm primary" data-action="ocr-region-pick" @click="pickRegion">{{ t('ppz.ocr.region.pick') }}</button>
        <button class="btn sm" data-action="ocr-region-clear" :disabled="!config.ocrRegion" @click="clearRegion">{{ t('ppz.ocr.region.clear') }}</button>
      </div>
    </div>
    <p v-if="!canPick" class="foot ocr-pick-na" data-setting="ocr-region-pick-unavailable">{{ pickUnavailable }}</p>
    <p class="foot">{{ t('ppz.ocr.region.hint') }}</p>
    <details class="ocr-advanced" data-setting="ocr-region-advanced">
      <summary>{{ t('ppz.ocr.region.advanced') }}</summary>
      <div class="srow">
        <span class="k">{{ t('ppz.ocr.region.numbers') }}</span>
        <div class="ctl ocr-region">
          <input v-for="k in regionKeys" :key="k" v-model.lazy="regionDraft[k]" class="input sm" inputmode="decimal"
            :placeholder="t(`ppz.ocr.region.${k}`)" :title="t(`ppz.ocr.region.${k}`)" :data-setting="`ocr-region-${k}`" @change="applyRegion">
        </div>
        <span v-if="regionError" class="err">{{ t('ppz.ocr.region.invalid') }}</span>
      </div>
      <p class="foot">{{ t('ppz.ocr.region.advanced_hint') }}</p>
    </details>
    <p class="foot">{{ t('ppz.ocr.cpu_hint') }}</p>
    <p class="foot">{{ t('ppz.ocr.privacy') }}</p>
  </section>

  <!-- WP-R2:符文塑形面板自動查價(只有 PoE2) -->
  <section v-if="config.game === 'poe2'" class="card" data-setting="runeshape-section">
    <span class="label">{{ t('ppz.runeshape.section') }}</span>
    <p class="hint">{{ t('ppz.runeshape.hint') }}</p>
    <div class="chk-row">
      <label class="chk"><input v-model="config.runeshapeEnabled" type="checkbox" data-setting="runeshape-enabled"><span>{{ t('ppz.runeshape.enabled') }}</span></label>
    </div>
    <p v-if="config.realm === 'tw'" class="err-line warn" data-setting="runeshape-tw">{{ t('ppz.runeshape.tw_no_source') }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.runeshape.region') }}</span>
      <div class="ctl">
        <span class="ocr-region-status" :class="{ unset: !config.runeshapeRegion }" data-setting="runeshape-region-status">{{ runeshapeRegionStatus }}</span>
      </div>
    </div>
    <div class="srow">
      <span class="k" />
      <div class="ctl">
        <button v-if="canPick" class="btn sm primary" data-action="runeshape-region-pick" @click="pickRuneshapeRegion">{{ t('ppz.ocr.region.pick') }}</button>
        <button class="btn sm" data-action="runeshape-region-clear" :disabled="!config.runeshapeRegion" @click="config.runeshapeRegion = null">{{ t('ppz.ocr.region.clear') }}</button>
      </div>
    </div>
    <p v-if="!canPick" class="foot ocr-pick-na" data-setting="runeshape-region-pick-unavailable">{{ pickUnavailable }}</p>
    <p class="foot" data-setting="runeshape-region-hint">{{ t('ppz.runeshape.region_hint') }}</p>
    <p v-if="config.runeshapeEnabled && panelStatus" class="err-line" :class="panelStatus.warn ? 'warn' : 'ok'"
      data-setting="runeshape-panel-status" :data-status="panelStatus.code">{{ panelStatus.text }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.runeshape.interval') }}</span>
      <div class="ctl">
        <input v-model.lazy.number="intervalDraft" class="input sm rs-num" type="number" min="500" max="3000" step="100" data-setting="runeshape-interval" @change="applyInterval">
        <span class="dim">ms</span>
      </div>
    </div>
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
    <div class="srow">
      <span class="k">{{ t('ppz.runeshape.hotkey') }}</span>
      <div class="ctl">
        <hotkey-input v-model="config.hotkeyRuneshapeToggle" data-setting="hotkey-runeshape-toggle" />
      </div>
      <span v-if="failed.runeshape" class="err">{{ t('ppz.hotkey_conflict', { key: failed.runeshape }) }}</span>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.runeshape.timing') }}</span>
      <div class="ctl">
        <span class="ocr-status dim" data-setting="runeshape-timing">{{ timingText }}</span>
        <button v-if="canCheck" class="btn ghost sm" data-action="runeshape-stats" @click="refreshStats">{{ t('ppz.runeshape.refresh') }}</button>
      </div>
    </div>
    <p class="foot">{{ t('ppz.runeshape.cpu_hint') }}</p>
    <p class="foot">{{ t('ppz.runeshape.display_hint') }}</p>
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
import { computed, defineComponent, onMounted, reactive, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OcrAvailability, RuneshapeStats } from '@ipc/types'
import { AppConfig, clampRuneshapeInterval, hotkeyRegistration, normOcrRegion, normRuneshapeThresholds } from '@/web/Config'
import { runeshapeLastTimings } from '@/web/overlay/runeshape-view'
import { Host } from '@/web/background/IPC'
import { hotkeyToString, mergeTwoHotkeys } from '@ipc/KeyToCode'
import HotkeyInput from '../HotkeyInput.vue'
import { openRegionPicker, revealScanStatus } from '@/web/overlay/ocr-reveal'
import { regionPercent } from '@/web/overlay/region-geom'

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
      const res = { quick: '', locked: '', overlay: '', ocr: '', region: '', runeshape: '', other: '' }
      const reg = hotkeyRegistration.value
      if (!reg || reg.ok || !reg.error) return res
      const keys = [...reg.error.matchAll(/"([^"]+)"/g)].map(m => m[1])
      const quick = mergeTwoHotkeys(normalizeHotkey(config.hotkeyHold), normalizeHotkey(config.hotkey))
      const locked = normalizeHotkey(config.hotkeyLocked)
      const overlay = normalizeHotkey(config.overlayKey)
      const ocr = normalizeHotkey(config.hotkeyOcrReveal)
      const region = normalizeHotkey(config.hotkeyOcrRegion)
      const runeshape = normalizeHotkey(config.hotkeyRuneshapeToggle)
      let matched = 0
      for (const k of keys) {
        if (k === quick) { res.quick = k; matched++ } else if (k === locked) { res.locked = k; matched++ } else if (k === overlay) { res.overlay = k; matched++ } else if (k === ocr) { res.ocr = k; matched++ } else if (region && k === region) { res.region = k; matched++ } else if (runeshape && k === runeshape) { res.runeshape = k; matched++ }
      }
      if (matched === 0) res.other = reg.error
      return res
    })

    // ---- WP-S:OCR 語言包狀態 + 搜尋範圍 ----
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
    const ocrStatus = computed(() => {
      if (!canCheck) return { kind: 'dim', text: t('ppz.ocr.status_preview') }
      const a = ocrAvail.value
      if (checking.value || a === null) return { kind: 'dim', text: t('ppz.ocr.status_checking') }
      if (a === undefined) return { kind: 'dim', text: t('ppz.ocr.status_preview') }
      if (a.ok) return { kind: 'good', text: t('ppz.ocr.status_ok', { lang: a.lang }) }
      if (a.error === 'lang-missing') return { kind: 'bad', text: t('ppz.ocr.status_missing', { langs: a.langs?.join(', ') || '—' }) }
      return { kind: 'bad', text: t('ppz.ocr.status_error', { error: a.message ?? a.error }) }
    })

    const regionKeys = ['x', 'y', 'w', 'h'] as const
    type RegionKey = typeof regionKeys[number]
    const regionDraft = reactive<Record<RegionKey, string>>({ x: '', y: '', w: '', h: '' })
    const regionError = shallowRef(false)
    function syncDraft () {
      const r = config.ocrRegion
      for (const k of regionKeys) regionDraft[k] = r ? String(r[k]) : ''
    }
    syncDraft()
    watch(() => config.ocrRegion, syncDraft)
    function applyRegion () {
      const vals = regionKeys.map(k => regionDraft[k].trim())
      if (vals.every(v => v === '')) { regionError.value = false; config.ocrRegion = null; return }
      if (vals.some(v => v === '')) { regionError.value = false; return } // 還沒填完
      const [x, y, w, h] = vals.map(Number)
      const r = normOcrRegion({ x, y, w, h })
      regionError.value = r == null
      if (r) config.ocrRegion = r
    }
    function clearRegion () {
      regionError.value = false
      config.ocrRegion = null
      syncDraft()
    }

    // ---- WP-S2:在遊戲上框選 ----
    /** 只有 Electron overlay 有框選層;瀏覽器預覽 / window 模式 / 純瀏覽器不行 */
    const canPick = Host.isElectron && !Host.isPreview && Host.isOverlay
    const pickUnavailable = computed(() => Host.isPreview || !Host.isElectron
      ? t('ppz.ocr.region.pick_preview')
      : t('ppz.ocr.region.pick_window'))
    const regionStatus = computed(() => {
      const r = config.ocrRegion
      return r ? t('ppz.ocr.region.status_set', regionPercent(r)) : t('ppz.ocr.region.status_unset')
    })
    function pickRegion () {
      if (!canPick) return
      openRegionPicker('settings')
    }

    // ---- 2026-10-01:褻瀆自動辨識 ----
    const revealIntervalDraft = shallowRef<number>(config.revealIntervalMs)
    watch(() => config.revealIntervalMs, (v) => { revealIntervalDraft.value = v })
    function applyRevealInterval () {
      config.revealIntervalMs = clampRuneshapeInterval(Number(revealIntervalDraft.value))
      revealIntervalDraft.value = config.revealIntervalMs
    }
    const revealStats = shallowRef<RuneshapeStats | undefined>(undefined)
    async function refreshRevealStats () {
      try { revealStats.value = await Host.revealStats() } catch (e) { console.warn('[reveal-scan] 讀統計失敗', e) }
    }
    onMounted(() => { if (config.game === 'poe2' && canCheck) void refreshRevealStats() })
    watch(() => [config.ocrRegion, config.revealAutoEnabled], () => {
      if (config.game === 'poe2' && canCheck) setTimeout(() => { void refreshRevealStats() }, 300)
    })
    /** 狀態(設定開著時掃描暫停,顯示的是暫停前最後一次的結果) */
    const revealStatus = computed(() => revealScanStatus(revealStats.value, (k, a) => t(k, a ?? {}), config.hotkeyOcrReveal))

    // ---- WP-R2:符文塑形面板自動查價 ----
    const runeshapeRegionStatus = computed(() => {
      const r = config.runeshapeRegion
      return r ? t('ppz.ocr.region.status_set', regionPercent(r)) : t('ppz.runeshape.region_unset')
    })
    function pickRuneshapeRegion () {
      if (!canPick) return
      openRegionPicker('settings', 'runeshape')
    }
    const intervalDraft = shallowRef<number>(config.runeshapeIntervalMs)
    watch(() => config.runeshapeIntervalMs, (v) => { intervalDraft.value = v })
    function applyInterval () {
      config.runeshapeIntervalMs = clampRuneshapeInterval(Number(intervalDraft.value))
      intervalDraft.value = config.runeshapeIntervalMs
    }
    const thresholdDraft = reactive({ low: config.runeshapeThresholds.low, high: config.runeshapeThresholds.high })
    watch(() => config.runeshapeThresholds, (v) => { thresholdDraft.low = v.low; thresholdDraft.high = v.high })
    function applyThresholds () {
      config.runeshapeThresholds = normRuneshapeThresholds({ low: Number(thresholdDraft.low), high: Number(thresholdDraft.high) })
      thresholdDraft.low = config.runeshapeThresholds.low
      thresholdDraft.high = config.runeshapeThresholds.high
    }
    const stats = shallowRef<RuneshapeStats | undefined>(undefined)
    async function refreshStats () {
      try { stats.value = await Host.runeshapeStats() } catch (e) { console.warn('[runeshape] 讀統計失敗', e) }
    }
    onMounted(() => { if (config.game === 'poe2' && canCheck) void refreshStats() })
    // 框選 / 清除區域後 main 要先收到新設定才會換模式 → 稍等再讀一次
    watch(() => config.runeshapeRegion, () => {
      if (config.game === 'poe2' && canCheck) setTimeout(() => { void refreshStats() }, 300)
    })
    /** 區域 / 自動定位的狀態(main `runeshape-stats`;設定開著時掃描暫停,顯示的是暫停前最後一次的結果) */
    const panelStatus = computed(() => {
      const s = stats.value
      if (!s) return null
      const manual = Boolean(config.runeshapeRegion)
      if (manual) {
        if (s.mode !== 'manual' || s.panel === 'unknown') return null
        return s.panel === 'found'
          ? { code: 'manual-found', warn: false, text: t('ppz.runeshape.status_manual_found') }
          : { code: 'manual-not-found', warn: true, text: t('ppz.runeshape.status_manual_not_found') }
      }
      if (s.mode !== 'auto') return null
      return s.autoRegion
        ? { code: 'auto-found', warn: false, text: t('ppz.runeshape.status_auto_found', regionPercent(s.autoRegion)) }
        : { code: 'auto-searching', warn: false, text: t('ppz.runeshape.status_auto_searching') }
    })
    const timingText = computed(() => {
      const last = runeshapeLastTimings.value?.timings ?? stats.value?.last
      if (!last) return t('ppz.runeshape.timing_none')
      const parts = [t('ppz.runeshape.timing_capture', { ms: last.captureMs })]
      if (last.ocrWallMs != null) parts.push(t('ppz.runeshape.timing_ocr', { ms: last.ocrWallMs }))
      parts.push(t('ppz.runeshape.timing_total', { ms: last.totalMs }))
      const s = stats.value
      if (s && s.avgCaptureMs != null) {
        parts.push(t('ppz.runeshape.timing_avg', { cap: s.avgCaptureMs, ocr: s.avgOcrMs ?? '—', runs: s.ocrRuns, skipped: s.skippedUnchanged }))
      }
      return parts.join(' · ')
    })

    return {
      t, config, failed, ocrAvail, ocrStatus, checking, canCheck, checkOcr, regionKeys, regionDraft, regionError, applyRegion, clearRegion,
      canPick, pickUnavailable, regionStatus, pickRegion,
      revealIntervalDraft, applyRevealInterval, refreshRevealStats, revealStatus,
      runeshapeRegionStatus, pickRuneshapeRegion, intervalDraft, applyInterval, thresholdDraft, applyThresholds, timingText, refreshStats, panelStatus
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
/* WP-R2 §2:符文塑形面板的區域 / 自動定位狀態 */
.settings-panel .err-line.ok { color: var(--good, var(--ink-1)); }
.settings-panel .ocr-status { font-size: var(--fs-sm); }
.settings-panel .ocr-status.good { color: var(--good, var(--ink-0)); }
.settings-panel .ocr-status.bad { color: var(--bad); }
.settings-panel .ocr-status.dim { color: var(--ink-2); }
.settings-panel .ocr-region .input { flex: 1 1 0; min-width: 0; }
/* WP-S2 */
.settings-panel .ocr-region-status { font-size: var(--fs-sm); color: var(--ink-0); font-variant-numeric: tabular-nums; }
.settings-panel .ocr-region-status.unset { color: var(--ink-2); }
.settings-panel .ocr-pick-na { color: var(--ink-2); }
.settings-panel .ocr-advanced { margin-top: 6px; }
.settings-panel .ocr-advanced > summary {
  cursor: pointer;
  font-size: var(--fs-xs);
  color: var(--ink-2);
  user-select: none;
}
.settings-panel .ocr-advanced > summary:hover { color: var(--ink-0); }
.settings-panel .ocr-advanced[open] > summary { margin-bottom: 4px; }
/* WP-R2 */
.settings-panel .rs-num { flex: 0 0 5.5em !important; min-width: 0; }
.settings-panel .err-line.warn { color: var(--warn); }
</style>
