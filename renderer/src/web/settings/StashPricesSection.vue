<!--
  設定 › 自動辨識 › 倉庫價格(PoE1 碎片頁疊層;只在 PoE1 顯示)。2026-10-14 使用者回報「放在倉庫與聊天不知道去哪找」→
  搬到「自動辨識」分頁,版面照褻瀆 / 符文塑形的卡片(OcrScanSection.vue):標題(+「?」)→ 一句說明 → 啟用 → 目前狀態(+ 重新整理)
  → 掃描間隔(100–3000 ms,< 500 顯示 CPU 提示)→ OCR 區域(+ 在遊戲上框選 / 還原預設;沒框過 = 預設碎片頁按鈕列)→ 最近耗時 → 顯示物品名稱。
  OCR 區域只決定讀子頁按鈕的那一塊;每格物品位置仍由固定版面決定。
  價格顏色門檻(`stashThresholds`,混沌石)與字體 / 大小 / 外框在同一頁的「徽章外觀」卡片(BadgeStyleSection.vue,與 PoE2 相同)。
-->
<template>
  <section class="card scan-card" data-setting="stash-prices" data-scan="stash">
    <div class="card-head">
      <span class="label">{{ t('ppz.stash.section') }}</span>
      <help-tip id="stash-help" :text="t('ppz.stash.help')" />
    </div>
    <p class="lead">{{ t('ppz.stash.hint') }}</p>
    <div class="chk-row">
      <label class="chk"><input v-model="config.stashPricesEnabled" type="checkbox" data-setting="stash-prices-enabled"><span>{{ t('ppz.stash.enabled') }}</span></label>
    </div>
    <p v-if="config.realm === 'tw'" class="foot warn" data-setting="stash-tw">{{ t('ppz.stash.tw_no_source') }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.scan.status') }}</span>
      <div class="ctl">
        <span class="scan-status" :class="status.tone" data-setting="stash-status" :data-status="status.code">{{ status.text }}</span>
        <button v-if="canCheck" class="btn ghost sm" data-action="stash-stats" @click="read">{{ t('ppz.runeshape.refresh') }}</button>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.scan.interval') }}</span>
      <div class="ctl">
        <input v-model.lazy.number="intervalDraft" class="input sm rs-num" type="number" :min="minMs" :max="maxMs" step="100"
          data-setting="stash-interval" @change="applyInterval">
        <span class="dim">ms</span>
      </div>
    </div>
    <p v-if="config.stashPricesIntervalMs < warnMs" class="err-line warn" data-setting="stash-interval-warn">{{ t('ppz.scan.interval_cpu_warn', { ms: warnMs }) }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.stash.region') }} <help-tip id="stash-region" data-setting="stash-region-hint" :text="t('ppz.stash.region_hint')" /></span>
      <div class="ctl">
        <span class="ocr-region-status" :class="{ unset: !config.stashRegion }" data-setting="stash-region-status">{{ regionStatus }}</span>
      </div>
    </div>
    <div class="srow">
      <span class="k" />
      <div class="ctl">
        <button v-if="canPick" class="btn sm primary" data-action="stash-region-pick" @click="pick">{{ t('ppz.ocr.region.pick') }}</button>
        <button class="btn sm" data-action="stash-region-reset" :disabled="!config.stashRegion" @click="resetRegion">{{ t('ppz.stash.region_reset') }}</button>
      </div>
    </div>
    <p v-if="!canPick" class="foot ocr-pick-na" data-setting="stash-region-pick-unavailable">{{ pickUnavailable }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.runeshape.timing') }}</span>
      <div class="ctl">
        <span class="scan-status dim" data-setting="stash-timing">{{ timingText }}</span>
      </div>
    </div>
    <div class="chk-row">
      <label class="chk"><input v-model="config.stashShowNames" type="checkbox" data-setting="stash-show-names"><span>{{ t('ppz.stash.show_names') }}</span></label>
      <help-tip id="stash-show-names" :text="t('ppz.stash.show_names_hint')" />
    </div>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StashStats } from '@ipc/types'
import { AppConfig, SCAN_INTERVAL_CPU_WARN_MS, SCAN_INTERVAL_MAX_MS, SCAN_INTERVAL_MIN_MS, clampRuneshapeInterval, hostConfigSettled } from '@/web/Config'
import { afterHostConfigApplied } from '@/web/host-config-sync'
import { Host } from '@/web/background/IPC'
import { openRegionPicker } from '@/web/overlay/ocr-reveal'
import { regionPercent } from '@/web/overlay/region-geom'
import HelpTip from './HelpTip.vue'

export default defineComponent({
  components: { HelpTip },
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    const canCheck = Host.isElectron && !Host.isPreview

    // ---- 掃描間隔(同 OcrScanSection) ----
    const intervalDraft = shallowRef<number>(config.stashPricesIntervalMs)
    watch(() => config.stashPricesIntervalMs, (v) => { intervalDraft.value = v })
    function applyInterval () {
      config.stashPricesIntervalMs = clampRuneshapeInterval(Number(intervalDraft.value))
      intervalDraft.value = config.stashPricesIntervalMs
    }

    // ---- 狀態(main `stash-stats`;開著時每 2 秒讀一次,開關 / 間隔改了等設定送到 main 再讀) ----
    const stats = shallowRef<StashStats | undefined>(undefined)
    async function read () {
      if (!canCheck) return
      try { stats.value = await Host.stashStats() } catch { stats.value = undefined }
    }
    let timer: ReturnType<typeof setInterval> | null = null
    onMounted(() => { void read(); timer = setInterval(() => { void read() }, 2000) })
    onUnmounted(() => { if (timer) clearInterval(timer) })
    watch(() => [config.stashPricesEnabled, config.stashPricesIntervalMs], () => {
      void afterHostConfigApplied(hostConfigSettled, () => { void read() }, 300)
    })

    const status = computed(() => {
      if (!canCheck) return { code: 'preview', tone: 'dim', text: t('ppz.ocr.status_preview') }
      if (!config.stashPricesEnabled) return { code: 'disabled', tone: 'dim', text: t('ppz.stash.status_disabled') }
      const s = stats.value
      if (!s) return { code: 'unknown', tone: 'dim', text: t('ppz.ocr.status_checking') }
      if (s.showing && s.subtab) return { code: 'showing', tone: 'good', text: t('ppz.stash.status_showing', { subtab: t(`ppz.stash.subtab_${s.subtab}`) }) }
      if (s.block === 'game-inactive' || s.block === 'no-window') return { code: s.block, tone: 'dim', text: t('ppz.stash.status_game_inactive') }
      if (s.block === 'ui-open') return { code: 'ui-open', tone: 'dim', text: t('ppz.stash.status_ui_open') }
      return { code: 'idle', tone: 'dim', text: t('ppz.stash.status_idle') }
    })
    const timingText = computed(() => {
      const s = stats.value
      if (!s || s.lastOcrMs == null) return t('ppz.runeshape.timing_none')
      return t('ppz.stash.timing', { ms: s.lastOcrMs, count: s.ocrCount })
    })

    // ---- OCR 區域(2026-10-14 使用者要求可自訂;null = 預設碎片頁按鈕列)----
    /** 只有 Electron overlay 有框選層;瀏覽器預覽 / window 模式不行(同 OcrScanSection) */
    const canPick = Host.isElectron && !Host.isPreview && Host.isOverlay
    const pickUnavailable = computed(() => Host.isPreview || !Host.isElectron ? t('ppz.ocr.region.pick_preview') : t('ppz.ocr.region.pick_window'))
    const regionStatus = computed(() => config.stashRegion
      ? t('ppz.ocr.region.status_set', regionPercent(config.stashRegion))
      : t('ppz.stash.region_default'))
    function pick () {
      if (canPick) openRegionPicker('settings', 'stash')
    }
    function resetRegion () {
      config.stashRegion = null
    }

    return {
      t,
      config,
      canCheck,
      canPick,
      pickUnavailable,
      regionStatus,
      pick,
      resetRegion,
      intervalDraft,
      applyInterval,
      minMs: SCAN_INTERVAL_MIN_MS,
      maxMs: SCAN_INTERVAL_MAX_MS,
      warnMs: SCAN_INTERVAL_CPU_WARN_MS,
      read,
      status,
      timingText
    }
  }
})
</script>
