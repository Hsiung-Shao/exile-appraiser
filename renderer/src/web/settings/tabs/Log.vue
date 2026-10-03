<!--
  設定 › 記錄(第 28 步):直接在設定頁看 main 的記錄(main console + renderer 轉印的 `[renderer]` / `[renderer-error]` 行)。
  - 資料:IPC `log-get` 取快照(main 常駐環形緩衝最近約 3000 行,不依賴 `--ppz-log-file`);Electron 視窗另送 `log-subscribe`
    讓 main 把 `log-lines` 即時追加(~200 ms 一批;只在這個分頁開著才送)。瀏覽器預覽收不到事件 → 每 2 秒用 `sinceSeq` 輪詢。
  - 虛擬捲動(../../virtual-window.ts):等寬字型、單行列,列高依設定視窗有效字級(useSettingsFs)算成整數 px。
  - 篩選(log-view.ts 純函式):全部 / 錯誤 / OCR / 查價 / 熱鍵 + 關鍵字;自動捲到底(往上捲暫停,捲回底部恢復)。
  - 按鈕:複製目前篩選結果、開啟記錄資料夾(只有 Electron 視窗)、清除畫面(只清畫面,不刪檔;模組層級記住,切分頁不復原)。
  - 錯誤行(error 等級 / `[renderer-error]` / 含 failed、失敗、Error)用 --bad 上色,warn 等級用 --warn。
  - 隱私:記錄只存本機(userData/logs),不自動上傳;要回報問題時自己複製貼上。
  - 第 29 步:頂端「效能」區(PerfSection.vue:效能診斷開關 + 最近一筆摘要 + 開 perf 記錄檔;只有 Electron 視窗)。
-->
<template>
  <section class="log-view" data-log="view">
    <PerfSection v-if="canPerf" />
    <div class="lg-bar">
      <div class="seg" role="group" :aria-label="t('ppz.log.filter')">
        <button v-for="f in filters" :key="f" type="button" :class="{ on: filter === f }" :data-filter="f" :aria-pressed="filter === f"
          @click="setFilter(f)">{{ t(`ppz.log.filter_${f}`) }}</button>
      </div>
      <input v-model.trim="keyword" class="input sm lg-search" type="search" data-setting="log-search"
        :placeholder="t('ppz.log.search')" spellcheck="false">
    </div>
    <div class="lg-bar">
      <button class="btn sm" type="button" data-action="log-copy" :disabled="!filtered.length" @click="copy">{{ t('ppz.log.copy') }}</button>
      <button v-if="canOpenFolder" class="btn ghost sm" type="button" data-action="log-open-folder" @click="openFolder">{{ t('ppz.log.open_folder') }}</button>
      <button class="btn ghost sm" type="button" data-action="log-clear" :disabled="!entries.length" @click="clear">{{ t('ppz.log.clear') }}</button>
      <span class="grow" />
      <button v-if="!stick" class="btn ghost sm lg-paused" type="button" data-action="log-resume" :title="t('ppz.log.paused_tip')"
        @click="resume">{{ t('ppz.log.paused') }}</button>
      <span class="lg-count" data-log="count">{{ t('ppz.log.count', { shown: filtered.length, total: entries.length }) }}</span>
    </div>
    <p v-if="status" class="lg-status" :class="{ bad: statusBad }" data-log="status">{{ status }}</p>

    <div ref="scroller" class="lg-rows" data-log="rows" :data-count="filtered.length" @scroll="onScroll">
      <div v-if="!filtered.length" class="lg-empty">{{ entries.length ? t('ppz.log.empty_filtered') : t('ppz.log.empty') }}</div>
      <div class="lg-spacer" :style="{ height: `${filtered.length * rowH}px` }">
        <div v-for="w in windowRows" :key="w.e.seq" class="lg-row" role="row"
          :class="[`lv-${w.e.level}`, { err: w.err }]"
          :style="{ top: `${w.pos * rowH}px`, height: `${rowH}px`, lineHeight: `${rowH}px` }"
          :data-seq="w.e.seq" :title="w.e.text">
          <span class="lg-t">{{ w.time }}</span>
          <span class="lg-l">{{ w.lvl }}</span>
          <span class="lg-x">{{ w.line }}</span>
        </div>
      </div>
    </div>
    <p class="lg-foot">{{ t('ppz.log.privacy') }}</p>
  </section>
</template>

<script lang="ts">
/** 清除畫面:只清畫面不刪檔;記住清到哪一筆(seq),切分頁 / 重開設定後也不會把舊的又載回來 */
let clearedUpTo = 0
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogEntry } from '@ipc/types'
import { Host } from '@/web/background/IPC'
import { useSettingsFs } from '@/web/settings/settings-fs'
import PerfSection from './PerfSection.vue'
import { rafThrottle, windowEndIdx, windowStartIdx } from '../../virtual-window'
import {
  LOG_FILTERS, filterLogEntries, formatLogText, isAtBottom, isErrorLine, logTime, mergeLogEntries, oneLine, type LogFilterId
} from '../log-view'

const OVERSCAN = 12
const POLL_MS = 2000

const { t } = useI18n()
const filters = LOG_FILTERS
const filter = ref<LogFilterId>('all')
const keyword = ref('')
const entries = shallowRef<LogEntry[]>([])
const filtered = computed(() => filterLogEntries(entries.value, filter.value, keyword.value))
const canOpenFolder = Host.canOpenLogFolder
const canPerf = Host.canPerf

const scroller = ref<HTMLElement | null>(null)
const scrollTop = shallowRef(0)
const viewH = shallowRef(360)
/** true = 自動捲到底;使用者往上捲 → false,捲回底部恢復 */
const stick = ref(true)

const settingsFs = useSettingsFs()
// 單行:字級 -1(--fs-sm)× 1.45 + 上下留白,釘死整數 px(獨立字級一變 rowH 跟著重算)
const rowH = computed(() => Math.ceil(((settingsFs.fs.value || 13) - 1) * 1.45) + 4)

const startIdx = computed(() => windowStartIdx(scrollTop.value, rowH.value, OVERSCAN))
const endIdx = computed(() => windowEndIdx(scrollTop.value, viewH.value, rowH.value, OVERSCAN, filtered.value.length))
const windowRows = computed(() => {
  const list = filtered.value
  const out: Array<{ pos: number, e: LogEntry, err: boolean, time: string, lvl: string, line: string }> = []
  for (let pos = startIdx.value, end = endIdx.value; pos < end; pos++) {
    const e = list[pos]
    out.push({ pos, e, err: isErrorLine(e), time: logTime(e.ts), lvl: e.level === 'warn' ? 'WARN' : e.level === 'error' ? 'ERR' : 'INFO', line: oneLine(e.text) })
  }
  return out
})

function measure () {
  const el = scroller.value
  if (!el) return
  viewH.value = el.clientHeight || 360
  scrollTop.value = el.scrollTop
}
const onScrollRaw = rafThrottle(() => {
  const el = scroller.value
  if (!el) return
  measure()
  stick.value = isAtBottom(el.scrollTop, el.clientHeight, el.scrollHeight)
})
function onScroll () { onScrollRaw() }
let ro: ResizeObserver | null = null
watch(scroller, (el) => {
  ro?.disconnect()
  if (!el) return
  ro = new ResizeObserver(measure)
  ro.observe(el)
  measure()
})

async function toBottom () {
  await nextTick()
  const el = scroller.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  measure()
}
function resume () { stick.value = true; void toBottom() }
function setFilter (f: LogFilterId) { filter.value = f }
// 新資料 / 換篩選:停在底部的話跟到最底;換篩選 / 關鍵字一律回到底部(最新的在那)
watch(() => filtered.value.length, () => { if (stick.value) void toBottom() })
watch([filter, keyword], () => { stick.value = true; void toBottom() })

// ---- 資料 ----
function append (list: readonly LogEntry[]) {
  const fresh = clearedUpTo > 0 ? list.filter(e => e.seq > clearedUpTo) : list
  if (fresh.length) entries.value = mergeLogEntries(entries.value, fresh)
}
async function load (since?: number) {
  try {
    const snap = await Host.getLog(since && since > 0 ? since : clearedUpTo || undefined)
    append(snap.entries)
  } catch (e) {
    console.warn('[log] 讀取記錄失敗', e)
  }
}

let off: (() => void) | null = null
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  if (Host.logIsPolled) {
    // 預覽端:收不到事件 → 輪詢(只取比目前最後一筆新的)
    timer = setInterval(() => { void load(entries.value.length ? entries.value[entries.value.length - 1].seq : undefined) }, POLL_MS)
  } else {
    // 先訂閱再取快照:兩者中間送出的行由 seq 去重
    off = Host.onLogLines(append)
    Host.logSubscribe(true)
  }
  void load().then(() => toBottom())
})
onBeforeUnmount(() => {
  if (!Host.logIsPolled) Host.logSubscribe(false)
  off?.()
  if (timer) clearInterval(timer)
  ro?.disconnect()
  onScrollRaw.cancel()
  if (statusTimer) clearTimeout(statusTimer)
})

// ---- 按鈕 ----
const status = ref('')
const statusBad = ref(false)
let statusTimer: ReturnType<typeof setTimeout> | null = null
function say (msg: string, bad = false) {
  status.value = msg
  statusBad.value = bad
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { status.value = '' }, 4000)
}

async function writeClipboard (text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 沒有焦點 / 權限時的備援
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    if (!ok) throw new Error('copy failed')
  }
}
async function copy () {
  const list = filtered.value
  if (!list.length) return
  try {
    await writeClipboard(formatLogText(list))
    say(t('ppz.log.copied', { n: list.length }))
  } catch (e) {
    say(t('ppz.log.copy_failed'), true)
    console.warn('[log] 複製記錄失敗', e)
  }
}
async function openFolder () {
  try { await Host.openLogFolder() } catch (e) {
    say(t('ppz.log.open_failed'), true)
    console.warn('[log] 開啟記錄資料夾失敗', e)
  }
}
function clear () {
  const last = entries.value.length ? entries.value[entries.value.length - 1].seq : 0
  if (last > clearedUpTo) clearedUpTo = last
  entries.value = []
  stick.value = true
  if (scroller.value) scroller.value.scrollTop = 0
  scrollTop.value = 0
}
</script>

<style>
.settings-panel .log-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.log-view .lg-bar {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.log-view .lg-bar .grow { flex: 1; }
.log-view .lg-search { flex: 1; min-width: 8em; max-width: calc(var(--fs-base) * 22); }
.log-view .lg-count { font-size: var(--fs-2xs); color: var(--ink-3); white-space: nowrap; }
.log-view .lg-paused { color: var(--warn); }
.log-view .lg-status { margin: 0; font-size: var(--fs-xs); color: var(--ink-2); }
.log-view .lg-status.bad { color: var(--bad); }
.log-view .lg-foot { margin: 0; flex-shrink: 0; font-size: var(--fs-2xs); color: var(--ink-3); }
.log-view .lg-rows {
  position: relative;
  flex: 1;
  min-height: 80px;
  overflow-y: auto;
  border: 1px solid var(--edge-0);
  border-radius: var(--radius-m);
  background: var(--surface-1);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
}
.log-view .lg-spacer { position: relative; }
.log-view .lg-empty { padding: 16px; color: var(--ink-3); font-family: inherit; font-size: var(--fs-sm); }
.log-view .lg-row {
  position: absolute;
  left: 0;
  right: 0;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 12ch 4ch minmax(0, 1fr);
  column-gap: 12px;
  padding: 0 8px;
  color: var(--ink-1);
  white-space: nowrap;
}
.log-view .lg-row:hover { background: var(--surface-hover); }
.log-view .lg-t { color: var(--ink-3); }
.log-view .lg-l { color: var(--ink-3); }
.log-view .lg-x { overflow: hidden; text-overflow: ellipsis; }
.log-view .lg-row.lv-warn .lg-l,
.log-view .lg-row.lv-warn .lg-x { color: var(--warn); }
.log-view .lg-row.err { background: color-mix(in srgb, var(--bad) 10%, transparent); }
.log-view .lg-row.err .lg-l,
.log-view .lg-row.err .lg-x { color: var(--bad); }
</style>
