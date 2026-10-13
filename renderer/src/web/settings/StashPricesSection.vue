<!--
  設定 › 倉庫與聊天 › 倉庫價格(PoE1 碎片頁疊層;只在 PoE1 顯示,所在分頁本身只在 overlay 模式有內容)。
  開關 / 顯示名稱(辨識檢視)/ 價格顏色門檻(混沌石,規則同符文塑形)/ 目前狀態(main `stash-stats`,開著時每 2 秒讀一次)。
-->
<template>
  <section class="card" data-setting="stash-prices">
    <div class="card-head">
      <span class="label">{{ t('ppz.stash.section') }}</span>
      <label class="chk"><input v-model="config.stashPricesEnabled" type="checkbox" data-setting="stash-prices-enabled"><span>{{ t('ppz.stash.enabled') }}</span></label>
    </div>
    <p class="lead">{{ t('ppz.stash.hint') }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.stash.show_names') }}</span>
      <div class="ctl">
        <label class="chk"><input v-model="config.stashShowNames" type="checkbox" data-setting="stash-show-names"><span /></label>
      </div>
      <span class="note">{{ t('ppz.stash.show_names_hint') }}</span>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.stash.thresholds') }}</span>
      <div class="ctl">
        <input v-model.lazy.number="draft.low" class="input sm rs-num" type="number" min="0" step="1" data-setting="stash-threshold-low" @change="apply">
        <span class="dim">–</span>
        <input v-model.lazy.number="draft.high" class="input sm rs-num" type="number" min="0" step="1" data-setting="stash-threshold-high" @change="apply">
      </div>
    </div>
    <p v-if="config.stashPricesEnabled" class="foot" data-setting="stash-status">{{ statusText }}</p>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, reactive, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StashStats } from '@ipc/types'
import { AppConfig, DEFAULT_STASH_THRESHOLDS, normRuneshapeThresholds } from '@/web/Config'
import { Host } from '@/web/background/IPC'

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    const draft = reactive({ ...config.stashThresholds })
    const apply = () => {
      config.stashThresholds = normRuneshapeThresholds({ low: draft.low, high: draft.high }, DEFAULT_STASH_THRESHOLDS)
      Object.assign(draft, config.stashThresholds)
    }
    const stats = shallowRef<StashStats | undefined>(undefined)
    const read = async () => { try { stats.value = await Host.stashStats() } catch { stats.value = undefined } }
    let timer: ReturnType<typeof setInterval> | null = null
    onMounted(() => { void read(); timer = setInterval(() => { void read() }, 2000) })
    onUnmounted(() => { if (timer) clearInterval(timer) })
    const statusText = computed(() => {
      const s = stats.value
      if (s?.showing && s.subtab) return t('ppz.stash.status_showing', { subtab: t(`ppz.stash.subtab_${s.subtab}`) })
      return t('ppz.stash.status_idle')
    })
    return { t, config, draft, apply, statusText }
  }
})
</script>
