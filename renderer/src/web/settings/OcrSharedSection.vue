<!--
  自動辨識共用卡片(辨識語言 `ocrLang`、OCR 語言包狀態、隱私與 CPU 各一句)。
  2026-11-18 設定重整:從 tabs/Recognition.vue 抽出,PoE2 在「自動辨識」頁、PoE1 在「倉庫」頁(倉庫價格也用 OCR)。
-->
<template>
  <section class="card" data-setting="ocr-shared">
    <div class="card-head">
      <span class="label">{{ t('ppz.scan.shared_section') }}</span>
      <help-tip id="scan-cpu" data-setting="scan-cpu-hint" :text="t('ppz.scan.cpu_help')" />
    </div>
    <p class="lead" data-setting="ocr-privacy">{{ t('ppz.scan.privacy') }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.ocr.lang') }} <help-tip id="ocr-lang" data-setting="ocr-lang-hint" :text="t('ppz.ocr.lang_hint')" /></span>
      <div class="ctl">
        <select v-model="config.ocrLang" class="select sm" data-setting="ocr-lang">
          <option value="follow">{{ t('ppz.ocr.lang_follow') }}</option>
          <option value="cmn-Hant">{{ t('ppz.ocr.lang_zh') }}</option>
          <option value="en">{{ t('ppz.ocr.lang_en') }}</option>
        </select>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.ocr.status') }}</span>
      <div class="ctl">
        <span class="ocr-status" :class="ocrStatus.kind" data-setting="ocr-status">{{ ocrStatus.text }}</span>
        <button v-if="canCheck" class="btn ghost sm" data-action="ocr-check" :disabled="checking" @click="checkOcr">{{ t('ppz.ocr.check') }}</button>
      </div>
    </div>
    <p v-if="ocrStatus.kind === 'bad' && ocrAvail && !ocrAvail.ok && ocrAvail.error === 'lang-missing'" class="err-line" data-setting="ocr-lang-missing">{{ t(ocrWantsEn ? 'ppz.ocr.err_lang_missing_en' : 'ppz.ocr.err_lang_missing') }}</p>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OcrAvailability } from '@ipc/types'
import { AppConfig, hostConfigSettled } from '@/web/Config'
import { afterHostConfigApplied } from '@/web/host-config-sync'
import { ocrWantsEnglish } from '@/web/ocr-lang'
import { Host } from '@/web/background/IPC'
import HelpTip from './HelpTip.vue'

export default defineComponent({
  components: { HelpTip },
  setup () {
    const { t } = useI18n()
    const config = AppConfig()

    // ---- WP-S:OCR 語言包狀態(褻瀆 / 符文 / 倉庫價格共用) ----
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
    onMounted(() => { void checkOcr() })
    // 第 22 步:OCR 語言包跟著客戶端語言;第 25 步起可用 `ocrLang` 獨立指定(main 收到設定後換語言包)→ 設定送到 main 之後重新檢查
    watch(() => [config.language, config.ocrLang], () => {
      if (canCheck) void afterHostConfigApplied(hostConfigSettled, () => { void checkOcr() }, 0)
    })
    /** 缺的是英文語言包(main 回報想用的語言包;舊 main 沒回報 → 依目前的客戶端語言) */
    const ocrWantsEn = computed(() => ocrWantsEnglish(ocrAvail.value, config.language, config.ocrLang))
    const ocrStatus = computed(() => {
      if (!canCheck) return { kind: 'dim', text: t('ppz.ocr.status_preview') }
      const a = ocrAvail.value
      if (checking.value || a === null) return { kind: 'dim', text: t('ppz.ocr.status_checking') }
      if (a === undefined) return { kind: 'dim', text: t('ppz.ocr.status_preview') }
      if (a.ok) return { kind: 'good', text: t('ppz.ocr.status_ok', { lang: a.lang }) }
      if (a.error === 'lang-missing') return { kind: 'bad', text: t(ocrWantsEn.value ? 'ppz.ocr.status_missing_en' : 'ppz.ocr.status_missing', { langs: a.langs?.join(', ') || '—' }) }
      return { kind: 'bad', text: t('ppz.ocr.status_error', { error: a.message ?? a.error }) }
    })

    return { t, config, ocrAvail, ocrStatus, ocrWantsEn, checking, canCheck, checkOcr }
  }
})
</script>

<style>
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
