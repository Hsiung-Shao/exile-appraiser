<!--
  設定 › 自動辨識:畫面辨識的一張卡片(2026-10-01 使用者要求「褻瀆與符文的設定對等」;2026-10-14 起倉庫價格也用這個元件 = 三張卡片同一個樣板)。
  kind = reveal(靈魂之井褻瀆自動辨識,main `reveal-scan.ts`)/ runeshape(符文塑形自動查價,main `runeshape-scan.ts`)/
  stash(PoE1 倉庫價格疊層,main `stash-scan.ts`)。差異(設定鍵、統計來源、文字、data-setting)都在 ./scan-card-specs.ts `SCAN_SPECS`。
  版面(2026-10-14 設計稿):標題列 = 標題 +「?」+ 狀態標籤 + 重新整理 + 開關 → 一句說明 → (#top:台服警告等)→ 掃描間隔
  (100–3000 ms,< 500 顯示 CPU 提示)→ OCR 區域(狀態 + 在遊戲上框選 / 清除;倉庫 = 還原預設)→ 最近耗時 → 虛線分隔的專屬選項(#extra)→ (#foot)。
  暫停 / 繼續與框選區域熱鍵在「熱鍵」總表(hotkey-table.ts);隱私 / CPU 說明在自動辨識頁的共用卡片。
  框選沿用 OcrRegionPicker.vue(openRegionPicker('settings', kind));瀏覽器預覽沒有框選層 → 不顯示框選鈕、改顯示說明。
-->
<template>
  <section class="card scan-card" :data-setting="spec.ds.section" :data-scan="kind">
    <div class="card-head scan-head">
      <span class="label">{{ t(spec.i18n.section) }}</span>
      <help-tip v-if="spec.i18n.help" :id="`${kind}-help`" :text="t(spec.i18n.help)" />
      <span class="grow" />
      <span class="scan-status scan-chip" :class="status.tone" :data-setting="spec.ds.status" :data-status="status.code" :title="status.text">{{ status.text }}</span>
      <button v-if="canCheck" class="btn ghost sm scan-refresh" :data-action="spec.ds.stats" @click="refreshStats">{{ t('ppz.runeshape.refresh') }}</button>
      <label class="scan-switch" :title="t(spec.i18n.enabled)">
        <input v-model="enabled" type="checkbox" role="switch" :aria-checked="enabled" :aria-label="t(spec.i18n.enabled)" :data-setting="spec.ds.enabled">
        <span class="scan-switch-track" aria-hidden="true"><span class="scan-switch-knob" /></span>
      </label>
    </div>
    <p class="lead">{{ t(spec.i18n.hint) }}</p>
    <slot name="top" />
    <div class="srow">
      <span class="k">{{ t('ppz.scan.interval') }}</span>
      <div class="ctl">
        <input v-model.lazy.number="intervalDraft" class="input sm rs-num" type="number" :min="minMs" :max="maxMs" step="100"
          :data-setting="spec.ds.interval" @change="applyInterval">
        <span class="dim">ms</span>
      </div>
    </div>
    <p v-if="interval < warnMs" class="err-line warn" :data-setting="spec.ds.intervalWarn">{{ t('ppz.scan.interval_cpu_warn', { ms: warnMs }) }}</p>
    <div class="srow">
      <span class="k">{{ t(spec.i18n.region) }} <help-tip :id="`${kind}-region`" :data-setting="spec.ds.regionHint" :text="t(spec.i18n.regionHint)" /></span>
      <div class="ctl scan-region">
        <span class="ocr-region-status" :class="{ unset: !region }" :data-setting="spec.ds.regionStatus">{{ regionStatus }}</span>
        <button v-if="canPick" class="btn sm primary" :data-action="spec.ds.pick" @click="pick">{{ t('ppz.ocr.region.pick') }}</button>
        <button class="btn sm" :data-action="spec.ds.clear" :disabled="!region" @click="clearRegion">{{ t(spec.i18n.clear) }}</button>
      </div>
    </div>
    <p v-if="!canPick" class="foot ocr-pick-na" :data-setting="spec.ds.pickNa">{{ pickUnavailable }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.runeshape.timing') }}</span>
      <div class="ctl">
        <span class="scan-status dim" :data-setting="spec.ds.timing">{{ timingText }}</span>
      </div>
    </div>
    <div v-if="$slots.extra" class="scan-extra">
      <slot name="extra" />
    </div>
    <slot name="foot" />
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, shallowRef, watch, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OcrRegion, RuneshapeStats, StashStats } from '@ipc/types'
import { AppConfig, SCAN_INTERVAL_CPU_WARN_MS, SCAN_INTERVAL_MAX_MS, SCAN_INTERVAL_MIN_MS, clampRuneshapeInterval, hostConfigSettled } from '@/web/Config'
import { afterHostConfigApplied } from '@/web/host-config-sync'
import { Host } from '@/web/background/IPC'
import { openRegionPicker, scanStatus } from '@/web/overlay/ocr-reveal'
import { regionPercent } from '@/web/overlay/region-geom'
import { runeshapeLastTimings } from '@/web/overlay/runeshape-view'
import HelpTip from './HelpTip.vue'
import { SCAN_SPECS, stashScanStatus, stashTimingText, type ScanCardKind, type ScanCardStatus } from './scan-card-specs'

export default defineComponent({
  components: { HelpTip },
  props: {
    kind: { type: String as PropType<ScanCardKind>, required: true }
  },
  setup (props) {
    const { t } = useI18n()
    const config = AppConfig()
    const spec = computed(() => SCAN_SPECS[props.kind])

    const enabled = computed({
      get: () => config[spec.value.enabled],
      set: (v: boolean) => { config[spec.value.enabled] = v }
    })
    const pauseHotkey = computed(() => config[spec.value.pauseHotkey])
    const region = computed<OcrRegion | null>(() => config[spec.value.region])

    // ---- 掃描間隔 ----
    const interval = computed(() => config[spec.value.interval])
    const intervalDraft = shallowRef<number>(interval.value)
    watch(interval, (v) => { intervalDraft.value = v })
    function applyInterval () {
      config[spec.value.interval] = clampRuneshapeInterval(Number(intervalDraft.value))
      intervalDraft.value = config[spec.value.interval]
    }

    // ---- 區域 ----
    /** 只有 Electron overlay 有框選層;瀏覽器預覽 / window 模式 / 純瀏覽器不行 */
    const canPick = Host.isElectron && !Host.isPreview && Host.isOverlay
    const pickUnavailable = computed(() => Host.isPreview || !Host.isElectron
      ? t('ppz.ocr.region.pick_preview')
      : t('ppz.ocr.region.pick_window'))
    const regionStatus = computed(() => region.value
      ? t('ppz.ocr.region.status_set', regionPercent(region.value))
      : t(spec.value.i18n.regionUnset))
    function pick () {
      if (!canPick) return
      openRegionPicker('settings', props.kind)
    }
    function clearRegion () {
      config[spec.value.region] = null
    }

    // ---- 狀態(main `reveal-stats` / `runeshape-stats` / `stash-stats`;設定開著時掃描暫停,顯示的是暫停前最後一次的結果) ----
    const canCheck = Host.isElectron && !Host.isPreview
    const stats = shallowRef<RuneshapeStats | undefined>(undefined)
    const stashStats = shallowRef<StashStats | undefined>(undefined)
    const inGame = () => config.game === spec.value.game
    async function refreshStats () {
      if (!canCheck) return
      try {
        if (spec.value.stats === 'stash') stashStats.value = await Host.stashStats()
        else stats.value = spec.value.stats === 'reveal' ? await Host.revealStats() : await Host.runeshapeStats()
      } catch (e) { console.warn(`[${props.kind}] 讀統計失敗`, e) }
    }
    let timer: ReturnType<typeof setInterval> | null = null
    onMounted(() => {
      if (!inGame()) return
      void refreshStats()
      // 倉庫價格:開著時每 2 秒讀一次(同改版前的 StashPricesSection)
      const ms = spec.value.pollMs
      if (ms && canCheck) timer = setInterval(() => { void refreshStats() }, ms)
    })
    onUnmounted(() => { if (timer) clearInterval(timer) })
    // 框選 / 清除區域、開關、間隔改了 → main 要先收到新設定才會換模式:等設定送到 main(這些欄位不去抖,見 Config.ts `HOST_CONFIG_IMMEDIATE_KEYS`)
    // 再給掃描器一輪(poke 後立刻 tick)300 ms 才讀(code review 第 C 批:原本固定 300 ms,與設定去抖同時,可能讀到舊狀態)
    watch(() => [region.value, enabled.value, interval.value], () => {
      if (inGame() && canCheck) void afterHostConfigApplied(hostConfigSettled, () => { void refreshStats() })
    })
    const tr = (k: string, a?: Record<string, unknown>) => t(k, a ?? {})
    const status = computed<ScanCardStatus>(() => {
      if (!enabled.value) return { code: 'off', tone: 'dim', text: t('ppz.scan.status_off') }
      if (!canCheck) return { code: 'preview', tone: 'dim', text: t('ppz.scan.status_preview') }
      if (props.kind === 'stash') {
        return stashScanStatus(stashStats.value, tr, pauseHotkey.value) ?? { code: 'unknown', tone: 'dim', text: t('ppz.ocr.status_checking') }
      }
      const r = scanStatus(props.kind, stats.value, tr, pauseHotkey.value, props.kind === 'reveal' || !!region.value)
      if (r) return { code: r.code, tone: r.warn ? 'warn' : 'ok', text: r.text }
      return { code: 'none', tone: 'dim', text: t('ppz.scan.status_none') }
    })

    const timingText = computed(() => {
      if (props.kind === 'stash') return stashTimingText(stashStats.value, tr)
      const last = (props.kind === 'runeshape' ? runeshapeLastTimings.value?.timings : undefined) ?? stats.value?.last
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
      t,
      spec,
      enabled,
      pauseHotkey,
      region,
      interval,
      intervalDraft,
      applyInterval,
      minMs: SCAN_INTERVAL_MIN_MS,
      maxMs: SCAN_INTERVAL_MAX_MS,
      warnMs: SCAN_INTERVAL_CPU_WARN_MS,
      canPick,
      pickUnavailable,
      regionStatus,
      pick,
      clearRegion,
      canCheck,
      refreshStats,
      status,
      timingText
    }
  }
})
</script>

<style>
.settings-panel .scan-status { font-size: var(--fs-sm); }
.settings-panel .scan-status.ok { color: var(--ok, var(--ink-0)); }
.settings-panel .scan-status.warn { color: var(--warn); }
.settings-panel .scan-status.dim { color: var(--ink-2); }
.settings-panel .scan-head { flex-wrap: wrap; }
.settings-panel .scan-head .grow { flex: 1; }
/* 標題列的狀態標籤:一行、太長截斷(完整文字在 title) */
.settings-panel .scan-chip {
  max-width: 22em;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0.1em 0.6em;
  border: 1px solid var(--edge-1);
  border-radius: 999px;
  font-size: var(--fs-xs);
}
.settings-panel .scan-chip.ok { border-color: color-mix(in srgb, var(--ok, var(--ink-0)) 50%, transparent); }
.settings-panel .scan-chip.warn { border-color: color-mix(in srgb, var(--warn) 50%, transparent); }
/* 開關:checkbox 換成滑動開關外觀(input 保留 = 鍵盤 / 無障礙 / v-model / data-setting 照舊) */
.settings-panel .scan-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  cursor: pointer;
}
.settings-panel .scan-switch input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.settings-panel .scan-switch-track {
  display: inline-block;
  position: relative;
  width: 2.4em;
  height: 1.35em;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--edge-1);
  transition: background 0.15s;
}
.settings-panel .scan-switch-knob {
  position: absolute;
  top: 50%;
  left: 0.15em;
  width: 1em;
  height: 1em;
  border-radius: 50%;
  background: var(--ink-2);
  transform: translateY(-50%);
  transition: left 0.15s, background 0.15s;
}
.settings-panel .scan-switch input:checked + .scan-switch-track {
  background: color-mix(in srgb, var(--gold) 35%, var(--surface-2));
  border-color: var(--gold);
}
.settings-panel .scan-switch input:checked + .scan-switch-track .scan-switch-knob {
  left: calc(100% - 1.15em);
  background: var(--gold);
}
.settings-panel .scan-switch input:focus-visible + .scan-switch-track {
  outline: 1px solid var(--gold);
  outline-offset: 2px;
}
.settings-panel .scan-region {
  flex-wrap: wrap;
  gap: 0.4em;
}
/* 專屬選項:虛線分隔 */
.settings-panel .scan-extra {
  margin-top: 0.5em;
  padding-top: 0.45em;
  border-top: 1px dashed var(--edge-1);
}
</style>
