<!--
  設定 › 一般 › 計時器(2026-11-10 speedrun):目前遊戲的路線。
  自動開始 / 自動分段(讀 Client.txt)+ 監看狀態、顯示幾段、分段清單編輯、個人最佳 / 最佳段總和 / 嘗試次數 / 清除紀錄。
  改名直接改路線(不重設進行中的計時);增刪段 / 改觸發區域走 core `replaceSplits`(段數或區域變了 → PB / 金段作廢並提示)。
  尺寸只用 em / --fs-*(設定視窗獨立字級)。
-->
<template>
  <div class="sr" data-setting="speedrun">
    <div class="chk-row">
      <label class="chk"><input v-model="route.autoStart" type="checkbox" data-setting="speedrun-auto-start"><span>{{ t('ppz.timer.auto_start') }}</span></label>
    </div>
    <div class="chk-row">
      <label class="chk"><input v-model="route.autoSplit" type="checkbox" data-setting="speedrun-auto-split"><span>{{ t('ppz.timer.auto_split') }}</span></label>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.timer.client_log') }}</span>
      <div class="ctl sr-log">
        <span class="note" data-setting="client-log-status">{{ logText }}</span>
        <button v-if="canPick" class="btn ghost sm" data-action="client-log-pick" @click="pickLog">{{ t('ppz.timer.client_log_pick') }}</button>
        <button v-if="config.clientLogPath" class="btn ghost sm" data-action="client-log-auto" @click="config.clientLogPath = ''">{{ t('ppz.timer.client_log_auto') }}</button>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.timer.rows') }}</span>
      <div class="ctl">
        <select v-model.number="config.speedrunRows" class="select sm" data-setting="speedrun-rows">
          <option v-for="n in rowChoices" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
    </div>

    <div class="sr-head">
      <span class="k">{{ t('ppz.timer.splits') }}</span>
      <span class="sr-stats note">
        {{ t('ppz.timer.pb') }} <b class="num">{{ pbText }}</b> ·
        {{ t('ppz.timer.sum_of_best') }} <b class="num">{{ sobText }}</b> ·
        {{ t('ppz.timer.attempts') }} <b class="num">{{ route.attempts }}</b>
      </span>
    </div>
    <ol class="sr-list" data-setting="speedrun-splits">
      <li v-for="(s, i) in route.splits" :key="i" class="sr-item">
        <input v-model="s.name" class="input sm sr-name" maxlength="40" :aria-label="t('ppz.timer.split_name')" :data-setting="`split-name-${i}`" spellcheck="false">
        <select class="select sm sr-area" :value="areaChoice(s.area)" :aria-label="t('ppz.timer.split_area')" :data-setting="`split-area-${i}`"
          @change="onAreaChoice(i, ($event.target as HTMLSelectElement).value)">
          <option v-for="a in towns" :key="a.area" :value="a.area">{{ townLabel(a) }}</option>
          <option value="__manual">{{ t('ppz.timer.manual_only') }}</option>
          <option value="__custom">{{ t('ppz.timer.custom_area') }}</option>
        </select>
        <input v-if="areaChoice(s.area) === '__custom' || customOpen === i" class="input sm num sr-custom" :value="s.area ?? ''" spellcheck="false"
          :data-setting="`split-custom-${i}`" @change="setArea(i, ($event.target as HTMLInputElement).value.trim() || null)">
        <span class="sr-btns">
          <button class="btn ghost sm" :disabled="i === 0" :aria-label="t('ppz.timer.move_up')" :title="t('ppz.timer.move_up')" @click="move(i, -1)">↑</button>
          <button class="btn ghost sm" :disabled="i === route.splits.length - 1" :aria-label="t('ppz.timer.move_down')" :title="t('ppz.timer.move_down')" @click="move(i, 1)">↓</button>
          <button class="btn ghost sm" :disabled="route.splits.length <= 1" :aria-label="t('ppz.timer.remove')" :title="t('ppz.timer.remove')" @click="remove(i)">✕</button>
        </span>
      </li>
    </ol>
    <p v-if="notice" class="note warn-text" role="status">{{ notice }}</p>
    <div class="btn-row">
      <button class="btn ghost sm" data-action="split-add" @click="add">{{ t('ppz.timer.add_split') }}</button>
      <button class="btn ghost sm" data-action="split-preset" @click="restore">{{ t('ppz.timer.restore_preset') }}</button>
      <template v-if="!confirming">
        <button class="btn ghost sm" data-action="records-clear" @click="confirming = true">{{ t('ppz.timer.clear_records') }}</button>
      </template>
      <template v-else>
        <span class="note warn-text">{{ t('ppz.timer.clear_confirm', { game: config.game === 'poe2' ? 'PoE2' : 'PoE1' }) }}</span>
        <button class="btn sm primary" data-action="records-clear-confirm" @click="clearRecords">{{ t('ppz.timer.confirm') }}</button>
        <button class="btn ghost sm" @click="confirming = false">{{ t('ppz.timer.cancel') }}</button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ClientLogStatus } from '@ipc/types'
import { AppConfig, hostConfigSettled } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import { PRESET_TOWN_AREAS, presetRoute, replaceSplits, type SplitDef } from '../../../../core/src/speedrun/routes'
import { formatRunTime, sumOfBest } from '../../../../core/src/speedrun/run'
import { appRun } from '@/web/overlay/timer-state'

const { t, locale } = useI18n()
const config = AppConfig()
const route = computed(() => config.speedrun[config.game])
const towns = computed(() => PRESET_TOWN_AREAS[config.game])
const isEn = computed(() => String(locale.value) === 'en')
const townLabel = (a: { area: string, zh: string, en: string }) => `${isEn.value ? a.en : a.zh}(${a.area})`
const rowChoices = Array.from({ length: 20 }, (_, i) => i + 1)

const pbText = computed(() => { const pb = route.value.pb; const v = pb?.[pb.length - 1]; return v == null ? '—' : formatRunTime(v) })
const sobText = computed(() => { const v = sumOfBest(route.value); return v == null ? '—' : formatRunTime(v) })

// ---- 分段編輯 ----
const notice = shallowRef('')
const confirming = shallowRef(false)
const customOpen = shallowRef<number | null>(null)
function setSplits (splits: SplitDef[], keepRecords = true) {
  const before = route.value
  const had = before.pb != null || before.golds.some(g => g != null)
  const running = appRun.value.phase !== 'idle'
  const next = replaceSplits(before, splits, keepRecords)
  config.speedrun[config.game] = next
  const cleared = had && next.pb == null && next.golds.every(g => g == null)
  const shape = (r: typeof before) => r.splits.map(s => s.area ?? '').join('|') + `#${r.splits.length}`
  // timer-state 的 watch 會在段數 / 區域改了或紀錄被清掉時重設進行中的計時 → 這裡告訴使用者
  const resets = running && (cleared || shape(before) !== shape(next))
  notice.value = [cleared ? t('ppz.timer.records_cleared_by_change') : '', resets ? t('ppz.timer.run_reset_by_change') : ''].filter(Boolean).join(' ')
}
const copy = () => route.value.splits.map(s => ({ ...s }))
function areaChoice (area: string | null): string {
  if (area == null) return '__manual'
  return towns.value.some(a => a.area === area) ? area : '__custom'
}
function setArea (i: number, area: string | null) {
  const s = copy()
  s[i] = { ...s[i], area }
  setSplits(s)
}
function onAreaChoice (i: number, v: string) {
  if (v === '__custom') { customOpen.value = i; return }
  customOpen.value = null
  setArea(i, v === '__manual' ? null : v)
}
function move (i: number, d: number) {
  const s = copy()
  const [x] = s.splice(i, 1)
  s.splice(i + d, 0, x)
  // 調順序一律清紀錄(兩段區域相同時互換,舊紀錄會對到錯的段)
  setSplits(s, false)
}
function remove (i: number) {
  const s = copy()
  s.splice(i, 1)
  setSplits(s)
}
function add () {
  setSplits([...copy(), { name: `${t('ppz.timer.splits')} ${route.value.splits.length + 1}`, area: null }])
}
function restore () {
  const lang = isEn.value ? 'en' : 'cmn-Hant'
  setSplits(presetRoute(config.game, lang).splits)
  route.value.startArea = presetRoute(config.game, lang).startArea
}
function clearRecords () {
  // 進行中的計時先重設:否則下一次分段會用開始時的快照把紀錄寫回去
  appRun.value.reset()
  const r = route.value
  r.pb = null
  r.golds = r.splits.map(() => null)
  r.attempts = 0
  confirming.value = false
  notice.value = ''
}

// ---- Client.txt 狀態 ----
const canPick = Host.canPickClientLog
const status = shallowRef<ClientLogStatus | null>(null)
const logText = computed(() => {
  const s = status.value
  if (!s) return '—'
  if (s.reason === 'ok') return `${t('ppz.timer.client_log_ok')}:${s.path}`
  return t(s.reason === 'off' ? 'ppz.timer.client_log_off' : s.reason === 'no-game' ? 'ppz.timer.client_log_no_game' : 'ppz.timer.client_log_none')
})
let alive = true
async function refreshStatus () {
  await hostConfigSettled()
  const s = await Host.clientLogStatus()
  if (alive) status.value = s
}
async function pickLog () {
  const p = await Host.clientLogPick()
  if (p) config.clientLogPath = p
}
onMounted(() => { void refreshStatus() })
onUnmounted(() => { alive = false })
watch(() => [config.clientLogPath, route.value.autoStart, route.value.autoSplit, config.timerDisplay, config.game], () => { void refreshStatus() })
</script>

<style scoped>
.sr { display: flex; flex-direction: column; gap: 0.4em; }
.sr-log { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4em; }
.sr-log .note { word-break: break-all; }
.sr-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0.5em; margin-top: 0.4em; }
.sr-stats b { font-weight: 600; }
.sr-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3em; }
.sr-item { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35em; }
.sr-name { flex: 1 1 8em; min-width: 6em; }
.sr-area { flex: 1 1 12em; min-width: 8em; }
.sr-custom { flex: 1 1 8em; min-width: 6em; }
.sr-btns { display: flex; gap: 0.2em; }
.num { font-family: ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; }
</style>
