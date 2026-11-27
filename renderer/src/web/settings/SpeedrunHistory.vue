<!--
  設定 › 計時器 › 紀錄(2026-11-28 使用者要求):目前遊戲路線的每次嘗試(core `speedrun/history.ts`)。
  新到舊列出;名稱空白 = 日期時間,可直接改;比較(計時器差值改跟這筆比)/ 設為個人最佳 / 刪除 / 展開各段。
  分段結構不同的舊紀錄只能看和刪。計時中不能設 PB(進行中的這次會用開始時的快照把 PB 寫回去);進行中的那一筆不能刪。
  尺寸只用 em / --fs-*(設定視窗獨立字級)。
-->
<template>
  <div class="sh" data-setting="speedrun-history">
    <div class="sh-head">
      <span class="k">{{ t('ppz.timer.history') }}</span>
      <span class="note">{{ t('ppz.timer.history_count', { n: route.history.length }) }}</span>
    </div>
    <p v-if="!route.history.length" class="note">{{ t('ppz.timer.history_empty') }}</p>
    <ol v-else class="sh-list">
      <li v-for="rec in shown" :key="rec.id" class="sh-item" :class="{ cmp: route.compare === rec.id }" :data-record="rec.id">
        <div class="sh-row">
          <input class="input sm sh-name" :value="rec.name" :placeholder="recordLabel({ ...rec, name: '' })" maxlength="60" spellcheck="false"
            :aria-label="t('ppz.timer.history_name')" data-setting="record-name" @change="rec.name = ($event.target as HTMLInputElement).value.trim()">
          <span class="sh-total num">{{ totalText(rec) }}</span>
          <span class="sh-tags">
            <span v-if="isLive(rec)" class="tag">{{ t('ppz.timer.history_live') }}</span>
            <span v-if="isPb(rec)" class="tag gold">PB</span>
            <span v-if="rec.partial" class="tag">{{ t('ppz.timer.history_partial') }}</span>
            <span v-if="!compatible(rec, route)" class="tag warn">{{ t('ppz.timer.history_mismatch') }}</span>
          </span>
        </div>
        <div class="sh-row sh-btns">
          <span class="note sh-date">{{ dateText(rec) }}</span>
          <button class="btn ghost sm" :aria-expanded="open === rec.id" data-action="record-details" @click="open = open === rec.id ? null : rec.id">{{ t('ppz.timer.history_details') }}</button>
          <button class="btn sm" :class="route.compare === rec.id ? 'primary' : 'ghost'" :disabled="!compatible(rec, route) || isLive(rec)" :aria-pressed="route.compare === rec.id"
            data-action="record-compare" @click="route.compare = route.compare === rec.id ? null : rec.id">{{ t(route.compare === rec.id ? 'ppz.timer.history_comparing' : 'ppz.timer.history_compare') }}</button>
          <button class="btn ghost sm" :disabled="!canSetPb(rec)" :title="pbBlock(rec)" data-action="record-set-pb" @click="setPb(rec.id)">{{ t('ppz.timer.history_set_pb') }}</button>
          <template v-if="deleting !== rec.id">
            <button class="btn ghost sm" :disabled="isLive(rec)" data-action="record-delete" @click="deleting = rec.id">{{ t('ppz.timer.history_delete') }}</button>
          </template>
          <template v-else>
            <button class="btn sm primary" data-action="record-delete-confirm" @click="remove(rec.id)">{{ t('ppz.timer.history_delete_confirm') }}</button>
            <button class="btn ghost sm" @click="deleting = null">{{ t('ppz.timer.cancel') }}</button>
          </template>
        </div>
        <table v-if="open === rec.id" class="sh-splits num">
          <tr v-for="(v, i) in rec.splitTimes" :key="i">
            <td class="sh-sn">{{ splitName(rec, i) }}</td>
            <td>{{ v == null ? '—' : formatRunTime(v) }}</td>
            <td class="sh-seg">{{ segText(rec, i) }}</td>
          </tr>
        </table>
      </li>
    </ol>
    <button v-if="route.history.length > limit" class="btn ghost sm" data-action="records-more" @click="limit += 20">{{ t('ppz.timer.history_more', { n: route.history.length - limit }) }}</button>
    <p v-if="notice" class="note" role="status">{{ notice }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '@/web/Config'
import { compatible, deleteRecord, recordLabel, setPbFromRecord, type RunRecord } from '../../../../core/src/speedrun/history'
import { formatRunTime, segmentTime } from '../../../../core/src/speedrun/run'
import { appRun } from '@/web/overlay/timer-state'

const { t } = useI18n()
const config = AppConfig()
const route = computed(() => config.speedrun[config.game])
const limit = shallowRef(20)
const open = shallowRef<string | null>(null)
const deleting = shallowRef<string | null>(null)
const notice = shallowRef('')
const shown = computed(() => route.value.history.slice().reverse().slice(0, limit.value))

const running = computed(() => appRun.value.phase !== 'idle')
const isLive = (rec: RunRecord) => running.value && appRun.value.attemptId === rec.id
const isPb = (rec: RunRecord) => {
  const pb = route.value.pb
  return rec.finished && pb != null && pb.length === rec.splitTimes.length && pb.every((v, i) => v === rec.splitTimes[i])
}
const pbBlock = (rec: RunRecord): string => {
  if (!rec.finished) return t('ppz.timer.history_pb_unfinished')
  if (rec.partial) return t('ppz.timer.history_pb_partial')
  if (!compatible(rec, route.value)) return t('ppz.timer.history_mismatch')
  if (running.value) return t('ppz.timer.history_pb_running')
  return ''
}
const canSetPb = (rec: RunRecord) => !pbBlock(rec) && !isPb(rec)
function setPb (id: string) {
  if (running.value) return
  notice.value = setPbFromRecord(route.value, id) ? t('ppz.timer.history_pb_done') : ''
}
function remove (id: string) {
  deleteRecord(route.value, id)
  deleting.value = null
  if (open.value === id) open.value = null
}

function totalText (rec: RunRecord): string {
  if (rec.finished) return formatRunTime(rec.splitTimes[rec.splitTimes.length - 1] ?? 0)
  return t('ppz.timer.history_unfinished', { n: rec.splitTimes.filter(v => v != null).length, m: rec.splitTimes.length })
}
const dateText = (rec: RunRecord) => new Date(rec.at).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const splitName = (rec: RunRecord, i: number) => compatible(rec, route.value) ? route.value.splits[i]?.name ?? `#${i + 1}` : `#${i + 1}`
function segText (rec: RunRecord, i: number): string {
  const s = segmentTime(rec, i)
  return s == null ? '' : formatRunTime(s)
}
</script>

<style scoped>
.sh { display: flex; flex-direction: column; gap: 0.4em; margin-top: 0.6em; }
.sh-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0.5em; }
.sh-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35em; }
.sh-item { display: flex; flex-direction: column; gap: 0.25em; padding: 0.4em 0.5em; border: 1px solid var(--edge-1); border-radius: var(--radius-s); background: var(--surface-2); }
.sh-item.cmp { border-color: var(--gold); }
.sh-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35em; }
.sh-name { flex: 1 1 10em; min-width: 7em; }
.sh-total { min-width: 6em; text-align: right; }
.sh-tags { display: flex; gap: 0.25em; }
.tag { font-size: var(--fs-2xs); padding: 0.05em 0.45em; border-radius: 999px; border: 1px solid var(--edge-1); color: var(--ink-2); }
.tag.gold { border-color: var(--gold); color: var(--gold); }
.tag.warn { color: var(--bad, var(--ink-2)); }
.sh-date { margin-right: auto; font-size: var(--fs-xs); }
.sh-splits { border-collapse: collapse; font-size: var(--fs-xs); }
.sh-splits td { padding: 0.1em 0.8em 0.1em 0; }
.sh-sn { color: var(--ink-2); }
.sh-seg { color: var(--ink-2); }
.num { font-family: ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; }
</style>
