<!--
  設定 › 自動辨識:PoE2 畫面辨識的一張卡片(2026-10-01 使用者要求「褻瀆與符文的設定對等」,兩張卡片共用這個元件)。
  kind = reveal(靈魂之井褻瀆自動辨識,main `reveal-scan.ts`)/ runeshape(符文塑形自動查價,main `runeshape-scan.ts`)。
  同一套版面:標題(+「?」)→ 一句說明 → 啟用 → (#top)→ 目前狀態 → 掃描間隔(100–3000 ms,< 500 顯示 CPU 提示)
  → 區域狀態(+「?」)+「在遊戲上框選」「清除」→ 最近耗時 → (#extra:褻瀆 = 多個可能詞綴全部列出)→ (#foot)。
  第 39 步:暫停 / 繼續與框選區域熱鍵搬到「熱鍵」總表(hotkey-table.ts);隱私 / CPU 說明合併到自動辨識頁的共用卡片;
  卡片標題與開關不再重複「(PoE2)」「(PoE2、疊加模式)」(整頁只在 PoE2 + overlay 出現)。
  框選沿用 OcrRegionPicker.vue(openRegionPicker('settings', target));瀏覽器預覽沒有框選層 → 不顯示框選鈕、改顯示說明。
  data-setting / data-action 名稱沿用改版前的(驗證腳本與文件照舊可用)。
-->
<template>
  <section class="card scan-card" :data-setting="spec.ds.section" :data-scan="kind">
    <div class="card-head">
      <span class="label">{{ t(spec.i18n.section) }}</span>
      <help-tip v-if="spec.i18n.help" :id="`${kind}-help`" :text="t(spec.i18n.help)" />
    </div>
    <p class="lead">{{ t(spec.i18n.hint) }}</p>
    <div class="chk-row">
      <label class="chk"><input v-model="enabled" type="checkbox" :data-setting="spec.ds.enabled"><span>{{ t(spec.i18n.enabled) }}</span></label>
    </div>
    <slot name="top" />
    <div class="srow">
      <span class="k">{{ t('ppz.scan.status') }}</span>
      <div class="ctl">
        <span class="scan-status" :class="status.tone" :data-setting="spec.ds.status" :data-status="status.code">{{ status.text }}</span>
        <button v-if="canCheck" class="btn ghost sm" :data-action="spec.ds.stats" @click="refreshStats">{{ t('ppz.runeshape.refresh') }}</button>
      </div>
    </div>
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
      <div class="ctl">
        <span class="ocr-region-status" :class="{ unset: !region }" :data-setting="spec.ds.regionStatus">{{ regionStatus }}</span>
      </div>
    </div>
    <div class="srow">
      <span class="k" />
      <div class="ctl">
        <button v-if="canPick" class="btn sm primary" :data-action="spec.ds.pick" @click="pick">{{ t('ppz.ocr.region.pick') }}</button>
        <button class="btn sm" :data-action="spec.ds.clear" :disabled="!region" @click="clearRegion">{{ t('ppz.ocr.region.clear') }}</button>
      </div>
    </div>
    <p v-if="!canPick" class="foot ocr-pick-na" :data-setting="spec.ds.pickNa">{{ pickUnavailable }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.runeshape.timing') }}</span>
      <div class="ctl">
        <span class="scan-status dim" :data-setting="spec.ds.timing">{{ timingText }}</span>
      </div>
    </div>
    <slot name="extra" />
    <slot name="foot" />
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, shallowRef, watch, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OcrRegion, RuneshapeStats } from '@ipc/types'
import { AppConfig, SCAN_INTERVAL_CPU_WARN_MS, SCAN_INTERVAL_MAX_MS, SCAN_INTERVAL_MIN_MS, clampRuneshapeInterval, hostConfigSettled } from '@/web/Config'
import { afterHostConfigApplied } from '@/web/host-config-sync'
import { Host } from '@/web/background/IPC'
import { openRegionPicker, scanStatus } from '@/web/overlay/ocr-reveal'
import { regionPercent } from '@/web/overlay/region-geom'
import { runeshapeLastTimings } from '@/web/overlay/runeshape-view'
import HelpTip from './HelpTip.vue'

type Kind = 'reveal' | 'runeshape'

interface ScanSpec {
  enabled: 'revealAutoEnabled' | 'runeshapeEnabled'
  interval: 'revealIntervalMs' | 'runeshapeIntervalMs'
  region: 'ocrRegion' | 'runeshapeRegion'
  /** 暫停 / 繼續熱鍵(第 39 步起在「熱鍵」總表編輯;這裡只給狀態文字用) */
  pauseHotkey: 'hotkeyOcrReveal' | 'hotkeyRuneshapeToggle'
  /** `help`:卡片標題旁「?」的長說明(沒有 = 不顯示) */
  i18n: { section: string, hint: string, help?: string, enabled: string, region: string, regionUnset: string, regionHint: string }
  /** data-setting / data-action 名稱 */
  ds: Record<'section' | 'enabled' | 'status' | 'stats' | 'interval' | 'intervalWarn' | 'regionStatus' | 'pick' | 'clear' | 'pickNa' | 'regionHint' | 'timing', string>
}

const SPECS: Record<Kind, ScanSpec> = {
  reveal: {
    enabled: 'revealAutoEnabled',
    interval: 'revealIntervalMs',
    region: 'ocrRegion',
    pauseHotkey: 'hotkeyOcrReveal',
    i18n: {
      section: 'ppz.ocr.section',
      hint: 'ppz.ocr.hint',
      enabled: 'ppz.ocr.auto_enabled',
      region: 'ppz.ocr.region.title',
      regionUnset: 'ppz.ocr.region.status_unset',
      regionHint: 'ppz.ocr.region.hint'
    },
    ds: {
      section: 'ocr-section',
      enabled: 'reveal-auto-enabled',
      status: 'reveal-scan-status',
      stats: 'reveal-stats',
      interval: 'reveal-interval',
      intervalWarn: 'reveal-interval-warn',
      regionStatus: 'ocr-region-status',
      pick: 'ocr-region-pick',
      clear: 'ocr-region-clear',
      pickNa: 'ocr-region-pick-unavailable',
      regionHint: 'ocr-region-hint',
      timing: 'reveal-timing'
    }
  },
  runeshape: {
    enabled: 'runeshapeEnabled',
    interval: 'runeshapeIntervalMs',
    region: 'runeshapeRegion',
    pauseHotkey: 'hotkeyRuneshapeToggle',
    i18n: {
      section: 'ppz.runeshape.section',
      hint: 'ppz.runeshape.hint',
      help: 'ppz.runeshape.display_hint',
      enabled: 'ppz.runeshape.enabled',
      region: 'ppz.runeshape.region',
      regionUnset: 'ppz.runeshape.region_unset',
      regionHint: 'ppz.runeshape.region_hint'
    },
    ds: {
      section: 'runeshape-section',
      enabled: 'runeshape-enabled',
      status: 'runeshape-panel-status',
      stats: 'runeshape-stats',
      interval: 'runeshape-interval',
      intervalWarn: 'runeshape-interval-warn',
      regionStatus: 'runeshape-region-status',
      pick: 'runeshape-region-pick',
      clear: 'runeshape-region-clear',
      pickNa: 'runeshape-region-pick-unavailable',
      regionHint: 'runeshape-region-hint',
      timing: 'runeshape-timing'
    }
  }
}

export default defineComponent({
  components: { HelpTip },
  props: {
    kind: { type: String as PropType<Kind>, required: true }
  },
  setup (props) {
    const { t } = useI18n()
    const config = AppConfig()
    const spec = computed(() => SPECS[props.kind])

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

    // ---- 狀態(main `reveal-stats` / `runeshape-stats`;設定開著時掃描暫停,顯示的是暫停前最後一次的結果) ----
    const canCheck = Host.isElectron && !Host.isPreview
    const stats = shallowRef<RuneshapeStats | undefined>(undefined)
    async function refreshStats () {
      if (!canCheck) return
      try {
        stats.value = props.kind === 'reveal' ? await Host.revealStats() : await Host.runeshapeStats()
      } catch (e) { console.warn(`[${props.kind}] 讀統計失敗`, e) }
    }
    onMounted(() => { if (config.game === 'poe2') void refreshStats() })
    // 框選 / 清除區域、開關後 main 要先收到新設定才會換模式:等設定送到 main(這些欄位不去抖,見 Config.ts `HOST_CONFIG_IMMEDIATE_KEYS`)
    // 再給掃描器一輪(poke 後立刻 tick)300 ms 才讀(code review 第 C 批:原本固定 300 ms,與設定去抖同時,可能讀到舊狀態)
    watch(() => [region.value, enabled.value], () => {
      if (config.game === 'poe2' && canCheck) void afterHostConfigApplied(hostConfigSettled, () => { void refreshStats() })
    })
    const tr = (k: string, a?: Record<string, unknown>) => t(k, a ?? {})
    const status = computed<{ code: string, tone: string, text: string }>(() => {
      if (!enabled.value) return { code: 'off', tone: 'dim', text: t('ppz.scan.status_off') }
      if (!canCheck) return { code: 'preview', tone: 'dim', text: t('ppz.scan.status_preview') }
      const s = stats.value
      const r = scanStatus(props.kind, s, tr, pauseHotkey.value, props.kind === 'reveal' || !!region.value)
      if (r) return { code: r.code, tone: r.warn ? 'warn' : 'ok', text: r.text }
      return { code: 'none', tone: 'dim', text: t('ppz.scan.status_none') }
    })

    const timingText = computed(() => {
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
</style>
