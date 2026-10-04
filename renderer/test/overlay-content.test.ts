// 第五輪 30.4:overlay 上有沒有東西要畫的回報(overlay/overlay-content.ts)與接線守門;
// 限流狀態鈕只在查價面板可見時掛載(展開時的 1 秒輪詢跟著停)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { overlayContentKey, overlayContentOf, overlayLayers } from '../src/web/overlay/overlay-content'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('overlayContentOf / overlayContentKey', () => {
  it('App 狀態 + 徽章層合成回報;鍵逐欄不同', () => {
    const c = overlayContentOf({ panel: true, settings: false, picker: false }, { reveal: false, rune: true })
    expect(c).toEqual({ panel: true, settings: false, picker: false, reveal: false, rune: true, quick: false })
    // 第 33 步:快速面板
    expect(overlayContentOf({ panel: false, settings: false, picker: false, quick: true }, { reveal: false, rune: false }).quick).toBe(true)
    const keys = new Set<string>()
    for (let i = 0; i < 64; i++) {
      keys.add(overlayContentKey({ panel: !!(i & 1), settings: !!(i & 2), picker: !!(i & 4), reveal: !!(i & 8), rune: !!(i & 16), quick: !!(i & 32) }))
    }
    expect(keys.size).toBe(64)
  })
  it('徽章層狀態預設 false', () => {
    expect({ ...overlayLayers }).toEqual({ reveal: false, rune: false })
  })
})

describe('接線守門', () => {
  const app = read('../src/web/App.vue')
  it('App.vue:只在 overlay 回報;面板 / 設定 / 框選層 + overlayLayers;相同不重送', () => {
    const i = app.indexOf('Host.overlayContent(c)')
    expect(i).toBeGreaterThan(-1)
    const block = app.slice(app.lastIndexOf('if (isOverlay) {', i), i)
    expect(block).toContain('overlayContentOf({ panel: panelShown.value, settings: settingsVisible.value, picker: regionPickerOpen.value, quick: regexQuickOpen.value }, overlayLayers)')
    expect(block).toContain('if (key === lastContentKey) return')
    expect(block).toContain('{ immediate: true }')
  })
  it('兩個徽章層寫 overlayLayers(卸載寫回 false)', () => {
    const ocr = read('../src/web/overlay/OcrBadges.vue')
    expect(ocr).toContain("watch(() => state.value !== 'idle', (v) => { overlayLayers.reveal = v }, { immediate: true })")
    expect(ocr).toContain('overlayLayers.reveal = false')
    const rune = read('../src/web/overlay/RuneshapePrices.vue')
    // 層內提示(暫停 / 繼續 / 台服)也算要畫的東西
    expect(rune).toContain('const active = computed(() => state.value !== \'idle\' || toast.value != null)')
    expect(rune).toContain('watch(active, (v) => { overlayLayers.rune = v }, { immediate: true })')
    expect(rune).toContain('overlayLayers.rune = false')
  })
  it('IPC 轉接', () => {
    expect(read('../src/web/background/IPC.ts')).toContain('overlayContent (s: OverlayContentState): void { window.host?.overlayContent?.(s) }')
  })
  it('限流狀態鈕(RateLimiterState)只在查價面板可見時掛載(overlay 側邊與 window 底列)', () => {
    const tags = app.match(/<component :is="rateLimiterComponent"[^>]*>/g) ?? []
    expect(tags.length).toBe(2)
    for (const t of tags) expect(t).toMatch(/v-if="[^"]*panelVisible"/)
  })
})
