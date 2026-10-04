<!--
  第 33 步(2026-10-04):正則書籤快速面板。熱鍵 `hotkeyRegexQuick`(預設不綁)→ main 讓 overlay 取得焦點 + `regex-quick-open` → App.vue 開這個面板。
  - 清單 = 目前遊戲的書籤(`quickBookmarks`);鍵盤:↑↓ / Home / End / PageUp / PageDown 選、Enter 執行、1–9 直接執行第 N 筆、Esc 關
    (`quick-geom.ts` `quickPanelKey`)。overlay 的 Esc 先被 main 的 before-input-event 攔下 → 焦點回遊戲 → focus-change 關面板;
    window 模式 / 預覽由這裡處理。滑鼠:移上去選、點一下執行、點面板外關閉。
  - 執行 = `quick.ts` `runRegexBookmark`(source `quick`):貼上了 → emit `close('pasted')`(焦點 main 已交還遊戲);只複製 → 面板留著顯示原因。
  - 開啟時順手載清單(第一次 Enter 不用等 ~3 MB 的解析)。
-->
<template>
  <div class="rx-quick-layer" data-regex="quick-layer" @pointerdown.self="onBackdropDown" @click.self="onBackdropClick">
    <div class="rx-quick" role="dialog" aria-modal="true" :aria-label="title" data-regex="quick-panel">
      <div class="rx-quick-head">
        <span class="rx-quick-title">{{ title }}</span>
        <span v-if="running" class="rx-quick-running pulse">{{ t('ppz.regex.quick_running') }}</span>
      </div>
      <ul v-if="items.length" ref="list" class="rx-quick-list" role="listbox" data-regex="quick-list">
        <li v-for="(x, i) in items" :key="x.index" role="option" class="rx-quick-item" :class="{ sel: i === sel }"
          :aria-selected="i === sel" data-regex="quick-item" :data-bm="x.b.name" :data-sel="i === sel ? '1' : undefined"
          @mousemove="sel = i" @click="run(i)">
          <span class="rx-quick-no num">{{ i < 9 ? i + 1 : '' }}</span>
          <span class="rx-quick-name">{{ x.b.name }}</span>
          <span v-if="x.b.hotkey" class="rx-quick-kbd num">{{ x.b.hotkey }}</span>
        </li>
      </ul>
      <p v-else class="rx-quick-empty" data-regex="quick-empty">{{ t('ppz.regex.quick_empty', { game: gameLabel(game) }) }}</p>
      <p v-if="notice" class="rx-quick-notice" data-regex="quick-notice">{{ notice }}</p>
      <p class="rx-quick-hint">{{ t('ppz.regex.quick_panel_hint') }}</p>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { quickBookmarks } from '@exile-appraiser/regex'
import { AppConfig } from '@/web/Config'
import { catalogueFor, ensureStateLoaded, gameLabel, useRegexStore } from './store'
import { quickRunning, runRegexBookmark } from './quick'
import { quickNoticeKey, quickPanelKey } from './quick-geom'

export default defineComponent({
  emits: ['close'],
  setup (_props, { emit }) {
    const { t } = useI18n()
    const config = AppConfig()
    const store = useRegexStore()
    const game = computed(() => config.game)
    const items = computed(() => quickBookmarks(store.ui.bookmarks, game.value))
    const sel = shallowRef(0)
    const notice = shallowRef('')
    const list = ref<HTMLElement | null>(null)

    watch(() => items.value.length, (n) => { if (sel.value >= n) sel.value = Math.max(0, n - 1) })
    watch(sel, async () => {
      await nextTick()
      list.value?.querySelector('[data-sel="1"]')?.scrollIntoView({ block: 'nearest' })
    })

    async function run (i: number) {
      const x = items.value[i]
      if (!x || quickRunning.value) return
      sel.value = i
      notice.value = ''
      const o = await runRegexBookmark(x.index, 'quick')
      if (o.pasted) { emit('close', 'pasted'); return }
      const key = quickNoticeKey(o)
      notice.value = key ? t(key) : ''
    }

    function onKey (e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return
      const r = quickPanelKey(items.value.length ? sel.value : -1, items.value.length, e.key)
      if (!r.handled) return
      e.preventDefault()
      e.stopPropagation()
      if (r.sel >= 0) sel.value = r.sel
      if (r.action === 'close') emit('close', 'esc')
      else if (r.action === 'run') void run(r.sel)
    }

    // 點面板外關閉(按下與放開都在背景上才算,同設定暗幕)
    let downOnBackdrop = false
    onMounted(() => {
      window.addEventListener('keydown', onKey, true)
      void ensureStateLoaded().then(() => catalogueFor(game.value)).catch(() => {})
    })
    onUnmounted(() => { window.removeEventListener('keydown', onKey, true) })

    return {
      t,
      game,
      items,
      sel,
      notice,
      list,
      running: quickRunning,
      gameLabel,
      title: computed(() => t('ppz.regex.quick_panel_title', { game: gameLabel(game.value) })),
      run,
      onBackdropDown () { downOnBackdrop = true },
      onBackdropClick () {
        if (downOnBackdrop) emit('close', 'backdrop')
        downOnBackdrop = false
      }
    }
  }
})
</script>

<style>
.rx-quick-layer {
  position: absolute;
  inset: 0;
  z-index: 55; /* 設定暗幕(50)之上、框選層(60)之下 */
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 18vh 16px 16px;
  background: rgba(0, 0, 0, 0.25);
  pointer-events: auto;
}
.rx-quick {
  width: min(26em, 92vw);
  max-height: 64vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  font-size: var(--fs-md);
  color: var(--ink-0);
  background: var(--surface-1);
  border: 1px solid var(--edge-1);
  border-left: 3px solid var(--gold);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-float);
}
.rx-quick-head {
  display: flex;
  align-items: baseline;
  gap: 0.6em;
  padding: 0.7em 0.9em 0.4em;
}
.rx-quick-title {
  color: var(--gold);
  font-weight: 600;
}
.rx-quick-running {
  font-size: var(--fs-xs);
  color: var(--ink-1);
}
.rx-quick-list {
  list-style: none;
  margin: 0;
  padding: 0 0.4em;
  overflow-y: auto;
  min-height: 0;
}
.rx-quick-item {
  display: flex;
  align-items: center;
  gap: 0.6em;
  padding: 0.45em 0.5em;
  border-radius: var(--radius-s, 4px);
  cursor: pointer;
}
.rx-quick-item.sel {
  background: var(--surface-2);
  box-shadow: inset 2px 0 0 var(--gold);
}
.rx-quick-no {
  flex: 0 0 1.2em;
  text-align: right;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.rx-quick-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rx-quick-kbd {
  flex: 0 0 auto;
  padding: 0 0.35em;
  border: 1px solid var(--edge-1);
  border-radius: 3px;
  font-size: var(--fs-2xs);
  color: var(--ink-2);
  white-space: nowrap;
}
.rx-quick-empty {
  margin: 0.2em 0.9em 0.4em;
  font-size: var(--fs-sm);
  color: var(--ink-2);
}
.rx-quick-notice {
  margin: 0.4em 0.9em 0;
  font-size: var(--fs-xs);
  color: var(--warn);
}
.rx-quick-hint {
  margin: 0.4em 0 0;
  padding: 0.45em 0.9em 0.6em;
  border-top: 1px solid var(--edge-0);
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
</style>
