<!--
  2026-10-08:APT 式懸浮選單(使用者要求;設計稿 https://claude.ai/artifact/NWGyMPAi5f14ofJ3tA65Pp C 板)。
  overlay 模式按 overlayKey(沒有物品時)叫出,取代原本直接開設定;點「設定」才開設定視窗(設定開著時選單仍在最上層)。
  - 標題列拖曳移動:pointer capture,拖曳中只改畫面,放開才寫設定 `floatMenu`(比例);顯示時夾回畫面(float-menu-geom.ts)。
  - 正則書籤:PoE1 / PoE2 切換(預設目前遊戲),依資料夾分組可收合(與快速面板 / 管理頁共用收合狀態),每列顯示字串預覽;
    目前遊戲 = 點一下貼進遊戲(`runRegexBookmark(…, 'menu')`,貼上了 = 選單收起),另一代 = 只複製(`copyRegexBookmark`)。
  - 速查表:使用者自己匯入一張圖(`sheet-pick` → userData/cheatsheets,設定 `cheatSheet`);縮圖滑鼠移上去暫時放大(放大框點擊穿透),
    點一下釘住(✕ / Esc 關)。
  - 收起:✕、點選單外(App.vue 背景)、Esc / 再按 overlayKey(main 交還焦點 → focus-change)。
  尺寸只用 em / --fs-*。新增會畫在 overlay 上的東西已接進 overlay-content(`menu`)。
-->
<template>
  <div ref="root" class="fm" :class="{ dragging }" :style="placeStyle" data-layer="float-menu" @pointerdown.stop>
    <div class="fm-head" :title="t('ppz.menu.drag')" data-menu="drag"
      @pointerdown="onDragStart" @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd">
      <svg class="fm-grip" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01" /></svg>
      <i class="mark" />
      <span class="fm-title">{{ t('ppz.menu.title') }}</span>
      <span v-if="overlayKey" class="fm-key num">{{ overlayKey }}</span>
      <button type="button" class="fm-x" :aria-label="t('ppz.menu.close')" :title="t('ppz.menu.close')" data-action="menu-close" @click="emit('close', '✕')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>

    <div class="fm-actions">
      <button type="button" class="fm-act" :class="{ on: settingsOpen }" data-action="menu-settings" @click="emit('settings')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>
        <span>{{ t('ppz.menu.settings') }}</span>
      </button>
      <button type="button" class="fm-act" :class="{ on: section === 'bookmarks' }" :aria-expanded="section === 'bookmarks'" data-action="menu-bookmarks" @click="toggleSection('bookmarks')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
        <span>{{ t('ppz.menu.bookmarks') }}</span>
      </button>
      <button type="button" class="fm-act" :class="{ on: section === 'sheet' }" :aria-expanded="section === 'sheet'" data-action="menu-sheet" @click="toggleSection('sheet')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></svg>
        <span>{{ t('ppz.menu.sheet') }}</span>
      </button>
    </div>

    <!-- 正則書籤 -->
    <div v-if="section === 'bookmarks'" class="fm-sec" data-menu="bookmarks">
      <div class="fm-bm-top">
        <div class="seg fm-seg" role="group">
          <button v-for="g in games" :key="g" type="button" :class="{ on: listGame === g }" :aria-pressed="listGame === g"
            :data-game="g" @click="listGame = g">{{ gameLabel(g) }}</button>
        </div>
        <span class="fm-hint">{{ t(action === 'paste' ? 'ppz.menu.bm_hint_paste' : 'ppz.menu.bm_hint_copy') }}</span>
      </div>
      <div v-if="grouped.groups.length" class="fm-bm-list" data-menu="bm-list">
        <template v-for="g in grouped.groups" :key="g.folder">
          <button v-if="grouped.headers" type="button" class="fm-folder" :aria-expanded="!g.collapsed" data-menu="bm-folder" :data-folder="g.folder"
            @click="toggleFolder(g.folder, !g.collapsed)">
            <span class="fm-caret" aria-hidden="true">{{ g.collapsed ? '▸' : '▾' }}</span>
            <span class="fm-folder-name">{{ g.folder || t('ppz.regex.fd_uncategorized') }}</span>
            <span class="fm-count num">{{ g.items.length }}</span>
          </button>
          <template v-if="!grouped.headers || !g.collapsed">
            <button v-for="it in g.items" :key="it.index" type="button" class="fm-bm" :class="{ nested: grouped.headers }"
              :disabled="running" data-menu="bm-item" :data-bm="it.b.name" @click="runBookmark(it.index)">
              <span class="fm-bm-line">
                <span class="fm-bm-name">{{ it.b.name }}</span>
                <span v-if="it.b.hotkey" class="fm-bm-key num">{{ it.b.hotkey }}</span>
              </span>
              <span class="fm-bm-query" :title="previews[previewKey(it.index)] || undefined">{{ previews[previewKey(it.index)] ?? '…' }}</span>
            </button>
          </template>
        </template>
      </div>
      <p v-else class="fm-empty" data-menu="bm-empty">{{ t('ppz.menu.bm_empty', { game: gameLabel(listGame) }) }}</p>
    </div>

    <!-- 速查表 -->
    <div v-if="section === 'sheet'" class="fm-sec fm-sheet" data-menu="sheet">
      <template v-if="sheetUrl && !sheetBroken">
        <button type="button" class="fm-thumb" :aria-label="t('ppz.menu.sheet_zoom')" data-action="sheet-pin"
          @mouseenter="peek = true" @mouseleave="peek = false" @click="pinned = true">
          <img :src="sheetUrl" alt="" @error="sheetBroken = true">
        </button>
        <p class="fm-hint">{{ t('ppz.menu.sheet_hover_hint') }}</p>
        <div class="fm-sheet-row">
          <span class="fm-sheet-name" data-menu="sheet-name">{{ sheet.builtin ? t('ppz.menu.sheet_builtin', { version: BUILTIN_CHEAT_SHEET.version }) : config.cheatSheet }}</span>
          <button v-if="canPick" type="button" class="btn sm" data-action="sheet-change" @click="pickSheet">{{ t('ppz.menu.sheet_change') }}</button>
          <button v-if="!sheet.builtin" type="button" class="btn ghost sm" data-action="sheet-remove" @click="removeSheet">{{ t('ppz.menu.sheet_remove') }}</button>
        </div>
      </template>
      <div v-else class="fm-sheet-empty" data-menu="sheet-empty">
        <div>{{ t('ppz.menu.sheet_failed') }}</div>
        <div class="fm-hint">{{ t(canPick ? 'ppz.menu.sheet_empty_sub' : 'ppz.menu.sheet_no_dialog') }}</div>
        <button v-if="canPick" type="button" class="btn sm primary" data-action="sheet-import" @click="pickSheet">{{ t('ppz.menu.sheet_import') }}</button>
        <button v-if="!sheet.builtin" type="button" class="btn ghost sm" data-action="sheet-remove" @click="removeSheet">{{ t('ppz.menu.sheet_remove') }}</button>
      </div>
    </div>

    <p v-if="notice" class="fm-notice" data-menu="notice">{{ notice }}</p>
  </div>

  <!-- 速查表放大:hover = 暫時(點擊穿透),點縮圖 = 釘住(標題列 ✕);釘住時拖標題列移動、四邊 / 四角調整大小(放開才寫 cheatSheetZoom) -->
  <div v-if="zoomShown" class="fm-zoom" :class="{ pinned, dragging: zoomLive != null }" :style="zoomStyle" data-layer="sheet-zoom">
    <div class="fm-zoom-head" :class="{ movable: pinned }" data-menu="sheet-zoom-drag" @pointerdown="onZoomHeadDown">
      <span class="fm-zoom-title">{{ t('ppz.menu.sheet_title') }}</span>
      <span class="fm-hint">{{ t(pinned ? 'ppz.menu.sheet_pinned_hint' : 'ppz.menu.sheet_peek_hint') }}</span>
      <button v-if="pinned && config.cheatSheetZoom" type="button" class="fm-x" :aria-label="t('ppz.menu.sheet_reset_size')" :title="t('ppz.menu.sheet_reset_size')"
        data-action="sheet-zoom-reset" @click="resetZoomRect">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6" /><path d="M20 12a8 8 0 1 1-2.3-5.7L4 10" /></svg>
      </button>
      <button v-if="pinned" type="button" class="fm-x" :aria-label="t('ppz.menu.sheet_close')" data-action="sheet-unpin" @click="pinned = false; peek = false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
    <img class="fm-zoom-img" :src="sheetUrl ?? undefined" alt="" draggable="false">
    <template v-if="pinned">
      <div v-for="e in zoomEdges" :key="e" class="fm-rz" :class="'rz-' + e" :data-resize="e" :style="{ cursor: edgeCursor(e) }"
        @pointerdown="beginZoomDrag($event, e)" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RegexGame } from '@exile-appraiser/regex'
import { AppConfig } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import { bgImageUrl, normBgFile } from '@/web/useTheme'
import { bookmarkGroupsOf, gameLabel, setBookmarkFolderCollapsed, useRegexStore } from '@/web/regex/store'
import { copyRegexBookmark, quickRunning, regexBookmarkPreview, runRegexBookmark } from '@/web/regex/quick'
import { quickNoticeKey } from '@/web/regex/quick-geom'
import { BUILTIN_CHEAT_SHEET, bookmarkActionFor, cheatSheetUrl, floatMenuPlace, floatMenuPosOf, sheetZoomRect } from './float-menu-geom'
import { floatMenuSection } from './float-menu-state'
import { RESIZE_EDGES, clampSettingsRect, createRectDrag, edgeCursor, isInteractiveTarget, type DragEdge, type SettingsWindowRect } from '@/web/settings/settings-window-geom'

defineProps<{ settingsOpen: boolean }>()
const emit = defineEmits<{
  (e: 'close', reason: string): void
  (e: 'settings'): void
  (e: 'pasted'): void
  (e: 'zoom', on: boolean): void
}>()

const { t } = useI18n()
const config = AppConfig()
const store = useRegexStore()
const games: RegexGame[] = ['poe1', 'poe2']

const overlayKey = computed(() => config.overlayKey)
const section = floatMenuSection
function toggleSection (s: 'bookmarks' | 'sheet') {
  section.value = section.value === s ? '' : s
  notice.value = ''
}

// ---- 位置 / 拖曳 ----
const root = ref<HTMLElement | null>(null)
const view = reactive({ w: window.innerWidth, h: window.innerHeight })
const size = reactive({ w: 0, h: 0 })
const draft = shallowRef<{ left: number, top: number } | null>(null)
const dragging = shallowRef(false)
let grab = { dx: 0, dy: 0, id: -1 }

const place = computed(() => draft.value ?? floatMenuPlace(config.floatMenu, view, size))
const placeStyle = computed(() => ({ left: `${place.value.left}px`, top: `${place.value.top}px` }))

function onDragStart (e: PointerEvent) {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
  const p = place.value
  grab = { dx: e.clientX - p.left, dy: e.clientY - p.top, id: e.pointerId }
  dragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  e.preventDefault()
}
function onDragMove (e: PointerEvent) {
  if (!dragging.value || e.pointerId !== grab.id) return
  draft.value = floatMenuPlace({ x: (e.clientX - grab.dx) / Math.max(1, view.w), y: (e.clientY - grab.dy) / Math.max(1, view.h) }, view, size)
}
function onDragEnd (e: PointerEvent) {
  if (!dragging.value || e.pointerId !== grab.id) return
  dragging.value = false
  if (draft.value) config.floatMenu = floatMenuPosOf(draft.value, view, size)
  draft.value = null
}

let ro: ResizeObserver | null = null
const onResize = () => { view.w = window.innerWidth; view.h = window.innerHeight }

// ---- 正則書籤 ----
const listGame = shallowRef<RegexGame>(config.game)
const action = computed(() => bookmarkActionFor(listGame.value, config.game))
const grouped = computed(() => bookmarkGroupsOf(listGame.value, true))
const running = quickRunning
const notice = shallowRef('')
const previews = reactive<Record<string, string>>({})
const previewKey = (index: number) => {
  const b = store.ui.bookmarks[index]
  return b ? `${b.game}|${b.page}|${b.name}|${b.keys.join(',')}|${b.mode}|${b.lang}` : `#${index}`
}

/** 看得見的書籤逐筆算字串預覽(清單第一次用到才載;算過的快取在 previews) */
let previewRun = 0
async function loadPreviews () {
  const run = ++previewRun
  for (const g of grouped.value.groups) {
    if (grouped.value.headers && g.collapsed) continue
    for (const it of g.items) {
      const k = previewKey(it.index)
      if (k in previews) continue
      const text = await regexBookmarkPreview(it.index)
      if (run !== previewRun) return
      previews[k] = text
    }
  }
}
watch([section, grouped], () => { if (section.value === 'bookmarks') void loadPreviews() }, { immediate: true })
watch(listGame, () => { notice.value = '' })

function toggleFolder (folder: string, collapse: boolean) {
  setBookmarkFolderCollapsed(listGame.value, folder, collapse)
}

async function runBookmark (index: number) {
  notice.value = ''
  const b = store.ui.bookmarks[index]
  if (!b) return
  if (action.value === 'paste') {
    const o = await runRegexBookmark(index, 'menu')
    if (o.pasted) { emit('pasted'); return }
    const key = quickNoticeKey(o)
    notice.value = key ? t(key) : ''
  } else {
    const o = await copyRegexBookmark(index)
    const key = quickNoticeKey(o)
    notice.value = key ? t(key) : ''
  }
}

// ---- 速查表 ----
const canPick = computed(() => Host.canPickSheet)
const sheetBroken = shallowRef(false)
// 有匯入的用使用者的(app://sheet/ / 預覽 sheet/),否則內建那張(renderer/public/cheatsheets/)
const sheet = computed(() => cheatSheetUrl(bgImageUrl(config.cheatSheet, { electron: Host.isElectron, preview: Host.isPreview, baseURI: document.baseURI }, 'sheet'), document.baseURI))
const sheetUrl = computed(() => sheet.value.url)
watch(() => config.cheatSheet, () => { sheetBroken.value = false })
const peek = shallowRef(false)
const pinned = shallowRef(false)
const zoomShown = computed(() => !!sheetUrl.value && !sheetBroken.value && section.value === 'sheet' && (peek.value || pinned.value))
watch(zoomShown, (on) => { emit('zoom', on) })
// 放大框:拖曳中 = live;存過 = 記住的(夾回畫面);沒存 = 選單旁到畫面邊(sheetZoomRect)
const zoomLive = shallowRef<SettingsWindowRect | null>(null)
const zoomRect = computed<SettingsWindowRect>(() => {
  if (zoomLive.value) return zoomLive.value
  if (config.cheatSheetZoom) return clampSettingsRect(config.cheatSheetZoom, view)
  const r = sheetZoomRect({ ...place.value, w: size.w, h: size.h }, view)
  return { x: r.left, y: r.top, w: r.w, h: r.h }
})
const zoomStyle = computed(() => {
  const r = zoomRect.value
  return { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }
})
const zoomDrag = createRectDrag((r) => {
  config.cheatSheetZoom = r
  console.log(`[menu] 速查表大小 / 位置 → ${r.w}×${r.h} @ ${r.x},${r.y}`)
}, (r) => { zoomLive.value = r })
const zoomEdges = RESIZE_EDGES
let zoomDetach: (() => void) | null = null
function beginZoomDrag (e: PointerEvent, edge: DragEdge) {
  if (!pinned.value || e.button !== 0 || zoomDrag.active) return
  e.preventDefault()
  e.stopPropagation()
  const target = e.currentTarget as HTMLElement
  try { target.setPointerCapture(e.pointerId) } catch { /* 合成事件沒有對應的指標 */ }
  zoomDrag.start(edge, zoomRect.value, e.clientX, e.clientY, { w: view.w, h: view.h })
  const onMove = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) zoomDrag.move(ev.clientX, ev.clientY) }
  const onUp = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; cleanup(); zoomDrag.end(ev.clientX, ev.clientY) }
  const onCancel = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; cleanup(); zoomDrag.cancel() }
  const onLost = () => { if (!zoomDrag.active) return; cleanup(); zoomDrag.end() }
  function cleanup () {
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
    target.removeEventListener('pointercancel', onCancel)
    target.removeEventListener('lostpointercapture', onLost)
    zoomDetach = null
    try { target.releasePointerCapture(e.pointerId) } catch { /* 指標已被釋放 */ }
  }
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
  target.addEventListener('pointercancel', onCancel)
  target.addEventListener('lostpointercapture', onLost)
  zoomDetach = () => { cleanup(); zoomDrag.cancel() }
}
function onZoomHeadDown (e: PointerEvent) {
  if (!pinned.value || isInteractiveTarget(e.target as Element | null)) return
  beginZoomDrag(e, 'move')
}
function resetZoomRect () {
  config.cheatSheetZoom = null
  console.log('[menu] 速查表大小 / 位置還原為預設')
}

async function pickSheet () {
  const name = normBgFile(await Host.sheetPick())
  if (name) {
    config.cheatSheet = name
    sheetBroken.value = false
  }
}
function removeSheet () {
  config.cheatSheet = ''
  pinned.value = false
  peek.value = false
}

function onKey (e: KeyboardEvent) {
  if (e.key === 'Escape' && pinned.value) {
    pinned.value = false
    peek.value = false
    e.preventDefault()
    e.stopPropagation()
  }
}

onMounted(() => {
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKey, true)
  if (root.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      const r = root.value?.getBoundingClientRect()
      if (r) { size.w = r.width; size.h = r.height }
    })
    ro.observe(root.value)
  }
  console.log(`[menu] 開啟懸浮選單(${section.value || '只有按鈕列'})`)
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKey, true)
  ro?.disconnect()
  zoomDetach?.()
  emit('zoom', false)
})

</script>

<style>
.fm {
  position: absolute;
  z-index: 56; /* 設定暗幕(50)、快速面板(55)之上,框選層(60)之下 */
  width: 21em;
  max-height: calc(100vh - 8px);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  font-size: var(--fs-md);
  color: var(--ink-0);
  background: var(--surface-1);
  border: 1px solid var(--edge-2);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-float);
  pointer-events: auto;
  user-select: none;
}
.fm.dragging { opacity: 0.92; }
.fm-head {
  display: flex;
  align-items: center;
  gap: 0.5em;
  padding: 0.35em 0.35em 0.35em 0.7em;
  border-bottom: 1px solid var(--edge-0);
  cursor: move;
  touch-action: none;
}
.fm-grip { width: 0.9em; height: 0.9em; fill: none; stroke: var(--ink-3); stroke-width: 3; stroke-linecap: round; }
.fm-head .mark {
  display: inline-block;
  width: 0.55em;
  height: 0.55em;
  background: var(--gold);
  transform: rotate(45deg);
}
.fm-title { flex: 1; font-weight: 700; }
.fm-key { color: var(--ink-3); font-size: var(--fs-xs); }
.fm-x {
  font: inherit;
  width: 2em;
  height: 2em;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: var(--radius-s);
  color: var(--ink-2);
  cursor: pointer;
}
.fm-x:hover { background: var(--surface-hover); color: var(--ink-0); }
.fm-x svg { width: 1em; height: 1em; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.fm-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45em;
  padding: 0.6em;
}
.fm-act {
  font: inherit;
  font-size: var(--fs-sm);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3em;
  min-height: 4.2em;
  padding: 0.6em 0.3em;
  color: var(--ink-0);
  background: var(--surface-2);
  border: 1px solid var(--edge-1);
  border-radius: var(--radius-s);
  cursor: pointer;
}
.fm-act:hover { background: var(--surface-hover); }
.fm-act.on {
  color: var(--gold);
  border-color: color-mix(in srgb, var(--gold) 60%, transparent);
  background: color-mix(in srgb, var(--gold) 12%, var(--surface-1));
}
.fm-act svg { width: 1.35em; height: 1.35em; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.fm-sec {
  border-top: 1px solid var(--edge-0);
  padding: 0.6em 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.fm-bm-top {
  display: flex;
  align-items: center;
  gap: 0.6em;
  padding: 0 0.7em 0.5em;
}
.fm-hint {
  flex: 1;
  margin: 0;
  color: var(--ink-2);
  font-size: var(--fs-xs);
}
.fm-bm-top .fm-hint { text-align: right; }
.fm-bm-list {
  overflow-y: auto;
  max-height: min(26em, 60vh);
  display: flex;
  flex-direction: column;
}
.fm-folder, .fm-bm {
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--ink-0);
}
.fm-folder {
  display: flex;
  align-items: center;
  gap: 0.45em;
  padding: 0.4em 0.7em;
  font-size: var(--fs-sm);
  color: var(--ink-1);
}
.fm-folder:hover { color: var(--ink-0); }
.fm-caret { width: 0.8em; color: var(--ink-3); }
.fm-folder-name { flex: 1; font-weight: 600; }
.fm-count { color: var(--ink-3); }
.fm-bm {
  display: flex;
  flex-direction: column;
  gap: 0.15em;
  padding: 0.45em 0.7em;
  min-height: 3em;
}
.fm-bm.nested { padding-left: 1.9em; }
.fm-bm:hover:not(:disabled) { background: var(--surface-hover); }
.fm-bm:disabled { opacity: 0.6; cursor: progress; }
.fm-bm-line { display: flex; gap: 0.6em; width: 100%; }
.fm-bm-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fm-bm-key { color: var(--ink-3); font-size: var(--fs-xs); font-family: var(--font-mono); }
.fm-bm-query {
  width: 100%;
  color: var(--ink-2);
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fm-empty, .fm-notice {
  margin: 0;
  padding: 0.4em 0.7em;
  font-size: var(--fs-sm);
  color: var(--ink-2);
}
.fm-notice { border-top: 1px solid var(--edge-0); color: var(--ok); }
.fm-sheet { padding: 0.6em; gap: 0.45em; }
.fm-thumb {
  padding: 0;
  height: 9.5em;
  border: 1px solid var(--edge-1);
  border-radius: var(--radius-s);
  background: var(--surface-0);
  overflow: hidden;
  cursor: zoom-in;
}
.fm-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.fm-sheet-row { display: flex; align-items: center; gap: 0.45em; }
.fm-sheet-name {
  flex: 1;
  min-width: 0;
  color: var(--ink-3);
  font-size: var(--fs-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fm-sheet-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5em;
  padding: 1.1em 0.7em;
  border: 1px dashed var(--edge-2);
  border-radius: var(--radius-m);
  text-align: center;
  color: var(--ink-1);
}
.fm-sheet-empty .fm-hint { flex: none; }
.fm-zoom {
  position: absolute;
  z-index: 57;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: var(--surface-0);
  border: 1px solid var(--edge-2);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-float);
  overflow: hidden;
  pointer-events: none; /* hover 暫時放大:不擋遊戲 */
}
.fm-zoom.pinned { pointer-events: auto; }
.fm-zoom-head {
  display: flex;
  align-items: center;
  gap: 0.6em;
  padding: 0.35em 0.35em 0.35em 0.8em;
  border-bottom: 1px solid var(--edge-0);
  background: var(--surface-1);
  font-size: var(--fs-md);
}
.fm-zoom-head.movable { cursor: move; touch-action: none; user-select: none; }
.fm-zoom.dragging { opacity: 0.94; }
.fm-zoom-title { font-weight: 600; }
/* 調整大小把手(只在釘住時;同設定視窗 .sw-rz) */
.fm-rz { position: absolute; z-index: 2; touch-action: none; }
.fm-rz.rz-n { top: 0; left: 12px; right: 12px; height: 6px; }
.fm-rz.rz-s { bottom: 0; left: 12px; right: 12px; height: 6px; }
.fm-rz.rz-w { left: 0; top: 12px; bottom: 12px; width: 6px; }
.fm-rz.rz-e { right: 0; top: 12px; bottom: 12px; width: 6px; }
.fm-rz.rz-nw { top: 0; left: 0; width: 12px; height: 12px; }
.fm-rz.rz-ne { top: 0; right: 0; width: 12px; height: 12px; }
.fm-rz.rz-sw { bottom: 0; left: 0; width: 12px; height: 12px; }
.fm-rz.rz-se { bottom: 0; right: 0; width: 12px; height: 12px; }
.fm-zoom-head .fm-hint { text-align: right; }
.fm-zoom-img { flex: 1; min-height: 0; width: 100%; object-fit: contain; }
</style>
