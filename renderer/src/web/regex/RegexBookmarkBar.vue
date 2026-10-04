<!--
  第 33 步(2026-10-04):設定視窗旁浮一排正則書籤(設定 `regexBookmarkBar` 預設開)。
  - `inline`(window 模式 / 瀏覽器預覽:設定填滿視窗,旁邊沒有空間)= 設定視窗上方一條橫排(一般排版、橫向捲動);
    點了照樣執行,main 回「視窗模式只複製」/ 預覽端用瀏覽器剪貼簿,這裡顯示原因。
  - 放在 App.vue 的 `.settings-layer`(暗幕)裡、設定視窗的兄弟節點;位置跟第 21 步設定視窗的實際位置 / 大小走
    (ResizeObserver 看暗幕 / 設定視窗 / 內容,MutationObserver 看設定視窗 inline style = 拖曳中即時跟著),
    擺法是純函式 `quick-geom.ts` `placeBookmarkBar`:右側 → 左側(直排,放不下就捲動)→ 上方 → 下方(橫排,橫向捲動)→ 都沒空間就不顯示。
  - 依目前遊戲(`AppConfig().game`)過濾;點一下 = `quick.ts` `runRegexBookmark`(source `bar`):貼上了 → emit `pasted`(App 關設定;
    焦點 main 已交還遊戲);只複製 → 這裡顯示原因 5 秒。
  - 尺寸用 em(跟全域字級;不在設定視窗根元素內,不吃設定視窗獨立字級)。
  - 第 36 步:依資料夾分組(`bookmarkGroupsOf(game, skipEmpty)`,未分類最後;沒有資料夾 = 不畫標題 = 與之前相同外觀),
    點資料夾標題收合 / 展開(收合狀態存 regex_state,與管理頁、快速面板共用)。
-->
<template>
  <div v-show="inline || place.side !== 'none'" ref="root" class="rx-qbar"
    :class="inline ? ['row', 'inline'] : [place.dir, `side-${place.side}`, { measuring: !placed }]"
    :style="inline ? undefined : style" data-regex="quick-bar" :data-side="inline ? 'inline' : place.side" :title="t('ppz.regex.quick_bar_tip')">
    <div ref="body" class="rx-qbar-body">
      <div class="rx-qbar-head">
        <span class="rx-qbar-title">{{ t('ppz.regex.quick_bar_title') }}</span>
        <span class="rx-qbar-game">{{ gameLabel(game) }}</span>
        <span v-if="running" class="rx-qbar-running pulse" data-regex="quick-bar-running">{{ t('ppz.regex.quick_running') }}</span>
      </div>
      <template v-for="g in grouped.groups" :key="`g:${g.folder}`">
        <button v-if="grouped.headers" type="button" class="rx-qbar-folder" :class="{ collapsed: g.collapsed }"
          :aria-expanded="!g.collapsed" data-regex="quick-bar-folder" :data-folder="g.folder"
          :title="t(g.collapsed ? 'ppz.regex.fd_expand' : 'ppz.regex.fd_collapse')" @click="toggle(g.folder, !g.collapsed)">
          <span class="rx-qbar-caret" aria-hidden="true">{{ g.collapsed ? '▸' : '▾' }}</span>
          <span class="rx-qbar-fname">{{ g.folder || t('ppz.regex.fd_uncategorized') }}</span>
          <span class="rx-qbar-fcount num">{{ g.items.length }}</span>
        </button>
        <template v-if="!g.collapsed">
          <button v-for="x in g.items" :key="x.index" type="button" class="rx-qbar-item" :class="{ nested: grouped.headers }" :disabled="running"
            data-regex="quick-bar-item" :data-bm="x.b.name" @click="run(x.index)">
            <span class="rx-qbar-name">{{ x.b.name }}</span>
            <span v-if="x.b.hotkey" class="rx-qbar-kbd num">{{ compactHotkey(x.b.hotkey) }}</span>
          </button>
        </template>
      </template>
      <div v-if="!items.length" class="rx-qbar-empty" data-regex="quick-bar-empty">
        <span>{{ t('ppz.regex.quick_empty', { game: gameLabel(game) }) }}</span>
        <button type="button" class="btn ghost sm" data-regex="quick-bar-open-regex" @click="$emit('open-regex')">{{ t('ppz.regex.quick_open_regex') }}</button>
      </div>
      <p v-if="notice" class="rx-qbar-notice" data-regex="quick-bar-notice">{{ notice }}</p>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { quickBookmarks } from '@exile-appraiser/regex'
import { AppConfig } from '@/web/Config'
import { bookmarkGroupsOf, gameLabel, setBookmarkFolderCollapsed, useRegexStore } from './store'
import { quickRunning, runRegexBookmark } from './quick'
import { placeBookmarkBar, quickNoticeKey, type BarPlacement } from './quick-geom'

/** 直排寬 / 橫排高 / 直排最小高(em,跟 `.rx-qbar` 的 font-size) */
const COL_W_EM = 14
const ROW_H_EM = 2.9
const MIN_COL_H_EM = 7

export default defineComponent({
  props: {
    /** window 模式 / 預覽:設定視窗上方一條橫排(不量位置) */
    inline: { type: Boolean, default: false }
  },
  emits: ['pasted', 'open-regex'],
  setup (props, { emit }) {
    const { t } = useI18n()
    const config = AppConfig()
    const store = useRegexStore()
    const root = ref<HTMLElement | null>(null)
    const body = ref<HTMLElement | null>(null)
    const place = shallowRef<BarPlacement>({ side: 'right', dir: 'column', x: -10000, y: 0, w: 0, h: 0, scroll: false })
    const placed = shallowRef(false)
    const notice = shallowRef('')
    let noticeTimer: ReturnType<typeof setTimeout> | null = null

    const game = computed(() => config.game)
    const items = computed(() => quickBookmarks(store.ui.bookmarks, game.value))
    // 第 36 步:依資料夾分組(空資料夾不列;沒有資料夾 = 沒有標題 = 與之前相同);收合狀態與管理頁 / 快速面板共用
    const grouped = computed(() => bookmarkGroupsOf(game.value, true))
    const toggle = (folder: string, collapse: boolean) => setBookmarkFolderCollapsed(game.value, folder, collapse)

    function layout () {
      if (props.inline) return
      const el = root.value
      const layer = el?.parentElement
      const win = layer?.querySelector<HTMLElement>('.settings-window')
      if (!el || !layer || !win || !body.value) return
      const lr = layer.getBoundingClientRect()
      const wr = win.getBoundingClientRect()
      const fs = parseFloat(getComputedStyle(el).fontSize) || 12
      const next = placeBookmarkBar(
        { x: wr.left - lr.left, y: wr.top - lr.top, w: wr.width, h: wr.height },
        { w: lr.width, h: lr.height },
        {
          colW: Math.round(fs * COL_W_EM),
          // 直排時 body 的高度 = 自然高度(外框固定高 + 捲動);橫排時沿用上次直排量到的
          colH: place.value.dir === 'column' ? body.value.offsetHeight + 2 : lastColH,
          minColH: Math.round(fs * MIN_COL_H_EM),
          rowH: Math.round(fs * ROW_H_EM)
        })
      if (place.value.dir === 'column') lastColH = body.value.offsetHeight + 2
      const p = place.value
      if (next.side !== p.side || next.x !== p.x || next.y !== p.y || next.w !== p.w || next.h !== p.h || next.scroll !== p.scroll) {
        place.value = next
      }
      placed.value = true
    }
    let lastColH = 0
    let raf = 0
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; layout() })
    }

    let ro: ResizeObserver | null = null
    let mo: MutationObserver | null = null
    onMounted(() => {
      const el = root.value
      const layer = el?.parentElement
      const win = layer?.querySelector<HTMLElement>('.settings-window')
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(schedule)
        if (layer) ro.observe(layer)
        if (win) ro.observe(win)
        if (body.value) ro.observe(body.value)
      }
      if (win && typeof MutationObserver !== 'undefined') {
        mo = new MutationObserver(schedule)
        mo.observe(win, { attributes: true, attributeFilter: ['style', 'class'] })
      }
      window.addEventListener('resize', schedule)
      void nextTick(layout)
    })
    onUnmounted(() => {
      ro?.disconnect()
      mo?.disconnect()
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
      if (noticeTimer) clearTimeout(noticeTimer)
    })
    // 書籤增減 / 換遊戲 / 收合資料夾 → 內容高度變了(ResizeObserver 也會抓到;這裡保險)
    watch(() => [items.value.length, grouped.value.groups.map(g => g.collapsed).join()], () => { void nextTick(layout) })
    // 直排 ↔ 橫排切換後重量一次(直排要量自然高度)
    watch(() => place.value.dir, () => { void nextTick(layout) })

    async function run (index: number) {
      const o = await runRegexBookmark(index, 'bar')
      if (o.pasted) {
        emit('pasted')
        return
      }
      const key = quickNoticeKey(o)
      notice.value = key ? t(key) : ''
      if (noticeTimer) clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => { notice.value = '' }, 5000)
    }

    const style = computed(() => {
      const p = place.value
      return {
        left: `${p.x}px`,
        top: `${p.y}px`,
        width: p.dir === 'row' ? `${p.w}px` : `${COL_W_EM}em`,
        height: p.dir === 'row' ? `${p.h}px` : (p.scroll ? `${p.h}px` : undefined)
      }
    })

    return {
      t, root, body, place, placed, style, items, grouped, toggle, game, notice, running: quickRunning, gameLabel, run,
      /** `Ctrl + Shift + 1` → `Ctrl+Shift+1`(書籤列窄) */
      compactHotkey: (hk: string) => hk.replace(/\s*\+\s*/g, '+')
    }
  }
})
</script>

<style>
.rx-qbar {
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
  font-size: var(--fs-sm);
  color: var(--ink-0);
  background: var(--surface-1);
  border: 1px solid var(--edge-1);
  border-left: 3px solid var(--gold);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-float);
  overflow: hidden;
}
/* window 模式 / 預覽:設定視窗上方的一般排版橫排(.settings-layer.is-window 是直向 flex) */
.rx-qbar.inline {
  position: static;
  order: -1;
  flex: 0 0 auto;
  height: 2.9em;
  margin-bottom: 6px;
  box-shadow: none;
}
.rx-qbar.measuring {
  visibility: hidden;
}
.rx-qbar.column {
  overflow-y: auto;
}
.rx-qbar.row {
  overflow-x: auto;
  overflow-y: hidden;
}
.rx-qbar-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0.45em 0.4em;
}
.rx-qbar.row .rx-qbar-body {
  flex-direction: row;
  align-items: center;
  height: 100%;
  box-sizing: border-box;
  padding: 0 0.4em;
  width: max-content;
  min-width: 100%;
}
.rx-qbar-head {
  display: flex;
  align-items: baseline;
  gap: 0.5em;
  padding: 0 0.35em 0.3em;
  font-size: var(--fs-xs);
  color: var(--ink-2);
  white-space: nowrap;
}
.rx-qbar.row .rx-qbar-head {
  padding: 0 0.5em 0 0.2em;
}
.rx-qbar-title {
  color: var(--gold);
  font-weight: 600;
  letter-spacing: 0.02em;
}
.rx-qbar-running {
  color: var(--ink-1);
}
.rx-qbar-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1em;
  min-width: 0;
  padding: 0.38em 0.5em;
  border: 1px solid transparent;
  border-radius: var(--radius-s, 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.rx-qbar.row .rx-qbar-item {
  flex-direction: row;
  align-items: center;
  gap: 0.5em;
  flex: 0 0 auto;
  max-width: 22em;
  background: var(--surface-2);
  border-color: var(--edge-0);
}
.rx-qbar-item:hover:not(:disabled) {
  background: var(--surface-3, var(--surface-2));
  border-color: var(--edge-1);
}
.rx-qbar-item:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}
.rx-qbar-item:disabled {
  cursor: progress;
  opacity: 0.6;
}
.rx-qbar-item.nested {
  padding-left: 1.1em;
}
.rx-qbar.row .rx-qbar-item.nested {
  padding-left: 0.5em;
}
/* 第 36 步:資料夾標題(點一下收合 / 展開) */
.rx-qbar-folder {
  display: flex;
  align-items: center;
  gap: 0.4em;
  min-width: 0;
  margin-top: 0.25em;
  padding: 0.22em 0.4em;
  border: 0;
  border-radius: var(--radius-s, 4px);
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: var(--fs-xs);
  text-align: left;
  cursor: pointer;
}
.rx-qbar-folder:hover {
  color: var(--ink-0);
  background: var(--surface-2);
}
.rx-qbar-folder:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}
.rx-qbar.row .rx-qbar-folder {
  flex: 0 0 auto;
  margin: 0 0 0 0.35em;
  padding-left: 0.6em;
  border-left: 1px solid var(--edge-1);
  border-radius: 0;
  white-space: nowrap;
}
.rx-qbar-caret {
  flex: 0 0 auto;
  color: var(--gold);
}
.rx-qbar-fname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.rx-qbar-fcount {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--ink-3);
}
.rx-qbar.row .rx-qbar-fcount {
  margin-left: 0.2em;
}
.rx-qbar-name {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rx-qbar-kbd {
  flex: 0 0 auto;
  font-size: var(--fs-2xs);
  color: var(--ink-3);
  white-space: nowrap;
}
.rx-qbar.row .rx-qbar-kbd {
  padding: 0 0.35em;
  border: 1px solid var(--edge-1);
  border-radius: 3px;
  color: var(--ink-2);
}
.rx-qbar-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.4em;
  padding: 0.2em 0.35em 0.3em;
  font-size: var(--fs-xs);
  color: var(--ink-2);
}
.rx-qbar.row .rx-qbar-empty {
  flex-direction: row;
  align-items: center;
  white-space: nowrap;
}
.rx-qbar-notice {
  margin: 0.3em 0.35em 0;
  font-size: var(--fs-xs);
  color: var(--warn);
}
.rx-qbar.row .rx-qbar-notice {
  margin: 0 0.5em;
  white-space: nowrap;
}
</style>
