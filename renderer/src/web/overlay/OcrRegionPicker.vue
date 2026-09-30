<!--
  exile-appraiser(WP-S2):在遊戲畫面上直接框選 OCR 辨識區域(只在 overlay 掛;見 docs/reveal-ocr.md「框選辨識區域」)。
  - 開啟:設定 › 熱鍵與視窗 › 靈魂之井褻瀆自動辨識卡片的「在遊戲上框選」,或 `hotkeyOcrRegion` 熱鍵(main 送 `ocr-region-pick`)。
    開啟時呼叫 `overlay-activate`(main `assertOverlayActive`)讓 overlay 可點擊。
  - 畫面:暗幕 rgba(0,0,0,.55),選取框內挖空看得到遊戲原圖;頂部說明條與按鈕是深色島(淺色主題也維持深色,與徽章一致)。
    參考框:目前已存的區域(實線)、上次 OCR 偵測到的面板外框(虛線,`lastDetectedRegion`)。
  - 操作:拖曳新框、框內拖曳移動、8 個把手調大小(最小 40×40 CSS px)、方向鍵移動 1 px(Shift 10 px)、Ctrl + 方向鍵調右 / 下邊。
    幾何全部在 `region-geom.ts`(純函式,有測試)。
  - 確認(Enter / 按鈕):寫 `config.ocrRegion`(client 比例,經 `normOcrRegion`)→ 關層 → `focus-game` → 150 ms 後 `ocr-reveal-now`(請褻瀆自動辨識立刻重看新區域)。
  - 取消:Esc / 按鈕 / overlay 失焦(focus-change overlay=false)/ 視窗隱藏(document hidden)→ 不存、關層。
    overlay 內的 Esc 會先被 main 的 before-input-event 攔下並把焦點還給遊戲 → 走「失焦」取消,結果相同。
  - 由設定視窗開啟(`regionPickerSource === 'settings'`)時,確認 / 取消鈕 / 清除後**回到設定的熱鍵分頁**(App.vue 讀
    `regionPickerClosed`,見 ocr-reveal.ts `returnsToSettings`):這時不 `focus-game`,確認也**不自動試辨識**
    (置中的設定視窗會擋住揭露面板,截圖辨識必失準);失焦 / 視窗隱藏照舊直接結束。熱鍵開啟的行為不變。
  - 框選中 App.vue 忽略背景點擊。不送任何作業系統層輸入。
  - WP-R2 參數化(`ocr-reveal.ts` 的 `regionPickerTarget` / `REGION_PICKER_SPECS`):同一層也框符文塑形面板 —
    目標欄位(`ocrRegion` / `runeshapeRegion`)、確認後動作(試辨識 / 只還焦點)、說明條標題、有沒有「上次偵測」都由 spec 決定。
    `openRegionPicker(source)` 不帶 target = 揭露面板,行為與 WP-S2 相同。
-->
<template>
  <div v-if="open" ref="rootEl" class="ocr-picker pob-dark" data-ocr-picker :data-picker-target="spec.target" tabindex="-1"
    :class="{ dragging: drag != null }"
    @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp">
    <div v-if="!box" class="picker-dim" />
    <div v-if="box" class="picker-sel" data-part="box" data-picker="selection" :style="boxStyle(box)">
      <span v-for="h in handles" :key="h" class="picker-handle" :class="`h-${h}`" :data-handle="h" />
      <span class="picker-size" :class="{ above: sizeAbove }" data-picker="size">{{ sizeText }}</span>
    </div>
    <div v-if="savedBox" class="picker-ref saved" data-picker="saved" :style="boxStyle(savedBox)">
      <span class="ref-label">{{ t('ppz.ocr.region.picker.saved') }}</span>
    </div>
    <div v-if="lastBox" class="picker-ref last" data-picker="last" :style="boxStyle(lastBox)">
      <span class="ref-label">{{ t('ppz.ocr.region.picker.last') }}</span>
    </div>

    <div class="picker-bar" data-picker="bar" @pointerdown.stop>
      <div class="picker-text">
        <span class="picker-help">{{ t(spec.titleKey) }}</span>
        <span class="picker-sub">{{ t(spec.subKey) }}</span>
      </div>
      <div class="picker-actions">
        <button class="btn sm primary" data-action="picker-confirm" :disabled="!box" @click="confirm">{{ t('ppz.ocr.region.picker.confirm') }}</button>
        <button v-if="spec.showLastDetected" class="btn sm" data-action="picker-apply-last" :disabled="!lastRegion" :title="lastRegion ? undefined : t('ppz.ocr.region.picker.no_last')" @click="applyLast">{{ t('ppz.ocr.region.picker.apply_last') }}</button>
        <button class="btn sm" data-action="picker-clear" :disabled="!savedRegion" @click="clearRegion">{{ t('ppz.ocr.region.picker.clear') }}</button>
        <button class="btn sm ghost" data-action="picker-cancel" @click="cancel('取消鈕', true)">{{ t('ppz.ocr.region.picker.cancel') }}</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig, normOcrRegion } from '../Config'
import { Host } from '../background/IPC'
import {
  closeRegionPicker, lastDetectedRegion, openRegionPicker, regionPickerOpen, regionPickerSource, regionPickerSpec, regionPickerTarget,
  returnsToSettings, type RegionPickerOutcome
} from './ocr-reveal'
import {
  HANDLES, dragBox, finishNewBox, fromRegion, moveBox, nudgeBox, regionPercent, resizeBox, toRegion,
  type Box, type Handle, type Pt, type Size
} from './region-geom'

/** 確認後等 overlay 把框選層畫掉、焦點回到遊戲,再自動試辨識 */
const REVEAL_DELAY_MS = 150

type Drag =
  | { kind: 'new', a: Pt, prev: Box | null, pointerId: number }
  | { kind: 'move', start: Box, p0: Pt, pointerId: number }
  | { kind: 'resize', start: Box, handle: Handle, p0: Pt, pointerId: number }

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    const rootEl = shallowRef<HTMLElement | null>(null)
    const box = shallowRef<Box | null>(null)
    const drag = shallowRef<Drag | null>(null)
    const vpSize = shallowRef<Size>({ w: window.innerWidth, h: window.innerHeight })
    const vp = (): Size => ({ w: window.innerWidth || 1, h: window.innerHeight || 1 })

    // WP-R2:框哪一種區域(欄位 / 確認後動作 / 標題)由 spec 決定
    const spec = computed(() => regionPickerSpec(regionPickerTarget.value))
    const savedRegion = computed(() => config[spec.value.field])
    const lastRegion = computed(() => spec.value.showLastDetected ? lastDetectedRegion.value : null)
    const savedBox = computed(() => savedRegion.value ? fromRegion(savedRegion.value, vpSize.value) : null)
    const lastBox = computed(() => lastRegion.value ? fromRegion(lastRegion.value, vpSize.value) : null)

    const sizeText = computed(() => {
      if (!box.value) return ''
      const p = regionPercent(toRegion(box.value, vpSize.value))
      return t('ppz.ocr.region.picker.size', p)
    })
    const sizeAbove = computed(() => box.value != null && box.value.y + box.value.h > vpSize.value.h - 40)

    function boxStyle (b: Box) {
      return { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` }
    }

    // ---- 開 / 關 ----
    function onOpen () {
      vpSize.value = vp()
      box.value = savedRegion.value ? fromRegion(savedRegion.value, vpSize.value) : null
      drag.value = null
      void Host.overlayActivate()
      void nextTick(() => { rootEl.value?.focus() })
      console.log(`[ocr-region] 框選層開啟(${spec.value.target})vp=${vpSize.value.w}x${vpSize.value.h} 目前區域=${savedRegion.value ? JSON.stringify(savedRegion.value) : '無'} 上次偵測=${lastRegion.value ? JSON.stringify(lastRegion.value) : '無'}`)
    }
    watch(regionPickerOpen, (o) => { if (o) onOpen() }, { immediate: true })

    /** 使用者自己結束時:由設定開的 → 回設定(不 focus-game);熱鍵開的 → 焦點回遊戲 */
    const backToSettings = (outcome: RegionPickerOutcome) => returnsToSettings(regionPickerSource.value, outcome)

    function cancel (reason: string, refocusGame: boolean) {
      if (!regionPickerOpen.value) return
      drag.value = null
      const outcome: RegionPickerOutcome = refocusGame ? 'cancel' : 'lost'
      const back = backToSettings(outcome)
      closeRegionPicker(`取消:${reason}${back ? ' → 回到設定' : ''}`, outcome)
      if (refocusGame && !back) Host.focusGame()
    }

    function confirm () {
      const b = box.value
      if (!b) return
      const region = normOcrRegion(toRegion(b, vp()))
      if (!region) {
        console.log(`[ocr-region] 區域無效,略過:${JSON.stringify(b)}`)
        return
      }
      const s = spec.value
      config[s.field] = region
      const back = backToSettings('confirm')
      closeRegionPicker('確認', 'confirm')
      if (back) {
        console.log(`[ocr-region] 已儲存${s.field} ${JSON.stringify(region)}(${JSON.stringify(regionPercent(region))}%)→ 回到設定(不自動試辨識:設定視窗會擋住畫面)`)
        return
      }
      if (s.afterConfirm === 'focus-game') {
        // WP-R2:符文塑形 → 焦點還給遊戲,掃描迴圈自己會開始
        console.log(`[ocr-region] 已儲存${s.field} ${JSON.stringify(region)}(${JSON.stringify(regionPercent(region))}%)→ focus-game`)
        Host.focusGame()
        return
      }
      console.log(`[ocr-region] 已儲存辨識區域 ${JSON.stringify(region)}(${JSON.stringify(regionPercent(region))}%)→ focus-game → ${REVEAL_DELAY_MS} ms 後試辨識`)
      Host.focusGame()
      setTimeout(() => { void Host.ocrRevealNow() }, REVEAL_DELAY_MS)
    }

    function applyLast () {
      if (!lastRegion.value) return
      box.value = fromRegion(lastRegion.value, vp())
      rootEl.value?.focus()
    }

    function clearRegion () {
      const field = spec.value.field
      config[field] = null
      const back = backToSettings('clear')
      closeRegionPicker(`清除區域${back ? ' → 回到設定' : ''}`, 'clear')
      console.log(field === 'ocrRegion' ? '[ocr-region] 已清除辨識區域(改回整個畫面)' : `[ocr-region] 已清除 ${field}`)
      if (!back) Host.focusGame()
    }

    // ---- 滑鼠(指標):新框 / 移動 / 把手 ----
    const pt = (e: PointerEvent): Pt => ({ x: e.clientX, y: e.clientY })

    function onPointerDown (e: PointerEvent) {
      if (e.button !== 0) return
      const target = e.target as HTMLElement | null
      const handle = target?.closest<HTMLElement>('[data-handle]')?.dataset.handle as Handle | undefined
      const inBox = target?.closest('[data-part="box"]') != null
      const p = pt(e)
      vpSize.value = vp()
      if (handle && box.value) drag.value = { kind: 'resize', start: box.value, handle, p0: p, pointerId: e.pointerId }
      else if (inBox && box.value) drag.value = { kind: 'move', start: box.value, p0: p, pointerId: e.pointerId }
      else drag.value = { kind: 'new', a: p, prev: box.value, pointerId: e.pointerId }
      e.preventDefault()
      try { rootEl.value?.setPointerCapture(e.pointerId) } catch { /* 合成事件沒有對應的指標 */ }
      rootEl.value?.focus()
    }

    function onPointerMove (e: PointerEvent) {
      const d = drag.value
      if (!d) return
      const p = pt(e)
      const v = vp()
      if (d.kind === 'new') box.value = dragBox(d.a, p, v)
      else if (d.kind === 'move') box.value = moveBox(d.start, p.x - d.p0.x, p.y - d.p0.y, v)
      else box.value = resizeBox(d.start, d.handle, p.x - d.p0.x, p.y - d.p0.y, v)
    }

    function onPointerUp (e: PointerEvent) {
      const d = drag.value
      if (!d) return
      if (d.kind === 'new') box.value = finishNewBox(d.a, pt(e), vp()) ?? d.prev
      else onPointerMove(e)
      drag.value = null
      try { rootEl.value?.releasePointerCapture(d.pointerId) } catch { /* 同上 */ }
    }

    // ---- 鍵盤 ----
    function onKey (e: KeyboardEvent) {
      if (!regionPickerOpen.value) return
      if (e.key === 'Enter') {
        e.preventDefault()
        confirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancel('Esc', true)
      } else if (box.value) {
        const next = nudgeBox(box.value, e.key, { shift: e.shiftKey, ctrl: e.ctrlKey }, vp())
        if (!next) return
        e.preventDefault()
        box.value = next
      } else {
        return
      }
      e.stopPropagation()
    }

    const onVisibilityChange = () => { if (document.hidden) cancel('視窗隱藏', false) }
    const onResize = () => { vpSize.value = vp() }
    const unsub: Array<() => void> = []
    onMounted(() => {
      // 2026-10-01:符文塑形的框選熱鍵帶 target = runeshape;揭露面板不帶
      unsub.push(Host.onOcrRegionPick((target) => { openRegionPicker('hotkey', target === 'runeshape' ? 'runeshape' : 'reveal') }))
      // overlay 失焦(Esc / Ctrl+W / overlayKey / 點回遊戲)→ 取消;只看 overlay 旗標,Alt 隱藏(visibility 事件)不取消
      unsub.push(Host.onFocusChange((s) => { if (!s.overlay) cancel('overlay 失焦', false) }))
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('resize', onResize)
      document.addEventListener('visibilitychange', onVisibilityChange)
    })
    onUnmounted(() => {
      unsub.forEach(fn => fn())
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    })

    return {
      t,
      spec,
      open: regionPickerOpen,
      rootEl,
      box,
      drag,
      handles: HANDLES,
      savedRegion,
      lastRegion,
      savedBox,
      lastBox,
      sizeText,
      sizeAbove,
      boxStyle,
      confirm,
      cancel,
      applyLast,
      clearRegion,
      onPointerDown,
      onPointerMove,
      onPointerUp
    }
  }
})
</script>

<style>
.ocr-picker {
  position: absolute;
  inset: 0;
  z-index: 60;
  pointer-events: auto;
  cursor: crosshair;
  outline: none;
  font-family: var(--font-ui);
  user-select: none;
  touch-action: none;
}
.ocr-picker .picker-dim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
}
/* 選取框:外側用超大 box-shadow 當暗幕,框內挖空 */
.ocr-picker .picker-sel {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid var(--gold);
  box-shadow: 0 0 0 200vmax rgba(0, 0, 0, 0.55);
  cursor: move;
}
.ocr-picker.dragging .picker-sel { cursor: grabbing; }
.ocr-picker .picker-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -6px 0 0 -6px;
  background: var(--gold);
  border: 1px solid rgba(0, 0, 0, 0.75);
  border-radius: 1px;
}
.ocr-picker .h-nw { left: 0; top: 0; cursor: nwse-resize; }
.ocr-picker .h-n { left: 50%; top: 0; cursor: ns-resize; }
.ocr-picker .h-ne { left: 100%; top: 0; cursor: nesw-resize; }
.ocr-picker .h-e { left: 100%; top: 50%; cursor: ew-resize; }
.ocr-picker .h-se { left: 100%; top: 100%; cursor: nwse-resize; }
.ocr-picker .h-s { left: 50%; top: 100%; cursor: ns-resize; }
.ocr-picker .h-sw { left: 0; top: 100%; cursor: nesw-resize; }
.ocr-picker .h-w { left: 0; top: 50%; cursor: ew-resize; }
.ocr-picker .picker-size {
  position: absolute;
  left: -2px;
  top: calc(100% + 8px);
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--surface-1-c);
  color: var(--ink-0);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}
.ocr-picker .picker-size.above { top: auto; bottom: calc(100% + 8px); }
/* 參考框:不吃指標 */
.ocr-picker .picker-ref {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
}
.ocr-picker .picker-ref.saved { border: 1px solid color-mix(in srgb, var(--ink-0) 70%, transparent); }
.ocr-picker .picker-ref.last { border: 2px dashed var(--accent); }
.ocr-picker .ref-label {
  position: absolute;
  left: 0;
  bottom: calc(100% + 3px);
  padding: 1px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--surface-1-c) 88%, transparent);
  color: var(--ink-1);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.ocr-picker .picker-ref.last .ref-label { color: var(--accent); left: auto; right: 0; }
/* 頂部說明條(深色島) */
.ocr-picker .picker-bar {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: calc(100vw - 32px);
  padding: 8px 10px 8px 14px;
  border-radius: var(--radius-m, 6px);
  border-left: 3px solid var(--gold);
  background: var(--surface-1-c);
  box-shadow: var(--shadow-float);
  color: var(--ink-0);
  cursor: default;
}
.ocr-picker .picker-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ocr-picker .picker-help { font-size: var(--fs-sm); font-weight: 600; }
.ocr-picker .picker-sub { font-size: var(--fs-2xs); color: var(--ink-2); }
.ocr-picker .picker-actions { display: flex; gap: 6px; flex-shrink: 0; }
</style>
