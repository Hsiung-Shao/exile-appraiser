<!--
  exile-appraiser(WP-S):靈魂之井三選一揭露面板的 OCR 徽章層(只在 overlay 掛;見 docs/reveal-ocr.md)。
  - 收 main 的 `ocr-reveal-result`:`pending` → 小提示「辨識中」;`result` → 交給 PoE2 `matchRevealLines`(@poe2-entry)比對,
    每組右側一枚徽章(`T4 · 一般 · 21–26 / 20–25`,候選多個就多列;profile 不精確加「?」;模糊命中前面加「≈」;對不上的行灰色列 OCR 原文)。
  - 與查價面板是兄弟層(不受 panelShown 控制);按住 Alt 藏 overlay(App.vue 根元素 visibility)時跟著藏。
  - 清除:再按一次熱鍵(pending 到來時若正顯示 → 清掉並忽略那一次的結果)、Esc(overlay 有焦點時)、15 秒、overlay 視窗大小/位置改變(= 遊戲視窗移動)。
  - `pointer-events: none`:不擋遊戲操作。
  - WP-S2:比對成功時記下面板外框(`lastDetectedRegion`,框選層的「上次偵測」參考框);`stage === 'region-fallback'` 時提示 5 秒;
    框選層開啟時清掉徽章(之後確認框選會自動試辨識,不能被當成「再按一次 = 清除」)。
-->
<template>
  <div v-if="state !== 'idle'" class="ocr-layer pob-dark" :data-ocr-state="state">
    <div v-if="state === 'pending'" class="ocr-toast" data-ocr="pending">
      <span class="ocr-spin" aria-hidden="true" />{{ t('ppz.ocr.pending') }}
    </div>
    <div v-else-if="state === 'error'" class="ocr-toast bad" data-ocr="error" :data-error="errorCode">{{ errorText }}</div>
    <template v-else>
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
    </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OcrRevealEvent } from '@ipc/types'
import * as Poe2 from '@poe2-entry'
import { Host } from '../background/IPC'
import { loadedGame } from '../games/active'
import {
  BADGE_TTL_MS, ERROR_TTL_MS, lastDetectedRegion, lastPoe2Item, layoutBadges, profileHint, regionPickerOpen, tierText, type BadgeView
} from './ocr-reveal'
import { detectedRegion } from './region-geom'

/** WP-S2:「區域內沒找到,已改找整個畫面」提示顯示多久 */
const FALLBACK_NOTE_MS = 5_000

type State = 'idle' | 'pending' | 'result' | 'error'

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const state = shallowRef<State>('idle')
    const badges = shallowRef<BadgeView[]>([])
    const guess = shallowRef(false)
    const errorCode = shallowRef('')
    const errorMessage = shallowRef('')
    const fallback = shallowRef(false)
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null
    function setFallback (on: boolean) {
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null }
      fallback.value = on
      if (on) fallbackTimer = setTimeout(() => { fallback.value = false }, FALLBACK_NOTE_MS)
    }
    /** 「再按一次 = 清除」:清掉時記下那次的 seq,結果到了就丟掉 */
    let ignoreSeq = -1
    let timer: ReturnType<typeof setTimeout> | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    let shownAt = { x: 0, y: 0, w: 0, h: 0 }

    function stopTimers () {
      if (timer) { clearTimeout(timer); timer = null }
      if (poll) { clearInterval(poll); poll = null }
    }
    function clear (reason: string) {
      if (state.value === 'idle') return
      stopTimers()
      setFallback(false)
      state.value = 'idle'
      badges.value = []
      console.log(`[ocr] 清除徽章(${reason})`)
    }
    function show (next: State, ttl: number) {
      state.value = next
      stopTimers()
      timer = setTimeout(() => { clear('逾時') }, ttl)
      shownAt = { x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight }
      // overlay 跟著遊戲視窗移動 / 改大小 → 位置失準,清掉
      poll = setInterval(() => {
        if (window.screenX !== shownAt.x || window.screenY !== shownAt.y ||
          window.innerWidth !== shownAt.w || window.innerHeight !== shownAt.h) clear('遊戲視窗移動或改變大小')
      }, 500)
    }
    function fail (code: string, message = '') {
      errorCode.value = code
      errorMessage.value = message
      show('error', ERROR_TTL_MS)
      console.log(`[ocr] 錯誤 ${code}${message ? `:${message}` : ''}`)
    }

    function onEvent (e: OcrRevealEvent) {
      if (e.phase === 'pending') {
        if (state.value === 'result' || state.value === 'error') {
          ignoreSeq = e.seq
          clear('再按一次熱鍵')
          return
        }
        state.value = 'pending'
        stopTimers()
        return
      }
      if (e.seq === ignoreSeq) return
      if (loadedGame.value !== 'poe2') { fail('poe1'); return }
      if (!e.ok) { fail(e.error ?? 'ocr-failed', e.message); return }
      const hint = profileHint(lastPoe2Item.value)
      const r = Poe2.matchRevealLines(e.lines, hint)
      if (!r) { fail('no-data'); return }
      if (!r.ok) {
        console.log(`[ocr] 找不到面板;OCR ${e.lines.length} 行:${e.lines.map(l => l.text.replace(/\s+/g, '')).join(' | ').slice(0, 300)}`)
        fail('no-panel')
        return
      }
      const tr = (k: string, a?: unknown) => t(k, a as Record<string, unknown>)
      badges.value = layoutBadges(r, e.client, { w: window.innerWidth, h: window.innerHeight }, {
        tier: tierText,
        pool: c => Poe2.revealPoolLabel(c, tr),
        range: c => Poe2.revealRangeLabel(c.ranges)
      })
      guess.value = !r.profileExact
      // WP-S2:框選層的「上次偵測」參考框;區域內沒找到才找到 → 提示一次
      lastDetectedRegion.value = detectedRegion(r.groups, e.client)
      show('result', BADGE_TTL_MS)
      setFallback(e.stage === 'region-fallback')
      console.log(`[ocr] ${r.groups.length} 組(profile ${r.profileSource}${hint.refName ? ` ${hint.refName}` : ''};${e.stage ?? '-'}${e.inner ? `/${e.inner}` : ''};OCR ${e.ocrMs} ms、總計 ${e.tookMs} ms):` +
        badges.value.map(b => b.rows.map(x => x.text).join(' / ') || '—').join(' | '))
    }

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clear('Esc') }
    const unsub: Array<() => void> = []
    onMounted(() => {
      unsub.push(Host.onOcrRevealResult(onEvent))
      window.addEventListener('keydown', onKey)
    })
    onUnmounted(() => {
      unsub.forEach(fn => fn())
      window.removeEventListener('keydown', onKey)
      stopTimers()
      setFallback(false)
    })
    // WP-S2:開框選層 → 清徽章(確認後的自動試辨識不能被當成「再按一次 = 清除」)
    watch(regionPickerOpen, (open) => { if (open) clear('開啟框選層') })

    const errorText = computed(() => {
      const key = `ppz.ocr.err_${errorCode.value.replace(/-/g, '_')}`
      return t(key, { message: errorMessage.value })
    })

    return { t, state, badges, guess, fallback, errorCode, errorText }
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
.ocr-toast.bad { border-left-color: var(--bad); }
.ocr-toast.warn { border-left-color: var(--warn); }
.ocr-note { bottom: 6%; color: var(--ink-2); font-size: var(--fs-xs); }
.ocr-spin {
  display: inline-block;
  width: 0.9em;
  height: 0.9em;
  margin-right: 0.5em;
  vertical-align: -0.1em;
  border: 2px solid var(--ink-2);
  border-top-color: var(--gold);
  border-radius: 50%;
  animation: ocr-spin 0.8s linear infinite;
}
@keyframes ocr-spin { to { transform: rotate(360deg); } }
</style>
