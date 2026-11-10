<!--
  計時器(2026-11-09 移植 APT 碼表;2026-11-10 改成 speedrun 式,版面參考 LiveSplit):
  路線名 + 嘗試次數 → 分段列(名稱 | 與個人最佳差值 | 累計時間;沒跑到的段顯示 PB 時間)→ 大字主計時 → 本段 / 上一段差值。
  顏色:領先綠(--ok)、落後紅(--bad)、金段 / 新個人最佳金色(--gold)、暫停 / 尚未開始灰。
  - 平常點擊穿透,只顯示;懸浮選單開著(prop `interactive`)時可拖曳、出現 開始 / 分段、暫停、重設 按鈕。
  - 位置 `timerPos`(overlay 比例;放開才寫);null = 畫面上方中間。顯示時機 `timerDisplay`(`timerVisible`)。
  - 回報遮罩外框給 OCR(scan-mask 來源 timer)、顯示中寫 `overlayLayers.timer`(30.4 閒置隱藏)。
  - 只在跑著時每 50 ms 更新畫面(停著 / 暫停不開計時器)。不送任何輸入。
-->
<template>
  <div v-if="visible" ref="el" class="tm" :class="{ movable: interactive, dragging }" :style="{ left: place.left + 'px', top: place.top + 'px' }"
    data-timer="widget" :title="interactive ? t('ppz.timer.drag') : undefined"
    @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
    <div class="tm-head">
      <span class="tm-title">{{ t(config.game === 'poe2' ? 'ppz.timer.route_poe2' : 'ppz.timer.route_poe1') }}</span>
      <span class="tm-att num">#{{ route.attempts }}</span>
    </div>
    <ol class="tm-rows">
      <li v-for="r in rows" :key="r.i" class="tm-row" :class="{ cur: r.current, done: r.done }" :data-split="r.i">
        <span class="tm-name">{{ r.name }}</span>
        <span class="tm-delta num" :class="r.deltaTone">{{ r.delta }}</span>
        <span class="tm-time num">{{ r.time }}</span>
      </li>
    </ol>
    <div class="tm-main num" :class="mainTone" data-timer="main">{{ formatRunTime(elapsed) }}</div>
    <div class="tm-sub">
      <span>{{ t('ppz.timer.segment') }} <b class="num">{{ formatRunTime(segmentNow) }}</b></span>
      <span v-if="prevSegDelta != null">{{ t('ppz.timer.prev_segment') }} <b class="num" :class="prevSegDelta <= 0 ? 'ok' : 'bad'">{{ formatDelta(prevSegDelta) }}</b></span>
    </div>
    <div v-if="run.phase === 'idle' && !interactive" class="tm-hint">{{ t('ppz.timer.start_hint') }}</div>
    <div v-if="interactive" class="tm-ctrl">
      <button type="button" class="tm-btn" data-action="timer-toggle" :aria-label="t('ppz.timer.menu_toggle')" :title="t('ppz.timer.menu_toggle')"
        @pointerdown.stop @click="timerAction('toggle')"><i class="fas fa-play" aria-hidden="true"></i></button>
      <button type="button" class="tm-btn" data-action="timer-pause" :aria-label="t('ppz.timer.menu_pause')" :title="t('ppz.timer.menu_pause')"
        @pointerdown.stop @click="timerAction('pause')"><i class="fas fa-pause" aria-hidden="true"></i></button>
      <button type="button" class="tm-btn" data-action="timer-reset" :aria-label="t('ppz.timer.menu_reset')" :title="t('ppz.timer.menu_reset')"
        @pointerdown.stop @click="timerAction('reset')"><i class="fas fa-redo" aria-hidden="true"></i></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '../Config'
import { appRun, currentRoute, timerAction, timerVisible } from './timer-state'
import { overlayLayers } from './overlay-content'
import { overlayPlace, overlayPosOf } from './float-menu-geom'
import { Host } from '../background/IPC'
import { deltaAt, formatDelta, formatRunTime, isGoldSegment, segmentTime } from '../../../../core/src/speedrun/run'

const props = defineProps<{ interactive: boolean }>()
const { t } = useI18n()
const config = AppConfig()

const run = computed(() => appRun.value)
const route = computed(() => currentRoute())

// 只在跑著時每 50 ms 更新(停著不開計時器)
const now = shallowRef(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
watch(() => run.value.phase, (phase) => {
  if (tick) clearInterval(tick)
  tick = phase === 'running' ? setInterval(() => { now.value = Date.now() }, 50) : null
  now.value = Date.now()
}, { immediate: true })

const elapsed = computed(() => { void now.value; void run.value.phase; void run.value.index; return run.value.elapsed() })
/** 目前段之前最後一個有時間的累計(跳過的段不算) */
const lastSplitTime = computed(() => {
  for (let i = run.value.index - 1; i >= 0; i--) { const v = run.value.splitTimes[i]; if (v != null) return v }
  return 0
})
const segmentNow = computed(() => run.value.phase === 'finished' ? 0 : Math.max(0, elapsed.value - lastSplitTime.value))

/** 上一段比個人最佳那一段快多少(負 = 快) */
const prevSegDelta = computed(() => {
  const i = run.value.index - 1
  const pb = route.value.pb
  if (i < 0 || !pb) return null
  const seg = segmentTime(run.value, i)
  const pbSeg = pb[i] == null ? null : i === 0 ? pb[0] : pb[i - 1] == null ? null : pb[i]! - pb[i - 1]!
  return seg == null || pbSeg == null ? null : seg - pbSeg
})

const rows = computed(() => {
  const r = run.value
  const rt = route.value
  const n = rt.splits.length
  const want = Math.min(n, config.speedrunRows)
  // 目前段放在倒數第二列(LiveSplit 慣例,看得到下一段)
  const first = Math.max(0, Math.min(n - want, r.index - Math.max(0, want - 2)))
  return rt.splits.slice(first, first + want).map((s, k) => {
    const i = first + k
    const done = i < r.index
    const current = i === r.index && r.phase !== 'idle' && r.phase !== 'finished'
    let delta = ''
    let deltaTone = ''
    if (done) {
      const d = deltaAt(r, rt, i)
      // 金段 / PB 在重設時才結算 → 這裡跟路線上的舊紀錄比
      const gold = isGoldSegment(r, rt, i)
      if (d != null) { delta = formatDelta(d); deltaTone = gold ? 'gold' : d <= 0 ? 'ok' : 'bad' } else if (gold) { delta = '★'; deltaTone = 'gold' }
    } else if (current) {
      // 跑著的段:比個人最佳慢了才顯示即時差值
      const pb = rt.pb?.[i]
      if (pb != null && elapsed.value > pb) { delta = formatDelta(elapsed.value - pb); deltaTone = 'bad' }
    }
    const t0 = done ? r.splitTimes[i] : rt.pb?.[i] ?? null
    return { i, name: s.name, done, current, delta, deltaTone, time: t0 == null ? '—' : formatRunTime(t0) }
  })
})

const mainTone = computed(() => {
  const r = run.value
  if (r.phase === 'idle' || r.phase === 'paused') return 'muted'
  const pb = route.value.pb
  if (r.phase === 'finished') {
    const total = r.splitTimes[r.splitTimes.length - 1]
    const pbTotal = pb?.[pb.length - 1]
    // 新個人最佳(比舊 PB 快或還沒有 PB)金色;慢了紅色
    return total == null ? 'ok' : pbTotal == null || total < pbTotal ? 'gold' : total > pbTotal ? 'bad' : 'ok'
  }
  const target = pb?.[r.index]
  return target != null && elapsed.value > target ? 'bad' : 'ok'
})

const visible = computed(() => timerVisible(config.timerDisplay, run.value.phase !== 'idle', elapsed.value))
watch(visible, (v) => { overlayLayers.timer = v }, { immediate: true })

const view = shallowRef({ w: window.innerWidth, h: window.innerHeight })
const onResize = () => { view.value = { w: window.innerWidth, h: window.innerHeight } }
window.addEventListener('resize', onResize)

const el = shallowRef<HTMLElement | null>(null)
const size = shallowRef({ w: 220, h: 160 })
const measure = () => {
  const r = el.value?.getBoundingClientRect?.()
  if (r && r.width > 0 && r.height > 0 && (r.width !== size.value.w || r.height !== size.value.h)) size.value = { w: r.width, h: r.height }
}
let ro: ResizeObserver | null = null
watch(el, (node) => {
  ro?.disconnect()
  ro = null
  if (!node) return
  measure()
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(node) }
}, { flush: 'post' })

// 拖曳:草稿 > 存的位置 > 上方中間預設;放開才寫設定
const draft = shallowRef<{ left: number, top: number } | null>(null)
const dragging = shallowRef(false)
let grab = { dx: 0, dy: 0, id: -1 }
const place = computed(() => draft.value ??
  overlayPlace(config.timerPos, view.value, size.value, { left: (view.value.w - size.value.w) / 2, top: Math.round(view.value.h * 0.06) }))
function onDown (e: PointerEvent) {
  if (!props.interactive || e.button !== 0) return
  measure()
  grab = { dx: e.clientX - place.value.left, dy: e.clientY - place.value.top, id: e.pointerId }
  dragging.value = true
  try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { /* 合成事件沒有對應的指標 */ }
  e.preventDefault()
}
function onMove (e: PointerEvent) {
  if (!dragging.value || e.pointerId !== grab.id) return
  const v = view.value
  draft.value = overlayPlace({ x: (e.clientX - grab.dx) / Math.max(1, v.w), y: (e.clientY - grab.dy) / Math.max(1, v.h) }, v, size.value, { left: 0, top: 0 })
}
function onUp (e: PointerEvent) {
  if (!dragging.value || e.pointerId !== grab.id) return
  dragging.value = false
  if (draft.value) {
    config.timerPos = overlayPosOf(draft.value, view.value, size.value)
    console.log(`[timer] 移到 ${config.timerPos.x}, ${config.timerPos.y}`)
  }
  draft.value = null
}
// OCR 擷取會截到 overlay 自己:回報外框當遮罩(main 填掉、差分也不比 → 計時器換字不觸發 OCR)
let maskKey = ''
function reportMask () {
  const r = visible.value ? el.value?.getBoundingClientRect?.() : undefined
  const rects = r && r.width > 0 && r.height > 0 ? [{ x: r.left, y: r.top, w: r.width, h: r.height }] : []
  const viewport = { w: view.value.w, h: view.value.h }
  const key = JSON.stringify([viewport, rects])
  if (key === maskKey) return
  maskKey = key
  Host.scanMask({ source: 'timer', viewport, rects })
}
watch([visible, place, size, view], reportMask, { flush: 'post', immediate: true })

// 選單收起 → 中止拖曳、不寫設定
watch(() => props.interactive, (on) => { if (!on) { dragging.value = false; draft.value = null } })

onUnmounted(() => {
  if (tick) clearInterval(tick)
  ro?.disconnect()
  window.removeEventListener('resize', onResize)
  overlayLayers.timer = false
  if (maskKey) Host.scanMask({ source: 'timer', viewport: { w: view.value.w, h: view.value.h }, rects: [] })
})
</script>

<style scoped>
.tm {
  position: fixed;
  z-index: 40;
  width: 17em;
  padding: 0.45em 0.6em 0.5em;
  border-radius: 0.45em;
  background: color-mix(in srgb, #0b0d10 72%, transparent);
  color: #f2efe6;
  pointer-events: none;
  user-select: none;
  font-size: var(--fs-sm, 13px);
}
.tm.movable { pointer-events: auto; cursor: grab; outline: 1px dashed color-mix(in srgb, var(--gold, #c9a14a) 70%, transparent); }
.tm.movable.dragging { cursor: grabbing; }
.num { font-family: ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; }
.tm-head { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 0.25em; border-bottom: 1px solid rgb(255 255 255 / 0.12); }
.tm-title { font-weight: 600; }
.tm-att { opacity: 0.6; }
.tm-rows { list-style: none; margin: 0.2em 0 0; padding: 0; }
.tm-row { display: grid; grid-template-columns: 1fr auto 4.6em; gap: 0.5em; padding: 0.12em 0.3em; border-radius: 0.25em; }
.tm-row.cur { background: rgb(80 120 200 / 0.35); }
.tm-row:not(.done):not(.cur) .tm-time { opacity: 0.55; }
.tm-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-time { text-align: right; }
.tm-delta { text-align: right; min-width: 3.4em; }
.tm-main { font-size: 2.6em; line-height: 1.1; text-align: right; font-weight: 700; margin-top: 0.15em; text-shadow: 0 1px 3px rgb(0 0 0); }
.tm-sub { display: flex; justify-content: space-between; gap: 0.6em; opacity: 0.85; font-size: 0.92em; }
.tm-hint { margin-top: 0.3em; font-size: 0.85em; opacity: 0.7; }
.ok { color: var(--ok, #4fbf6a); }
.bad { color: var(--bad, #e05a4f); }
.gold { color: var(--gold, #d8aa4b); }
.muted { color: #9aa0a6; }
.tm-ctrl { display: flex; justify-content: flex-end; gap: 0.3em; margin-top: 0.35em; }
.tm-btn { width: 2em; height: 2em; border-radius: 0.3em; background: rgb(29 29 29 / 0.86); color: #fff; line-height: 1; }
.tm-btn:hover { background: rgb(60 60 60 / 0.9); }
</style>
