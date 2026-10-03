<!--
  設定 › 記錄 › 效能(第 29 步,docs/perf/README.md):效能診斷開關 + 最近一筆摘要 + 開啟 perf 記錄檔。
  - 資料:IPC `perf-get` / `perf-set` / `perf-open-file`(main/src/perf/perf-monitor.ts;只有 Electron 視窗,預覽端整塊不顯示)。
  - 開關存在 main 的 userData/perf.json(不進 config.json / host-config,關著時與改版前行為相同);`--perf-log` 啟動也會打開。
  - 開著時每個取樣間隔輪詢一次 `perf-get` 更新摘要(分頁關掉就停);關著不輪詢。
-->
<template>
  <div class="perf-sec" data-perf="section">
    <div class="pf-row">
      <span class="pf-title">{{ t('ppz.perf.title') }}</span>
      <label class="chk">
        <input type="checkbox" data-setting="perf-log" :checked="state?.enabled === true" :disabled="busy || !state" @change="toggle">
        <span>{{ t('ppz.perf.enable', { sec }) }}</span>
      </label>
      <span class="grow" />
      <button class="btn ghost sm" type="button" data-action="perf-open-file" @click="openFile">{{ t('ppz.perf.open_file') }}</button>
    </div>
    <p class="pf-hint">{{ t('ppz.perf.hint') }}</p>
    <p v-if="state?.byArg" class="pf-hint">{{ t('ppz.perf.by_arg') }}</p>
    <p v-if="state?.enabled" class="pf-last" data-perf="last">
      <template v-if="state.last">
        <span class="pf-time">{{ t('ppz.perf.last', { time: lastTime }) }}</span>
        <span class="pf-sum" :title="state.last.summary">{{ state.last.summary }}</span>
      </template>
      <span v-else class="pf-time">{{ t('ppz.perf.none', { sec }) }}</span>
    </p>
    <p v-if="status" class="pf-status bad" data-perf="status">{{ status }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PerfState } from '@ipc/types'
import { Host } from '@/web/background/IPC'
import { logTime } from '../log-view'

const { t } = useI18n()
const state = shallowRef<PerfState | null>(null)
const busy = ref(false)
const status = ref('')
const sec = computed(() => Math.round((state.value?.sampleMs ?? 5000) / 1000))
const lastTime = computed(() => (state.value?.last ? logTime(state.value.last.ts) : ''))

let statusTimer: ReturnType<typeof setTimeout> | null = null
function say (msg: string) {
  status.value = msg
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { status.value = '' }, 4000)
}

async function refresh () {
  try { state.value = await Host.perfGet() } catch (e) { console.warn('[perf] 讀取效能診斷狀態失敗', e) }
}

async function toggle (ev: Event) {
  const on = (ev.target as HTMLInputElement).checked
  busy.value = true
  try {
    state.value = await Host.perfSet(on)
  } catch (e) {
    say(t('ppz.perf.set_failed'))
    console.warn('[perf] 切換效能診斷失敗', e)
    await refresh()
  } finally {
    busy.value = false
  }
}

async function openFile () {
  try { await Host.perfOpenFile() } catch (e) {
    say(t('ppz.perf.open_failed'))
    console.warn('[perf] 開啟效能記錄檔失敗', e)
  }
}

// 開著才輪詢(每個取樣間隔一次);關掉 / 分頁卸載就停
let poll: ReturnType<typeof setInterval> | null = null
function stopPoll () { if (poll) { clearInterval(poll); poll = null } }
watch(() => [state.value?.enabled === true, state.value?.sampleMs] as const, ([on, ms]) => {
  stopPoll()
  if (on) poll = setInterval(() => { void refresh() }, Math.max(1000, ms ?? 5000))
})
onMounted(() => { void refresh() })
onBeforeUnmount(() => {
  stopPoll()
  if (statusTimer) clearTimeout(statusTimer)
})
</script>

<style>
.log-view .perf-sec {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--edge-0);
  border-radius: var(--radius-m);
  background: var(--surface-1);
}
.perf-sec .pf-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.perf-sec .pf-row .grow { flex: 1; }
.perf-sec .pf-title { font-weight: 600; color: var(--ink-1); }
.perf-sec .pf-hint { margin: 0; font-size: var(--fs-2xs); color: var(--ink-3); }
.perf-sec .pf-last { margin: 0; display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-xs); }
.perf-sec .pf-time { color: var(--ink-2); }
.perf-sec .pf-sum { font-family: var(--font-mono); color: var(--ink-1); white-space: normal; word-break: break-word; }
.perf-sec .pf-status { margin: 0; font-size: var(--fs-xs); }
.perf-sec .pf-status.bad { color: var(--bad); }
</style>
