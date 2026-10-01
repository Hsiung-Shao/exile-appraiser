<!--
  設定 › 熱鍵與視窗:「徽章外觀」卡片(第 11 步,使用者需求;放在褻瀆 / 符文兩張 OCR 卡片之後,只有 PoE2)。
  符文價格徽章與褻瀆徽章共用 `config.ocrBadgeStyle`(overlay/badge-style.ts):
  - 字體:系統已安裝字體(main IPC `list-fonts`,一次性 PowerShell、快取;失敗 = 只剩「跟隨介面」與內建 Noto Sans TC),上方篩選框;
  - 大小:10–32 px 滑桿 +「跟隨」(null = 褻瀆跟 `--fs-base`、符文跟 `--fs-sm`);粗體;
  - 符文三段價格色(`<input type=color>` +「還原預設」;褻瀆的語意色不受影響);
  - 外框 / 陰影三選一。
  即時套用(沒有儲存 / 取消,照專案慣例)。下方預覽區用與 overlay 相同的 class(`.rs-badge` / `.ocr-badge`)與同一組 CSS 變數,
  底圖左暗右亮(模擬遊戲亮 / 暗背景),是深色島(`.pob-dark`,淺色主題 / 自訂背景模式下也照 overlay 實際外觀)。
-->
<template>
  <section class="card badge-style-card" data-setting="badge-style-section">
    <span class="label">{{ t('ppz.badge_style.section') }}</span>
    <p class="hint">{{ t('ppz.badge_style.hint') }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.badge_style.font') }}</span>
      <div class="ctl bs-font">
        <input v-model="fontFilter" class="input sm bs-filter" type="search" :placeholder="t('ppz.badge_style.font_filter')"
          data-setting="badge-font-filter">
        <select v-model="fontFamily" class="select sm bs-font-select" data-setting="badge-font">
          <option v-for="f in options" :key="f || '__ui'" :value="f">{{ fontLabel(f) }}</option>
        </select>
      </div>
    </div>
    <p v-if="fontsState !== 'ok'" class="foot" data-setting="badge-font-state">{{ fontsStateText }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.badge_style.size') }}</span>
      <div class="ctl" data-setting="badge-size">
        <input v-model.number="sizeSlider" class="slider" type="range" :min="sizeMin" :max="sizeMax" step="1" :class="{ follow: style.fontSize == null }">
        <span class="num bs-size-val">{{ style.fontSize == null ? t('ppz.badge_style.size_follow') : `${style.fontSize}px` }}</span>
        <button class="btn ghost sm" data-action="badge-size-follow" :disabled="style.fontSize == null" @click="style.fontSize = null">{{ t('ppz.badge_style.follow') }}</button>
      </div>
    </div>
    <div class="chk-row">
      <label class="chk"><input v-model="style.bold" type="checkbox" data-setting="badge-bold"><span>{{ t('ppz.badge_style.bold') }}</span></label>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.badge_style.outline') }}</span>
      <div class="ctl">
        <select v-model="style.outline" class="select sm" data-setting="badge-outline">
          <option value="none">{{ t('ppz.badge_style.outline_none') }}</option>
          <option value="shadow">{{ t('ppz.badge_style.outline_shadow') }}</option>
          <option value="outline">{{ t('ppz.badge_style.outline_outline') }}</option>
        </select>
      </div>
    </div>
    <div v-for="k in tiers" :key="k" class="srow">
      <span class="k">{{ t(`ppz.badge_style.tier_${k}`) }}</span>
      <div class="ctl">
        <input class="bs-color" type="color" :value="style.tierColors[k] ?? defaults[k]" :data-setting="`badge-color-${k}`"
          :aria-label="t(`ppz.badge_style.tier_${k}`)" @input="setColor(k, $event)">
        <span class="dim bs-color-val">{{ style.tierColors[k] ?? t('ppz.badge_style.color_default') }}</span>
        <button class="btn ghost sm" :data-action="`badge-color-reset-${k}`" :disabled="!style.tierColors[k]" @click="style.tierColors[k] = null">{{ t('ppz.badge_style.color_reset') }}</button>
      </div>
    </div>
    <p class="foot">{{ t('ppz.badge_style.tier_hint') }}</p>

    <div ref="preview" class="badge-preview pob-dark" data-setting="badge-preview">
      <div class="bp-stage" :style="runeVars">
        <div class="rs-badge tier-low kind-price" data-preview="low"><span class="rs-total">0.3<span class="rs-unit">{{ t('ppz.runeshape.unit_ex') }}</span></span></div>
        <div class="rs-badge tier-mid kind-price" data-preview="mid"><span class="rs-total">2.5<span class="rs-unit">{{ t('ppz.runeshape.unit_ex') }}</span></span></div>
        <div class="rs-badge tier-high kind-price" data-preview="high"><span class="rs-total">3<span class="rs-unit">{{ t('ppz.runeshape.unit_div') }}</span></span></div>
      </div>
      <div class="bp-stage" :style="revealVars">
        <div class="ocr-badge" data-preview="reveal">
          <div class="ocr-row">{{ t('ppz.badge_style.sample_reveal') }}</div>
          <div class="ocr-row fuzzy">≈ {{ t('ppz.badge_style.sample_reveal') }}</div>
        </div>
        <div class="ocr-badge" data-preview="reveal-light">
          <div class="ocr-row">{{ t('ppz.badge_style.sample_reveal') }}</div>
        </div>
      </div>
    </div>
    <div class="srow">
      <span class="k" />
      <div class="ctl">
        <button class="btn sm" data-action="badge-style-reset" :disabled="isDefault" @click="resetAll">{{ t('ppz.badge_style.reset_all') }}</button>
      </div>
    </div>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import {
  BADGE_FONT_SIZE_MAX, BADGE_FONT_SIZE_MIN, BUILTIN_BADGE_FONT, badgeStyleVars, defaultOcrBadgeStyle, fontOptions, isDefaultBadgeStyle, normHexColor,
  type BadgeTier
} from '@/web/overlay/badge-style'

/** 計算後的顏色(`rgb(r, g, b)`)→ `#rrggbb`;讀不到 → 後備值 */
function toHex (css: string, fallback: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css)
  if (!m) return normHexColor(css) ?? fallback
  return '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('')
}

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    const style = computed(() => config.ocrBadgeStyle)

    // ---- 字體 ----
    const systemFonts = shallowRef<string[]>([])
    const fontsState = shallowRef<'loading' | 'ok' | 'empty'>('loading')
    const fontFilter = shallowRef('')
    onMounted(async () => {
      const list = await Host.listFonts()
      systemFonts.value = list
      fontsState.value = list.length ? 'ok' : 'empty'
    })
    const options = computed(() => fontOptions(systemFonts.value, fontFilter.value, style.value.fontFamily))
    const fontFamily = computed({
      get: () => style.value.fontFamily,
      set: (v: string) => { config.ocrBadgeStyle.fontFamily = v }
    })
    const fontLabel = (f: string) => f === '' ? t('ppz.badge_style.font_ui') : f === BUILTIN_BADGE_FONT ? t('ppz.badge_style.font_builtin', { name: f }) : f
    const fontsStateText = computed(() => fontsState.value === 'loading' ? t('ppz.badge_style.font_loading') : t('ppz.badge_style.font_none'))

    // ---- 大小(null = 跟隨;滑桿停在目前實際字級附近) ----
    const sizeSlider = computed({
      get: () => style.value.fontSize ?? Math.min(BADGE_FONT_SIZE_MAX, Math.max(BADGE_FONT_SIZE_MIN, config.fsBase)),
      set: (v: number) => { config.ocrBadgeStyle.fontSize = Math.min(BADGE_FONT_SIZE_MAX, Math.max(BADGE_FONT_SIZE_MIN, Math.round(Number(v)))) }
    })

    // ---- 三段顏色(色票顯示目前主題的預設色;從預覽區的計算樣式讀) ----
    const preview = shallowRef<HTMLElement | null>(null)
    const defaults = shallowRef<Record<BadgeTier, string>>({ low: '#8a8f99', mid: '#d8aa4b', high: '#d8aa4b' })
    onMounted(() => {
      const el = preview.value
      if (!el) return
      const cs = getComputedStyle(el)
      const v = (name: string, fb: string) => toHex(cs.getPropertyValue(name).trim(), fb)
      defaults.value = { low: v('--ink-2', '#8a8f99'), mid: v('--accent', '#d8aa4b'), high: v('--gold', '#d8aa4b') }
    })
    function setColor (k: BadgeTier, e: Event) {
      const c = normHexColor((e.target as HTMLInputElement).value)
      if (c) config.ocrBadgeStyle.tierColors[k] = c
    }

    function resetAll () { config.ocrBadgeStyle = defaultOcrBadgeStyle() }

    return {
      t,
      style,
      fontFilter,
      fontFamily,
      options,
      fontLabel,
      fontsState,
      fontsStateText,
      sizeSlider,
      sizeMin: BADGE_FONT_SIZE_MIN,
      sizeMax: BADGE_FONT_SIZE_MAX,
      tiers: ['low', 'mid', 'high'] as BadgeTier[],
      defaults,
      setColor,
      preview,
      runeVars: computed(() => badgeStyleVars(style.value, 'rune')),
      revealVars: computed(() => badgeStyleVars(style.value, 'reveal')),
      isDefault: computed(() => isDefaultBadgeStyle(style.value)),
      resetAll
    }
  }
})
</script>

<style>
.settings-panel .bs-font { flex-wrap: wrap; }
.settings-panel .bs-filter { flex: 1 1 8em; min-width: 6em; }
.settings-panel .bs-font-select { flex: 2 1 12em; min-width: 8em; }
.settings-panel .bs-size-val { min-width: 3.5em; text-align: right; font-variant-numeric: tabular-nums; }
.settings-panel .slider.follow { opacity: 0.55; }
.settings-panel .bs-color {
  width: 2.4em;
  height: 1.6em;
  padding: 0;
  border: 1px solid var(--edge-1);
  border-radius: var(--radius-s);
  background: none;
  cursor: pointer;
}
.settings-panel .bs-color-val { font-size: var(--fs-sm); font-variant-numeric: tabular-nums; min-width: 4.5em; }
/* 預覽:深色島 + 左暗右亮的底(模擬遊戲畫面亮 / 暗處),徽章用 overlay 同一套 class,只把絕對定位改成排在一起 */
.settings-panel .badge-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 4px;
  padding: 12px;
  border-radius: var(--radius-m);
  border: 1px solid var(--edge-1);
  background: linear-gradient(90deg, #07090c 0%, #1d2430 45%, #8c7a5a 75%, #d9cfb8 100%);
  color: var(--ink-0);
  text-shadow: none;
}
.settings-panel .badge-preview .bp-stage {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-around;
  gap: 10px 18px;
}
.settings-panel .badge-preview .rs-badge,
.settings-panel .badge-preview .ocr-badge {
  position: static;
  transform: none;
}
</style>
