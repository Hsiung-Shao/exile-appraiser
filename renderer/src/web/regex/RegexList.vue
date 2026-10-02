<!--
  Poe Regex 清單(WP5):搜尋 / 分類 / T17 三態 / 全選(篩選後)/ 清除 + 虛擬捲動列表。
  移植自 PobTools `host/regex_tool_ui.cpp` drawList :493、drawRow :590、drawEntryTooltip :621。
  列高固定(依字級算出 px、每列釘死):列表很長時,每列差一點點高度就會讓最底下捲不到(C++ 同樣的理由)。
  勾選的浮到最上(regex/src/view.ts visibleRows)。提示框是單一個浮動層(不是每列一個 tippy)。
-->
<template>
  <section class="card rx-list-card" data-regex="list">
    <div class="rx-toolbar">
      <input v-model="view.search" class="input sm rx-search" type="search" :placeholder="t('ppz.regex.search_ph')"
        data-regex="search">
      <select v-if="groups.length" v-model.number="view.group" class="select sm" data-regex="group">
        <option :value="-1">{{ t('ppz.regex.group_all') }}</option>
        <option v-for="(g, i) in groups" :key="i" :value="i">{{ g }}</option>
      </select>
      <div v-if="hasT17" class="seg" data-regex="t17">
        <button v-for="o in t17Options" :key="o" :class="{ on: view.t17 === o }" :data-value="o"
          @click="view.t17 = o">{{ t(`ppz.regex.t17_${o}`) }}</button>
      </div>
      <span class="grow" />
      <button class="btn sm" data-regex="select-all" :disabled="!visible.length"
        :title="t('ppz.regex.select_all_tip', { n: visible.length })" @click="selectVisible">{{ t('ppz.regex.select_all') }}</button>
      <button class="btn sm" data-regex="clear" :disabled="!picked.length" :title="t('ppz.regex.clear_tip')"
        @click="clearPicks">{{ t('ppz.regex.clear') }}</button>
    </div>

    <div ref="scroller" class="rx-rows" data-regex="rows" :data-count="visible.length" @scroll="onScroll"
      @mouseleave="hideTip">
      <div v-if="!visible.length" class="rx-empty">{{ t('ppz.regex.empty_filter') }}</div>
      <div class="rx-spacer" :style="{ height: `${visible.length * rowH}px` }">
        <label v-for="r in windowRows" :key="r.idx" class="rx-row" :class="{ on: pickedSet.has(r.idx) }"
          :style="{ top: `${r.pos * rowH}px`, height: `${rowH}px` }" :data-idx="r.idx" :data-id="r.e.id"
          @mouseenter="showTip(r.idx, $event)" @mouseleave="hideTip">
          <input type="checkbox" :checked="pickedSet.has(r.idx)"
            @change="togglePick(r.idx, ($event.target as HTMLInputElement).checked)">
          <span class="rx-text">
            <span class="rx-main">
              <span v-if="r.e.t17" class="rx-t17">T17</span>{{ lineIn(r.e, lang) }}<span v-if="extraLines(r.e, lang)"
                class="rx-more">{{ t('ppz.regex.extra_lines', { n: extraLines(r.e, lang) }) }}</span>
            </span>
            <span v-if="bilingual" class="rx-sub">{{ otherLine(r.e, lang) || t('ppz.regex.no_counterpart') }}</span>
          </span>
        </label>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="tip" class="pob-dark rx-tip" :class="fsClass" :style="[fsStyle, tip.style]" role="tooltip" data-regex="tooltip">
        <div v-for="(l, i) in tip.e.zh" :key="'z' + i">{{ l }}</div>
        <template v-if="tip.e.en.length">
          <hr>
          <div v-for="(l, i) in tip.e.en" :key="'e' + i" class="muted">{{ l }}</div>
        </template>
        <template v-if="tip.e.affixZh">
          <hr>
          <div class="dim">{{ t('ppz.regex.affix', { affix: tip.e.affixZh }) }}</div>
        </template>
        <template v-if="tip.hidden.lines.length">
          <hr>
          <div class="muted">{{ t('ppz.regex.hidden_title') }}</div>
          <ul class="muted">
            <li v-for="(l, i) in tip.hidden.lines" :key="'h' + i">{{ l }}</li>
          </ul>
          <div v-if="tip.hidden.more" class="muted">{{ t('ppz.regex.extra_lines', { n: tip.hidden.more }) }}</div>
        </template>
      </div>
    </Teleport>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { extraLines, hiddenPreview, lineIn, otherLine, pageHasT17, type RegexEntry, type T17Filter } from '@exile-appraiser/regex'
import { AppConfig } from '@/web/Config'
import { useSettingsFs } from '@/web/settings/settings-fs'
import { rafThrottle, windowEndIdx, windowStartIdx } from '../virtual-window'
import { clearPicks, selectVisible, togglePick, useRegexStore } from './store'

const OVERSCAN = 6

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const store = useRegexStore()
    const config = AppConfig()
    const scroller = ref<HTMLElement | null>(null)
    const scrollTop = shallowRef(0)
    const viewH = shallowRef(320)

    const lang = computed(() => store.ui.lang)
    const bilingual = computed(() => store.ui.bilingual)
    const uiEn = computed(() => config.uiLanguage === 'en')

    // 列高:字級 × line-height 1.45,釘死成整數 px(字級 = 設定視窗的有效字級,第 21 步)
    const settingsFs = useSettingsFs()
    const rowH = computed(() => {
      const fs = settingsFs.fs.value || 13
      const main = Math.ceil((fs - 1) * 1.45)
      const sub = Math.ceil((fs - 2) * 1.45)
      return (bilingual.value ? main + sub : Math.max(main, 16)) + 9
    })

    const groups = computed(() => {
      const p = store.page.value
      if (!p) return []
      return p.groups.map((g, i) => (uiEn.value ? p.groupsEn[i] : '') || g)
    })

    // 可視區間用整數索引:windowRows 只依賴 startIdx / endIdx,不直接依賴每像素都變的 scrollTop
    const startIdx = computed(() => windowStartIdx(scrollTop.value, rowH.value, OVERSCAN))
    const endIdx = computed(() => windowEndIdx(scrollTop.value, viewH.value, rowH.value, OVERSCAN, store.visible.value.length))
    const windowRows = computed(() => {
      const list = store.visible.value
      const p = store.page.value
      if (!p) return []
      const out: Array<{ pos: number, idx: number, e: RegexEntry }> = []
      for (let pos = startIdx.value, end = endIdx.value; pos < end; pos++) out.push({ pos, idx: list[pos], e: p.entries[list[pos]] })
      return out
    })

    function measure () {
      const el = scroller.value
      if (!el) return
      viewH.value = el.clientHeight || 320
      scrollTop.value = el.scrollTop
    }
    // scroll 事件每幀最多量測一次(最後位置照樣處理到);提示框照舊在事件當下立刻收起
    const measureOnFrame = rafThrottle(measure)
    function onScroll () {
      measureOnFrame()
      tip.value = null
    }
    let ro: ResizeObserver | null = null
    watch(scroller, (el) => {
      ro?.disconnect()
      if (!el) return
      ro = new ResizeObserver(measure)
      ro.observe(el)
      measure()
    })
    // 換頁 / 篩選變了:回到頂端
    watch(() => [store.page.value?.id, store.view.value.search, store.view.value.group, store.view.value.t17], () => {
      if (scroller.value) scroller.value.scrollTop = 0
      scrollTop.value = 0
    })
    onBeforeUnmount(() => { ro?.disconnect(); measureOnFrame.cancel(); clearTimeout(tipTimer) })

    // ---- 提示框 ----
    interface Tip { e: RegexEntry, hidden: { lines: string[], more: number }, style: Record<string, string> }
    const tip = shallowRef<Tip | null>(null)
    let tipTimer: ReturnType<typeof setTimeout> | undefined
    function showTip (idx: number, ev: MouseEvent) {
      clearTimeout(tipTimer)
      const target = ev.currentTarget as HTMLElement
      tipTimer = setTimeout(() => {
        const p = store.page.value
        if (!p || !target.isConnected) return
        const e = p.entries[idx]
        const r = target.getBoundingClientRect()
        const below = r.bottom + 4
        const style: Record<string, string> = { left: `${Math.max(8, Math.min(r.left + 24, window.innerWidth - 368))}px` }
        if (below + 160 > window.innerHeight && r.top > window.innerHeight / 2) style.bottom = `${window.innerHeight - r.top + 4}px`
        else style.top = `${below}px`
        tip.value = { e, hidden: hiddenPreview(e, lang.value), style }
      }, 350)
    }
    function hideTip () {
      clearTimeout(tipTimer)
      tip.value = null
    }

    return {
      fsStyle: settingsFs.style,
      fsClass: settingsFs.cls,
      t,
      scroller,
      view: store.view,
      visible: store.visible,
      picked: store.picked,
      pickedSet: store.pickedSet,
      groups,
      hasT17: computed(() => store.page.value ? pageHasT17(store.page.value) : false),
      t17Options: ['all', 'only', 'hide'] as T17Filter[],
      rowH,
      windowRows,
      lang,
      bilingual,
      tip,
      onScroll,
      showTip,
      hideTip,
      lineIn,
      otherLine,
      extraLines,
      togglePick,
      selectVisible,
      clearPicks
    }
  }
})
</script>

<style>
.rx-list-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rx-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.rx-toolbar .grow {
  flex: 1;
}
.rx-search {
  flex: 1 1 140px;
  min-width: 120px;
}
.rx-rows {
  position: relative;
  height: clamp(220px, 42vh, 460px);
  overflow-y: auto;
  border: 1px solid var(--edge-0);
  border-radius: var(--radius-s);
  background: var(--surface-0);
}
.rx-spacer {
  position: relative;
}
.rx-empty {
  padding: 10px;
  color: var(--ink-3);
  font-size: var(--fs-sm);
}
.rx-row {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  cursor: pointer;
  overflow: hidden;
}
.rx-row:hover {
  background: var(--surface-hover);
}
.rx-row.on {
  background: var(--gold-soft);
}
.rx-row input[type="checkbox"] {
  flex-shrink: 0;
  margin: 0;
  accent-color: var(--gold);
}
.rx-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.45;
}
.rx-main,
.rx-sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rx-main {
  font-size: var(--fs-sm);
  color: var(--ink-0);
}
.rx-sub {
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.rx-t17 {
  margin-right: 6px;
  color: var(--warn);
  font-size: var(--fs-2xs);
  font-weight: 600;
}
.rx-more {
  margin-left: 6px;
  color: var(--ink-3);
  font-size: var(--fs-2xs);
}
.rx-tip {
  position: fixed;
  z-index: 1000;
  max-width: 360px;
  padding: 7px 10px;
  border: 1px solid var(--edge-2);
  border-radius: var(--radius-m);
  background: var(--surface-2-c);
  box-shadow: var(--shadow-float);
  color: var(--ink-0);
  font-size: var(--fs-xs);
  line-height: 1.45;
  pointer-events: none;
}
.rx-tip hr {
  border: 0;
  border-top: 1px solid var(--edge-1);
  margin: 5px 0;
}
.rx-tip .muted {
  color: var(--ink-2);
}
.rx-tip .dim {
  color: var(--ink-3);
}
.rx-tip ul {
  margin: 2px 0 0;
  padding-left: 16px;
}
</style>
