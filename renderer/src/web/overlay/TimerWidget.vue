<!--
  2026-11-09:計時器(移植 APT `stopwatch/WidgetTimer.vue` 的計時規則與外觀,MIT;狀態在 `timer-state.ts` `appTimer`)。
  - 平常點擊穿透(pointer-events: none),只顯示時間;懸浮選單開著(prop `interactive`)時可拖曳、出現開始 / 暫停、歸零按鈕。
  - 位置存設定 `timerPos`(overlay 比例;放開才寫,顯示時夾回畫面);null = 畫面上方中間。
  - 顯示時機 `timerDisplay`:active / always / off(`timerVisible`);顯示中寫 `overlayLayers.timer`(30.4 閒置隱藏不吃掉)。
  不送任何輸入。
-->
<template>
  <div v-if="visible" ref="el" class="tm" :class="{ movable: interactive, dragging }" :style="{ left: place.left + 'px', top: place.top + 'px' }"
    data-timer="widget" :title="interactive ? t('ppz.timer.drag') : undefined"
    @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
    <span class="tm-time num">{{ text }}</span>
    <span v-if="!appTimer.running" class="tm-paused">{{ t('ppz.timer.paused') }}</span>
    <span v-if="interactive" class="tm-ctrl">
      <button type="button" class="tm-btn" data-action="timer-toggle" :aria-label="t(appTimer.running ? 'ppz.timer.pause' : 'ppz.timer.start')"
        @pointerdown.stop @click="appTimer.toggle()">
        <i :class="appTimer.running ? 'fas fa-pause' : 'fas fa-play'" aria-hidden="true"></i>
      </button>
      <button type="button" class="tm-btn" data-action="timer-reset" :aria-label="t('ppz.timer.reset')" @pointerdown.stop @click="appTimer.reset()">
        <i class="fas fa-redo" aria-hidden="true"></i>
      </button>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '../Config'
import { appTimer, formatHms, timerVisible } from './timer-state'
import { overlayLayers } from './overlay-content'
import { overlayPlace, overlayPosOf } from './float-menu-geom'

const props = defineProps<{ interactive: boolean }>()
const { t } = useI18n()
const config = AppConfig()

// 只在跑著時每秒更新(停著不開計時器)
const now = shallowRef(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
watch(() => appTimer.running, (on) => {
  if (tick) clearInterval(tick)
  tick = on ? setInterval(() => { now.value = Date.now() }, 1000) : null
  now.value = Date.now()
}, { immediate: true })

const elapsed = computed(() => { void now.value; void appTimer.acc; void appTimer.since; return appTimer.elapsedMs() })
const text = computed(() => formatHms(elapsed.value))
const visible = computed(() => timerVisible(config.timerDisplay, appTimer.running, elapsed.value))
watch(visible, (v) => { overlayLayers.timer = v }, { immediate: true })

const view = shallowRef({ w: window.innerWidth, h: window.innerHeight })
const onResize = () => { view.value = { w: window.innerWidth, h: window.innerHeight } }
window.addEventListener('resize', onResize)

const el = shallowRef<HTMLElement | null>(null)
const size = shallowRef({ w: 140, h: 40 })
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
// 選單收起 → 中止拖曳、不寫設定
watch(() => props.interactive, (on) => { if (!on) { dragging.value = false; draft.value = null } })

onUnmounted(() => {
  if (tick) clearInterval(tick)
  ro?.disconnect()
  window.removeEventListener('resize', onResize)
  overlayLayers.timer = false
})
</script>

<style scoped>
.tm {
  position: fixed;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 0.5em;
  padding: 0.25em 0.6em;
  border-radius: 0.4em;
  background: color-mix(in srgb, var(--surface-0-c, #1d1d1d) 55%, transparent);
  color: #fff;
  pointer-events: none;
  user-select: none;
}
.tm.movable { pointer-events: auto; cursor: grab; outline: 1px dashed color-mix(in srgb, var(--gold, #c9a14a) 70%, transparent); }
.tm.movable.dragging { cursor: grabbing; }
.tm-time {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 2em;
  line-height: 1;
  text-shadow: 0 1px 3px rgb(0 0 0);
}
.tm-paused {
  align-self: flex-start;
  padding: 0 0.4em;
  border-radius: 0.3em;
  background: #c2410c;
  color: #fff;
  font-size: 0.8em;
  line-height: 1.4;
}
.tm-ctrl { display: flex; gap: 0.25em; }
.tm-btn {
  width: 2em;
  height: 2em;
  border-radius: 0.3em;
  background: rgb(29 29 29 / 0.86);
  color: #fff;
  line-height: 1;
}
.tm-btn:hover { background: rgb(60 60 60 / 0.9); }
</style>
