<!--
  exile-appraiser(WP-S):靈魂之井三選一揭露面板的褻瀆徽章層(只在 overlay 掛;見 docs/reveal-ocr.md)。
  - 2026-10-01 起收 main 褻瀆自動辨識的 `reveal-scan-result`(`main/src/ocr/reveal-scan.ts`,持續掃描):
    `rows` → 交給 PoE2 `matchRevealLines`(@poe2-entry)比對,每組右側一枚徽章(`T4 · 一般 · 21–26 / 20–25`,候選多個就多列;
    profile 不精確加「?」;模糊命中前面加「≈」;對不上的行灰色列 OCR 原文);比對不成面板(背包物品浮窗之類)→ 靜靜清掉、不跳錯誤。
    `empty`(面板關了)/ `inactive`(停止)/ `user-paused` → 清除。沒有 15 秒自動消失、沒有「再按一次清除」(ocr-reveal.ts `revealScanAction`)。
  - 與查價面板是兄弟層(不受 panelShown 控制);overlay 視窗改大小 → 以最後一次結果重新排位置。
  - Esc(overlay 有焦點時)暫時清掉,下一個有列的事件再畫。
  - `pointer-events: none`:不擋遊戲操作。
  - WP-S2:比對成功時記下面板外框(`lastDetectedRegion`,框選層的「上次偵測」參考框);事件帶 `fallback`(框選區域內沒找到、改找整個畫面)
    剛切過去時提示 5 秒;框選層開啟時清掉徽章。
-->
<template>
  <div v-if="state !== 'idle'" class="ocr-layer pob-dark" :data-ocr-state="state">
    <div v-for="b in badges" :key="b.key" class="ocr-badge" data-ocr="badge"
      :style="{ left: `${b.left}px`, top: `${b.top}px` }">
      <div v-for="(r, i) in b.rows" :key="i" class="ocr-row" :class="{ fuzzy: r.fuzzy }"
        :title="r.fuzzy ? t('ppz.ocr.fuzzy_title') : b.guess ? t('ppz.ocr.guess_title') : undefined">{{ r.text }}</div>
      <div v-if="b.empty" class="ocr-row dim">{{ t('ppz.ocr.no_candidate') }}</div>
      <div v-for="(u, i) in b.unmatched" :key="`u${i}`" class="ocr-row raw">{{ t('ppz.ocr.unmatched', { text: u }) }}</div>
    </div>
    <div v-if="guess" class="ocr-note" data-ocr="guess-note">{{ t('ppz.ocr.guess_title') }}</div>
    <!-- WP-S2:框選區域內沒找到面板、改找整個畫面才找到 → 提示一次(5 秒) -->
    <div v-if="fallback" class="ocr-toast warn" data-ocr="region-fallback">{{ t('ppz.ocr.region.fallback') }}</div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RevealScanEvent } from '@ipc/types'
import * as Poe2 from '@poe2-entry'
import { Host } from '../background/IPC'
import { loadedGame } from '../games/active'
import {
  fallbackNoteShows, lastDetectedRegion, lastPoe2Item, layoutBadges, profileHint, regionPickerOpen, revealScanAction, tierText, type BadgeView
} from './ocr-reveal'
import { detectedRegion } from './region-geom'

/** WP-S2:「區域內沒找到,已改找整個畫面」提示顯示多久 */
const FALLBACK_NOTE_MS = 5_000

type State = 'idle' | 'result'
type OkResult = Extract<ReturnType<typeof Poe2.matchRevealLines>, { ok: true }>

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const state = shallowRef<State>('idle')
    const badges = shallowRef<BadgeView[]>([])
    const guess = shallowRef(false)
    const fallback = shallowRef(false)
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null
    /** 上一個有列的事件是不是退回模式(提示只在剛切過去時顯示) */
    let prevFallback = false
    /** 最後一次比對成功的結果(overlay 改大小時重新排位置) */
    let last: { r: OkResult, client: { w: number, h: number } } | null = null
    /** 同一種「比對不成面板」只記一次 log(持續掃描時每秒一行太吵) */
    let lastMissLog = ''

    function setFallback (on: boolean) {
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null }
      fallback.value = on
      if (on) fallbackTimer = setTimeout(() => { fallback.value = false }, FALLBACK_NOTE_MS)
    }
    function clear (reason: string) {
      last = null
      if (state.value === 'idle') return
      setFallback(false)
      state.value = 'idle'
      badges.value = []
      console.log(`[ocr] 清除徽章(${reason})`)
    }
    function layout () {
      if (!last) return
      const tr = (k: string, a?: unknown) => t(k, a as Record<string, unknown>)
      badges.value = layoutBadges(last.r, last.client, { w: window.innerWidth, h: window.innerHeight }, {
        tier: tierText,
        pool: c => Poe2.revealPoolLabel(c, tr),
        range: c => Poe2.revealRangeLabel(c.ranges)
      })
    }

    function onEvent (e: RevealScanEvent) {
      const act = revealScanAction(e, loadedGame.value === 'poe2' ? 'poe2' : 'poe1')
      if (act.kind === 'ignore') return
      if (act.kind === 'clear') {
        prevFallback = false
        clear(act.reason)
        return
      }
      const hint = profileHint(lastPoe2Item.value)
      const r = Poe2.matchRevealLines(e.rows, hint)
      if (!r || !r.ok) {
        // 畫面上有 ≥ 2 行像詞綴、但湊不成 2–3 組的面板(背包物品浮窗等)→ 不是揭露面板,靜靜清掉
        const why = r ? 'no-panel' : 'no-data'
        if (why !== lastMissLog) console.log(`[ocr] 不是揭露面板(${why});OCR ${e.rows.length} 行:${e.rows.map(l => l.text.replace(/\s+/g, '')).join(' | ').slice(0, 200)}`)
        lastMissLog = why
        clear(why)
        return
      }
      lastMissLog = ''
      last = { r, client: e.client }
      layout()
      guess.value = !r.profileExact
      state.value = 'result'
      // WP-S2:框選層的「上次偵測」參考框;區域內沒找到才找到 → 剛切過去時提示一次
      lastDetectedRegion.value = detectedRegion(r.groups, e.client)
      if (fallbackNoteShows(e.fallback, prevFallback)) setFallback(true)
      prevFallback = Boolean(e.fallback)
      console.log(`[ocr] #${e.seq} ${r.groups.length} 組(profile ${r.profileSource}${hint.refName ? ` ${hint.refName}` : ''}${e.fallback ? ';區域退回' : ''}` +
        `${e.timings?.ocrWallMs != null ? `;OCR ${e.timings.ocrWallMs} ms` : ''}):` +
        badges.value.map(b => b.rows.map(x => x.text).join(' / ') || '—').join(' | '))
    }

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clear('Esc') }
    const onResize = () => { layout() }
    const unsub: Array<() => void> = []
    onMounted(() => {
      unsub.push(Host.onRevealScanResult(onEvent))
      window.addEventListener('keydown', onKey)
      window.addEventListener('resize', onResize)
    })
    onUnmounted(() => {
      unsub.forEach(fn => fn())
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      setFallback(false)
    })
    // WP-S2:開框選層 → 清徽章
    watch(regionPickerOpen, (open) => { if (open) clear('開啟框選層') })

    return { t, state, badges, guess, fallback }
  }
})
</script>

<style>
.ocr-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 40;
  font-family: var(--font-ui);
}
.ocr-badge {
  position: absolute;
  transform: translateY(-50%);
  max-width: 34em;
  padding: 4px 8px;
  border-radius: 6px;
  border-left: 3px solid var(--gold);
  background: color-mix(in srgb, var(--surface-1-c) 94%, transparent);
  box-shadow: var(--shadow-float);
  color: var(--ink-0);
  font-size: var(--fs-base);
  line-height: 1.45;
  white-space: nowrap;
}
.ocr-row.fuzzy { color: var(--warn); }
.ocr-row.dim, .ocr-row.raw { color: var(--ink-2); }
.ocr-row.raw { font-size: var(--fs-xs); }
.ocr-toast, .ocr-note {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface-1-c) 94%, transparent);
  box-shadow: var(--shadow-float);
  color: var(--ink-0);
  font-size: var(--fs-sm);
  max-width: min(46em, 90vw);
  white-space: normal;
  text-align: center;
}
.ocr-toast { top: 10%; border-left: 3px solid var(--gold); }
.ocr-toast.warn { border-left-color: var(--warn); }
.ocr-note { bottom: 6%; color: var(--ink-2); font-size: var(--fs-xs); }
</style>
