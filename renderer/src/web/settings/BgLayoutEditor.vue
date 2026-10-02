<!--
  設定 › 一般 › 背景:一個容器(查價面板 / 設定視窗)的「顯示位置與填滿方式」(第 26 步,2026-10-03,使用者需求)。
  - 預覽框:長寬比 = 該容器最後一次量到的實際大小(BgLayer.vue 寫 `bgHostSize`),沒量過用代表比例;
    畫法與 BgLayer 的 CSS 路徑同一條公式(`bgCssLayout`),只套亮度、不套霧面(看得清位置);
  - 在框上拖曳準心 = 焦點(圖上要保持可見的位置;圖上 x% 的點落在框的 x% 處),pointer events + setPointerCapture;
    方向鍵每次 1%(Shift 10%);
  - 水平 / 垂直滑桿 0–100%、填滿方式三選一(填滿 / 完整顯示 / 縮放)、縮放滑桿 100–300%(只在「縮放」時可用)、「還原」;
  - 拖曳 / 滑桿中只改本地草稿(預覽即時),放開(pointerup / change)才寫設定(照 BadgeStyleSection 第 D 批的做法)。
  設定視窗內尺寸一律用 em(不跟 rem,第 21 步獨立字級)。純函式在 ../bg-layout-ui.ts。
-->
<template>
  <div class="bgl" :data-setting="`bg-layout-${host}`">
    <span class="bgl-title">{{ t(`ppz.bg.layout.host_${host}`) }}</span>
    <div ref="box" class="bgl-box" :style="boxStyle" tabindex="0" role="slider"
      :aria-label="t('ppz.bg.layout.preview_aria', { host: t(`ppz.bg.layout.host_${host}`) })"
      :aria-valuetext="`${shown.x}% / ${shown.y}%`" :data-dragging="dragging ? '' : undefined"
      @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onCancel" @keydown="onKey">
      <div class="bgl-img" :style="imgStyle" />
      <span class="bgl-cross" :style="{ left: `${shown.x}%`, top: `${shown.y}%` }" aria-hidden="true" />
    </div>
    <div class="bgl-ctl">
      <div class="seg" :data-setting="`bg-fit-${host}`">
        <button v-for="f in fits" :key="f" :class="{ on: shown.fit === f }" :data-value="f" @click="commit({ fit: f })">{{ t(`ppz.bg.layout.fit_${f}`) }}</button>
      </div>
      <label class="bgl-row">
        <span class="k">{{ t('ppz.bg.layout.pos_x') }}</span>
        <input :value="shown.x" class="slider" type="range" min="0" max="100" step="1" :data-setting="`bg-x-${host}`"
          @input="draftField('x', $event)" @change="commitField('x', $event)">
        <span class="num fs-val">{{ shown.x }}%</span>
      </label>
      <label class="bgl-row">
        <span class="k">{{ t('ppz.bg.layout.pos_y') }}</span>
        <input :value="shown.y" class="slider" type="range" min="0" max="100" step="1" :data-setting="`bg-y-${host}`"
          @input="draftField('y', $event)" @change="commitField('y', $event)">
        <span class="num fs-val">{{ shown.y }}%</span>
      </label>
      <label class="bgl-row" :class="{ off: shown.fit !== 'zoom' }">
        <span class="k">{{ t('ppz.bg.layout.zoom') }}</span>
        <input :value="shown.zoom" class="slider" type="range" :min="zoomMin" :max="zoomMax" step="5" :disabled="shown.fit !== 'zoom'"
          :data-setting="`bg-zoom-${host}`" @input="draftField('zoom', $event)" @change="commitField('zoom', $event)">
        <span class="num fs-val">{{ shown.zoom }}%</span>
      </label>
      <div>
        <button class="btn ghost sm" :data-action="`bg-layout-reset-${host}`" :disabled="isDefault" @click="reset">{{ t('ppz.bg.layout.reset') }}</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, shallowRef, watch, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '@/web/Config'
import { BG_FITS, BG_ZOOM_MAX, BG_ZOOM_MIN, bgCssLayout, type BgLayout } from '@/web/bg-bake'
import { bgHostSize, normBgLayout, type BgHost } from '@/web/useTheme'
import { BG_PREVIEW_FALLBACK_RATIO, bgLayoutKeyStep, isDefaultBgLayout, pointerToFocus, previewBoxEm } from './bg-layout-ui'

export default defineComponent({
  props: {
    host: { type: String as PropType<BgHost>, required: true },
    /** 預覽用的背景圖網址(未包 url()) */
    url: { type: String, required: true },
    /** 亮度 0–100(預覽套一樣的亮度) */
    bright: { type: Number, default: 100 }
  },
  setup (props) {
    const { t } = useI18n()
    const config = AppConfig()
    const box = shallowRef<HTMLElement | null>(null)
    const saved = computed<BgLayout>(() => config.bg.layout[props.host])
    const draft = shallowRef<Partial<BgLayout> | null>(null)
    const shown = computed<BgLayout>(() => ({ ...saved.value, ...draft.value }))
    const dragging = shallowRef(false)

    // 圖的原始大小(「縮放」預覽要換成百分比)
    const natural = shallowRef<{ url: string, w: number, h: number } | null>(null)
    let alive = true
    watch(() => props.url, (url) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      img.decode().then(() => {
        if (alive && props.url === url) natural.value = { url, w: img.naturalWidth, h: img.naturalHeight }
      }).catch(() => {}).finally(() => { img.removeAttribute('src') })
    }, { immediate: true })
    onBeforeUnmount(() => { alive = false })

    const ratio = computed(() => {
      const s = bgHostSize.value[props.host]
      return s && s.w > 0 && s.h > 0 ? s.w / s.h : BG_PREVIEW_FALLBACK_RATIO[props.host]
    })
    const boxEm = computed(() => previewBoxEm(ratio.value))
    const boxStyle = computed(() => ({ width: `${boxEm.value.w}em`, height: `${boxEm.value.h}em` }))
    const imgStyle = computed(() => {
      const n = natural.value?.url === props.url ? natural.value : null
      const css = bgCssLayout(shown.value, n, { w: boxEm.value.w * 100, h: boxEm.value.h * 100 }) ?? { pos: '50% 50%', size: 'cover' }
      return {
        backgroundImage: `url("${props.url.replace(/["\\]/g, '\\$&')}")`,
        backgroundPosition: css.pos,
        backgroundSize: css.size,
        filter: `brightness(${props.bright / 100})`
      }
    })

    function commit (patch: Partial<BgLayout>): void {
      config.bg.layout[props.host] = normBgLayout({ ...saved.value, ...draft.value, ...patch })
      draft.value = null
    }
    const num = (e: Event) => Number((e.target as HTMLInputElement).value)

    // ---- 拖曳準心(拖曳中只改草稿,放開才寫設定) ----
    function at (e: PointerEvent): { x: number, y: number } | null {
      const el = box.value
      return el ? pointerToFocus(e.clientX, e.clientY, el.getBoundingClientRect()) : null
    }
    function onDown (e: PointerEvent): void {
      if (e.button !== 0) return
      const p = at(e)
      if (!p) return
      e.preventDefault()
      box.value?.focus({ preventScroll: true })
      try { box.value?.setPointerCapture(e.pointerId) } catch { /* 合成事件沒有對應的指標 */ }
      dragging.value = true
      draft.value = { ...draft.value, ...p }
    }
    function onMove (e: PointerEvent): void {
      if (!dragging.value) return
      const p = at(e)
      if (p) draft.value = { ...draft.value, ...p }
    }
    function onUp (e: PointerEvent): void {
      if (!dragging.value) return
      dragging.value = false
      commit(at(e) ?? {})
    }
    function onCancel (): void {
      if (!dragging.value) return
      dragging.value = false
      draft.value = null
    }
    function onKey (e: KeyboardEvent): void {
      const d = bgLayoutKeyStep(shown.value, e.key, e.shiftKey)
      if (!d) return
      e.preventDefault()
      commit(d)
    }

    return {
      t,
      box,
      shown,
      dragging,
      boxStyle,
      imgStyle,
      fits: BG_FITS,
      zoomMin: BG_ZOOM_MIN,
      zoomMax: BG_ZOOM_MAX,
      isDefault: computed(() => isDefaultBgLayout(saved.value)),
      commit,
      onDown,
      onMove,
      onUp,
      onCancel,
      onKey,
      draftField (k: 'x' | 'y' | 'zoom', e: Event) { draft.value = { ...draft.value, [k]: num(e) } },
      commitField (k: 'x' | 'y' | 'zoom', e: Event) { commit({ [k]: num(e) }) },
      reset () { draft.value = null; config.bg.layout[props.host] = normBgLayout(undefined) }
    }
  }
})
</script>

<style>
.settings-panel .bg-layouts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9em 1.4em;
  margin: 0.3em 0 0.5em;
}
.settings-panel .bgl {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.5em 0.8em;
  min-width: 0;
  flex: 1 1 22em;
}
.settings-panel .bgl-title {
  flex: 0 0 100%;
  font-size: var(--fs-xs);
  color: var(--ink-1);
}
.settings-panel .bgl-box {
  position: relative;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: var(--radius-s);
  border: 1px solid var(--edge-1);
  background: var(--surface-0-c);
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}
.settings-panel .bgl-box:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
.settings-panel .bgl-img {
  position: absolute;
  inset: 0;
  background-repeat: no-repeat;
  pointer-events: none;
}
/* 準心:白線 + 深色描邊,任何圖上都看得到 */
.settings-panel .bgl-cross {
  position: absolute;
  width: 1.2em;
  height: 1.2em;
  margin: -0.6em 0 0 -0.6em;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.75), inset 0 0 0 1px rgba(0, 0, 0, 0.75);
  pointer-events: none;
}
.settings-panel .bgl-cross::before,
.settings-panel .bgl-cross::after {
  content: '';
  position: absolute;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
}
.settings-panel .bgl-cross::before {
  left: 50%;
  top: -0.55em;
  bottom: -0.55em;
  width: 2px;
  margin-left: -1px;
}
.settings-panel .bgl-cross::after {
  top: 50%;
  left: -0.55em;
  right: -0.55em;
  height: 2px;
  margin-top: -1px;
}
.settings-panel .bgl-ctl {
  display: flex;
  flex-direction: column;
  gap: 0.35em;
  flex: 1 1 12em;
  min-width: 12em;
}
.settings-panel .bgl-row {
  display: flex;
  align-items: center;
  gap: 0.5em;
}
.settings-panel .bgl-row .k {
  flex: 0 0 auto;
  min-width: 4.5em;
  font-size: var(--fs-xs);
  color: var(--ink-1);
}
.settings-panel .bgl-row.off {
  opacity: 0.55;
}
</style>
