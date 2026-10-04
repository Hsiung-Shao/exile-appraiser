<!--
  設定 › 自動辨識:「徽章外觀」卡片(第 11 步,使用者需求;放在褻瀆 / 符文兩張 OCR 卡片之後,只有 PoE2)。
  第 39 步:符文價格的顏色門檻(`runeshapeThresholds`,原本在符文塑形卡片)搬來和三段顏色放在一起(「符文價格顏色」小節)。
  符文價格徽章與褻瀆徽章共用 `config.ocrBadgeStyle`(overlay/badge-style.ts):
  - 字體:系統已安裝字體(main IPC `list-fonts`,一次性 PowerShell、快取;失敗 = 只剩「跟隨介面」與內建 Noto Sans TC),上方篩選框;
  - 大小:10–32 px 滑桿 +「跟隨」(null = 褻瀆跟 `--fs-base`、符文跟 `--fs-sm`);粗體;
  - 符文三段價格色(`<input type=color>` +「還原預設」;褻瀆的語意色不受影響);
  - 外框 / 陰影三選一。
  即時套用(沒有儲存 / 取消,照專案慣例);拖曳字級滑桿 / 色票選色中預覽用本地草稿即時更新,放開(change)才寫設定。下方預覽區用與 overlay 相同的 class(`.rs-badge` / `.ocr-badge`)與同一組 CSS 變數,
  底圖左暗右亮(模擬遊戲亮 / 暗背景),是深色島(`.pob-dark`,淺色主題 / 自訂背景模式下也照 overlay 實際外觀)。
-->
<template>
  <section class="card badge-style-card" data-setting="badge-style-section">
    <div class="card-head">
      <span class="label">{{ t('ppz.badge_style.section') }}</span>
      <help-tip id="badge-style" :text="t('ppz.badge_style.help')" />
    </div>
    <p class="lead">{{ t('ppz.badge_style.hint') }}</p>
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
        <input :value="sizeSlider" class="slider" type="range" :min="sizeMin" :max="sizeMax" step="1" :class="{ follow: shownSize == null }"
          @input="onSizeInput" @change="onSizeChange">
        <span class="num bs-size-val">{{ shownSize == null ? t('ppz.badge_style.size_follow') : `${shownSize}px` }}</span>
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
    <span class="sublabel" data-setting="badge-price-colors">{{ t('ppz.badge_style.price_colors') }} <help-tip id="badge-tiers" :text="t('ppz.badge_style.tier_hint')" /></span>
    <div class="srow">
      <span class="k">{{ t('ppz.runeshape.thresholds') }}</span>
      <div class="ctl">
        <span class="dim">{{ t('ppz.runeshape.threshold_low') }}</span>
        <input v-model.lazy.number="thresholdDraft.low" class="input sm rs-num" type="number" min="0" step="0.1" data-setting="runeshape-threshold-low" @change="applyThresholds">
        <span class="dim">{{ t('ppz.runeshape.threshold_high') }}</span>
        <input v-model.lazy.number="thresholdDraft.high" class="input sm rs-num" type="number" min="0" step="0.5" data-setting="runeshape-threshold-high" @change="applyThresholds">
        <span class="dim">{{ t('ppz.runeshape.unit_ex') }}</span>
      </div>
    </div>
    <div v-for="k in tiers" :key="k" class="srow">
      <span class="k">{{ t(`ppz.badge_style.tier_${k}`) }}</span>
      <div class="ctl">
        <input class="bs-color" type="color" :value="draftColors[k] ?? style.tierColors[k] ?? defaults[k]" :data-setting="`badge-color-${k}`"
          :aria-label="t(`ppz.badge_style.tier_${k}`)" @input="previewColor(k, $event)" @change="commitColor(k, $event)">
        <span class="dim bs-color-val">{{ draftColors[k] ?? style.tierColors[k] ?? t('ppz.badge_style.color_default') }}</span>
        <button class="btn ghost sm" :data-action="`badge-color-reset-${k}`" :disabled="!style.tierColors[k]" @click="style.tierColors[k] = null">{{ t('ppz.badge_style.color_reset') }}</button>
      </div>
    </div>

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
import { computed, defineComponent, onMounted, reactive, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig, normRuneshapeThresholds } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import {
  BADGE_FONT_SIZE_MAX, BADGE_FONT_SIZE_MIN, BUILTIN_BADGE_FONT, badgeStyleVars, defaultOcrBadgeStyle, fontOptions, isDefaultBadgeStyle, normHexColor,
  type BadgeTier
} from '@/web/overlay/badge-style'
import HelpTip from './HelpTip.vue'

/** 計算後的顏色(`rgb(r, g, b)`)→ `#rrggbb`;讀不到 → 後備值 */
function toHex (css: string, fallback: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css)
  if (!m) return normHexColor(css) ?? fallback
  return '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('')
}

export default defineComponent({
  components: { HelpTip },
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
    // 拖曳中只改本地草稿(預覽即時),放開(change)才寫設定(code review 第 D 批:原本每個 input 事件都寫設定 + 送 main)
    const clampSize = (v: number) => Math.min(BADGE_FONT_SIZE_MAX, Math.max(BADGE_FONT_SIZE_MIN, Math.round(Number(v))))
    const draftSize = shallowRef<number | null>(null)
    /** 目前顯示的字級(草稿優先;null = 跟隨) */
    const shownSize = computed(() => draftSize.value ?? style.value.fontSize)
    const sizeSlider = computed(() => shownSize.value ?? Math.min(BADGE_FONT_SIZE_MAX, Math.max(BADGE_FONT_SIZE_MIN, config.fsBase)))
    function onSizeInput (e: Event) { draftSize.value = clampSize(Number((e.target as HTMLInputElement).value)) }
    function onSizeChange (e: Event) {
      config.ocrBadgeStyle.fontSize = clampSize(Number((e.target as HTMLInputElement).value))
      draftSize.value = null
    }

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
    // 色票同樣:拖曳選色中只更新預覽草稿,確定(change)才寫設定
    const draftColors = shallowRef<Partial<Record<BadgeTier, string>>>({})
    function previewColor (k: BadgeTier, e: Event) {
      const c = normHexColor((e.target as HTMLInputElement).value)
      if (c) draftColors.value = { ...draftColors.value, [k]: c }
    }
    function commitColor (k: BadgeTier, e: Event) {
      const c = normHexColor((e.target as HTMLInputElement).value)
      if (c) config.ocrBadgeStyle.tierColors[k] = c
      const { [k]: _drop, ...rest } = draftColors.value
      draftColors.value = rest
    }
    /** 預覽用外觀:設定 + 還沒寫回的草稿 */
    const previewStyle = computed(() => {
      const s = style.value
      if (draftSize.value == null && !Object.keys(draftColors.value).length) return s
      return { ...s, fontSize: draftSize.value ?? s.fontSize, tierColors: { ...s.tierColors, ...draftColors.value } }
    })

    function resetAll () { config.ocrBadgeStyle = defaultOcrBadgeStyle() }

    // ---- WP-R2:符文塑形顏色門檻(第 39 步從符文卡片搬來;門檻不屬於「還原外觀」的範圍) ----
    const thresholdDraft = reactive({ low: config.runeshapeThresholds.low, high: config.runeshapeThresholds.high })
    watch(() => config.runeshapeThresholds, (v) => { thresholdDraft.low = v.low; thresholdDraft.high = v.high })
    function applyThresholds () {
      config.runeshapeThresholds = normRuneshapeThresholds({ low: Number(thresholdDraft.low), high: Number(thresholdDraft.high) })
      thresholdDraft.low = config.runeshapeThresholds.low
      thresholdDraft.high = config.runeshapeThresholds.high
    }

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
      shownSize,
      onSizeInput,
      onSizeChange,
      sizeMin: BADGE_FONT_SIZE_MIN,
      sizeMax: BADGE_FONT_SIZE_MAX,
      tiers: ['low', 'mid', 'high'] as BadgeTier[],
      defaults,
      draftColors,
      previewColor,
      commitColor,
      preview,
      runeVars: computed(() => badgeStyleVars(previewStyle.value, 'rune')),
      revealVars: computed(() => badgeStyleVars(previewStyle.value, 'reveal')),
      isDefault: computed(() => isDefaultBadgeStyle(style.value)),
      resetAll,
      thresholdDraft,
      applyThresholds
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
