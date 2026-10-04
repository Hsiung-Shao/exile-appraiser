<!--
  第 39 步:設定頁的「?」說明(長說明收在這裡,畫面上只留一句)。
  - 滑鼠移上去 / 鍵盤聚焦顯示,點一下固定開著(再點或 Esc 關閉,點別處也關);`aria-expanded` + `aria-describedby`,按鈕有 `aria-label`。
  - 氣泡不 Teleport(留在設定視窗內、吃獨立字級的 `--fs-*`);打開時量一次位置,超出設定內容區左右邊就往內推,下方不夠放就改放上方。
  - 尺寸只用 em / `--fs-*`(設定視窗內不用 rem,第 21 步)。
-->
<template>
  <span ref="root" class="help-tip" :class="{ open: shown }" @mouseenter="hover = true" @mouseleave="hover = false">
    <button ref="btn" type="button" class="help-btn" :aria-label="label || t('ppz.help')" :aria-expanded="shown"
      :aria-describedby="shown ? bubbleId : undefined" :data-help="id" @click="toggle" @focus="focused = true" @blur="focused = false"
      @keydown.esc.stop="close">?</button>
    <span v-if="shown" :id="bubbleId" ref="bubble" class="help-bubble" role="tooltip" :class="{ up }" :style="shift ? { transform: `translateX(${shift}px)` } : undefined">
      <slot>{{ text }}</slot>
    </span>
  </span>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onBeforeUnmount, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

let seq = 0

export default defineComponent({
  props: {
    /** 說明文字(或用預設 slot) */
    text: { type: String, default: '' },
    /** 按鈕的無障礙名稱(預設「說明」) */
    label: { type: String, default: '' },
    /** `data-help` 值(測試 / 截圖找元素用) */
    id: { type: String, default: '' }
  },
  setup () {
    const { t } = useI18n()
    const root = shallowRef<HTMLElement | null>(null)
    const bubble = shallowRef<HTMLElement | null>(null)
    const hover = shallowRef(false)
    const focused = shallowRef(false)
    const pinned = shallowRef(false)
    const shift = shallowRef(0)
    const up = shallowRef(false)
    const bubbleId = `help-tip-${++seq}`
    const shown = computed(() => pinned.value || hover.value || focused.value)

    function place () {
      const b = bubble.value
      const r = root.value
      if (!b || !r) return
      shift.value = 0
      up.value = false
      const area = (r.closest('.settings-body') ?? document.documentElement).getBoundingClientRect()
      const box = b.getBoundingClientRect()
      const pad = 6
      if (box.right > area.right - pad) shift.value = Math.round(area.right - pad - box.right)
      else if (box.left < area.left + pad) shift.value = Math.round(area.left + pad - box.left)
      if (box.bottom > area.bottom - pad && box.top - r.getBoundingClientRect().height - box.height > area.top) up.value = true
    }
    watch(shown, (v) => { if (v) void nextTick(place) })

    function onDocDown (e: PointerEvent) {
      if (root.value && !root.value.contains(e.target as Node)) pinned.value = false
    }
    watch(pinned, (v) => {
      if (v) document.addEventListener('pointerdown', onDocDown, true)
      else document.removeEventListener('pointerdown', onDocDown, true)
    })
    onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocDown, true))

    return {
      t,
      root,
      bubble,
      hover,
      focused,
      shown,
      shift,
      up,
      bubbleId,
      toggle () { pinned.value = !pinned.value; if (!pinned.value) hover.value = false },
      close () { pinned.value = false; hover.value = false; focused.value = false }
    }
  }
})
</script>

<style>
.settings-panel .help-tip {
  position: relative;
  display: inline-flex;
  vertical-align: middle;
  flex: 0 0 auto;
}
.settings-panel .help-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.45em;
  height: 1.45em;
  padding: 0;
  border: 1px solid var(--edge-2);
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: var(--fs-2xs);
  font-weight: 600;
  line-height: 1;
  cursor: help;
}
.settings-panel .help-btn:hover,
.settings-panel .help-tip.open .help-btn {
  color: var(--ink-0);
  border-color: var(--gold);
}
.settings-panel .help-btn:focus-visible {
  outline: 1px solid var(--gold);
  outline-offset: 1px;
}
.settings-panel .help-bubble {
  position: absolute;
  z-index: 40;
  top: calc(100% + 0.45em);
  left: -0.6em;
  width: max-content;
  max-width: min(26em, 70vw);
  padding: 0.6em 0.75em;
  border: 1px solid var(--edge-2);
  border-radius: var(--radius-m);
  background: var(--surface-2);
  box-shadow: var(--shadow-float);
  color: var(--ink-1);
  font-size: var(--fs-xs);
  font-weight: 400;
  line-height: 1.5;
  letter-spacing: normal;
  text-transform: none;
  white-space: normal;
  text-align: left;
}
.settings-panel .help-bubble.up {
  top: auto;
  bottom: calc(100% + 0.45em);
}
</style>
