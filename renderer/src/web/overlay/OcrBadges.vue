<!--
  exile-appraiser(WP-S):靈魂之井三選一揭露面板的褻瀆徽章層(只在 overlay 掛;見 docs/reveal-ocr.md)。
  - 2026-10-01 起收 main 褻瀆自動辨識的 `reveal-scan-result`(`main/src/ocr/reveal-scan.ts`,持續掃描):
    `rows` → 交給 PoE2 `matchRevealLines`(@poe2-entry)比對,每組右側一枚徽章(`T4 · 一般 · 21–26 / 20–25`,候選多個就多列;
    profile 不精確加「?」;模糊命中前面加「≈」;對不上的行灰色列 OCR 原文);比對不成面板(背包物品浮窗之類)→ 靜靜清掉、不跳錯誤。
    `empty`(面板關了)/ `inactive`(停止)/ `user-paused` → 清除。沒有 15 秒自動消失、沒有「再按一次清除」(ocr-reveal.ts `revealScanAction`)。
  - 與查價面板是兄弟層(不受 panelShown 控制);overlay 視窗改大小 → 以最後一次結果重新排位置。
  - Esc(overlay 有焦點時)暫時清掉,下一個有列的事件再畫。
  - `pointer-events: none`:不擋遊戲操作。
  - WP-S2:比對成功時記下面板外框(`lastDetectedRegion`,框選層的「上次偵測」參考框);框選層開啟時清掉徽章。
    (2026-10-01 第 13 步:有框區域時 main 只看區域,不再退回整個畫面,「已改找整個畫面」提示移除。)
  - 效能修正第 6 步:事件的列(+ client、profile 提示、遊戲、資料集世代)與目前畫著的結果相同 → 不重新比對 / 排版 / 印 log
    (`scan-dedupe.ts`);同一份「不是揭露面板」的列也不重比。畫面被清掉後同一份列照常重畫。
  - 第 13 步:徽章左緣對齊、上下不重疊(`layoutBadges` 先用估計高度排,畫出來後量實際高度再排一次 `stackBadges`);
    一組多候選預設只列最可能的一個 + 「+N」(設定 `revealShowAllCandidates` 開 = 全列;overlay 點擊穿透,不做滑鼠展開);
    「?」說明依 profile 來源換文案(`guessNoteKey`:交集為空 = 依全部可能底材推算)。
  - 第 11 步:徽章外觀(`config.ocrBadgeStyle`,與符文徽章共用;`badge-style.ts`):根元素設 CSS 變數,樣式寫 `var(--badge-x, 原值)`,
    預設不輸出變數 = 外觀不變。字體 / 字級 / 粗體 / 外框;語意色(模糊命中警告色、dim)保留,不吃價格三段色。
    改外觀 → 以最後結果重排(估計高度用設定的字級),字型載入完成後再量一次實際高度。
  - 第 18 步:main 的擷取會截到這一層(徽章文字被 OCR 併進詞綴行 → 3 組 → 2 組 → 清除的循環)。DOM 更新後、paint 前把徽章與「?」說明的外框
    送 main 遮掉(`scan-mask.ts`);每個掃描事件處理完都帶它的 seq(ack,main 等到才擷取下一張)。
  - code review 第 C 批:掃描層接線改用共用的 `useScanLayer.ts`(與符文層同一份):處理丟例外也 ack、ack 前等重排完成
    (`restackMeasured` 回傳有沒有改)、遮罩追外觀 / 全域字級 / 介面語言 + ResizeObserver;全域字級(`config.fsBase`,反應式)
    與介面語言改變 → 以最後結果重排(去重鍵也含介面語言);量高度走 `layer.children`,只在 `loadingdone` 與 ack 前量(不再另掛 `fonts.ready`)。
-->
<template>
  <div v-if="state !== 'idle'" ref="layer" class="ocr-layer pob-dark" :data-ocr-state="state" :style="styleVars">
    <div v-for="b in badges" :key="b.key" class="ocr-badge" data-ocr="badge" :data-key="b.key"
      :style="{ left: `${b.left}px`, top: `${b.top}px` }">
      <div v-for="(r, i) in b.rows" :key="i" class="ocr-row" :class="{ fuzzy: r.fuzzy }"
        :title="r.fuzzy ? t('ppz.ocr.fuzzy_title') : b.guess && guessKey ? t(guessKey) : undefined">{{ r.text }}<span
          v-if="i === 0 && b.more" class="ocr-more" data-ocr="more">+{{ b.more }}</span></div>
      <div v-if="b.empty" class="ocr-row dim">{{ t('ppz.ocr.no_candidate') }}</div>
      <div v-for="(u, i) in b.unmatched" :key="`u${i}`" class="ocr-row raw">{{ t('ppz.ocr.unmatched', { text: u }) }}</div>
    </div>
    <div v-if="guessKey" class="ocr-note" data-ocr="guess-note">{{ t(guessKey) }}</div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RevealScanEvent } from '@ipc/types'
import * as Poe2 from '@poe2-entry'
import { Host } from '../background/IPC'
import { AppConfig } from '../Config'
import { effectiveOcrLang, ocrTextLangOf } from '../ocr-lang'
import { loadedGame } from '../games/active'
import {
  badgeMetrics, guessNoteKey, lastDetectedRegion, lastPoe2Item, layoutBadges, profileHint, regionPickerOpen, revealScanAction, stackBadges, tierText,
  type BadgeView
} from './ocr-reveal'
import { badgeStyleVars, revealBadgeFontPx } from './badge-style'
import { detectedRegion } from './region-geom'
import { dataGeneration, scanResultKey } from './scan-dedupe'
import { useScanLayer } from './useScanLayer'

type State = 'idle' | 'result'
type OkResult = Extract<ReturnType<typeof Poe2.matchRevealLines>, { ok: true }>

export default defineComponent({
  setup () {
    const { t, locale } = useI18n()
    const config = AppConfig()
    const state = shallowRef<State>('idle')
    const badges = shallowRef<BadgeView[]>([])
    /** 「?」說明的 i18n 鍵(profile 精確 = null) */
    const guessKey = shallowRef<string | null>(null)
    /** 最後一次比對成功的結果(overlay 改大小時重新排位置) */
    let last: { r: OkResult, client: { w: number, h: number } } | null = null
    /** 同一種「比對不成面板」只記一次 log(持續掃描時每秒一行太吵) */
    let lastMissLog = ''
    /** `lastNoPanelKey` = 上一份判定「不是揭露面板」的列(同一份不重比) */
    let lastNoPanelKey = ''
    const styleVars = computed(() => badgeStyleVars(config.ocrBadgeStyle, 'reveal'))
    /**
     * 掃描層共用接線(code review 第 C 批,useScanLayer.ts):遮罩回報 + ack(第 18 步)、與目前畫著的結果相同的事件不重算(gate)、
     * 收到 rows 時資料沒載好 → 資料載好時請 main 重送(第 B 批,resend)。
     * 遮罩在畫面變了(狀態 / 徽章 / 說明 / 外觀 / 全域字級 / 介面語言)或任何子元素尺寸變了時,於 paint 前重報。
     */
    const scan = useScanLayer<RevealScanEvent>({
      source: 'reveal',
      subscribe: cb => Host.onRevealScanResult(cb),
      handleEvent,
      drawn: [state, badges, guessKey, styleVars],
      showing: () => state.value !== 'idle',
      // ack 前等畫出來後的重排(有改 → 再等一次 DOM 更新才量);剛等完字型載入 → 重量一次
      beforeAck: (fontsWaited) => fontsWaited ? requestRestack() : (restackP ?? false),
      // 字型實際載入完成(`fonts.ready` 可能在字型開始載入前就已 resolve)→ 寬高變了,重排並重量外框
      // (第 18 步離屏實測:不聽這個時遮罩比徽章窄約 21 px)
      onFontsLoaded: () => { void requestRestack() }
    })
    const { layer, gate, resend, mask } = scan

    function clear (reason: string) {
      last = null
      gate.reset()
      if (state.value === 'idle') return
      state.value = 'idle'
      badges.value = []
      guessKey.value = null
      console.log(`[ocr] 清除徽章(${reason})`)
    }
    /** 全域字級(px;`useTheme` 寫進 `--fs-base` 的同一個值,反應式) */
    function fsBasePx (): number {
      return config.fsBase || 13
    }
    /**
     * 畫出來之後量實際高度,與估計不同就再排一次(字型 / 縮放讓估計不準時也不重疊);回傳有沒有改位置。
     * 徽章是層的前幾個直接子元素(v-for 順序 = `badges` 順序,後面才是「?」說明),直接走 `layer.children`。
     */
    async function restackMeasured (): Promise<boolean> {
      await nextTick()
      const el = layer.value
      const cur = badges.value
      if (!el || !cur.length) return false
      const kids = el.children
      const heights: number[] = []
      for (let i = 0; i < cur.length; i++) {
        const k = kids[i] as HTMLElement | undefined
        if (!k || k.dataset.key !== cur[i].key) return false // DOM 還不是這份徽章(下一次 layout 會再量)
        heights.push(k.offsetHeight)
      }
      if (heights.some(h => h <= 0)) return false
      const next = stackBadges(cur, heights, window.innerHeight)
      if (next.some((b, i) => b.top !== cur[i].top)) { badges.value = next; return true }
      // 位置沒變但大小可能變了(字型載入完成):重量一次(相同就不送)
      mask.report(layer.value)
      return false
    }
    /** 進行中的重排(layout 排了、ack 前等同一份,不重複量) */
    let restackP: Promise<boolean> | null = null
    function requestRestack (): Promise<boolean> {
      if (!restackP) {
        const p: Promise<boolean> = restackMeasured().finally(() => { if (restackP === p) restackP = null })
        restackP = p
      }
      return restackP
    }
    function layout () {
      if (!last) return
      const tr = (k: string, a?: unknown) => t(k, a as Record<string, unknown>)
      badges.value = layoutBadges(last.r, last.client, { w: window.innerWidth, h: window.innerHeight }, {
        tier: tierText,
        pool: c => Poe2.revealPoolLabel(c, tr),
        range: c => Poe2.revealRangeLabel(c.ranges)
      }, { showAll: config.revealShowAllCandidates, metrics: badgeMetrics(revealBadgeFontPx(config.ocrBadgeStyle, fsBasePx())) })
      // 畫出來之後量實際高度再排一次(換了字體:字型檔載入完成後字寬 / 行高才定 → `loadingdone` 再量)
      void requestRestack()
    }

    function handleEvent (e: RevealScanEvent) {
      const act = revealScanAction(e, loadedGame.value === 'poe2' ? 'poe2' : 'poe1')
      // PoE2 資料還沒載好(loadedGame 還是舊的)收到的 rows:載好後要請 main 重送
      if (e.reason === 'rows' && e.rows.length && loadedGame.value !== 'poe2') resend.missed()
      if (act.kind === 'ignore') return
      if (act.kind === 'clear') {
        lastNoPanelKey = ''
        clear(act.reason)
        return
      }
      const hint = profileHint(lastPoe2Item.value)
      // 第 25 步:比對用的文字語言 = 有效辨識語言(設定 `ocrLang`,與客戶端語言獨立;main 同規則選 OCR 語言包)
      const lang = ocrTextLangOf(effectiveOcrLang(config.ocrLang, config.language))
      // 比對的全部輸入:列、client、profile 提示、遊戲、資料集世代、介面語言(徽章文字是排版時算好的字串;code review 第 C 批)
      const key = scanResultKey(e.rows, e.client, `${hint.refName ?? ''}|${hint.category ?? ''}|${loadedGame.value}|${dataGeneration.value}|${locale.value}|${lang}`)
      if (gate.repeat(key, state.value === 'result' && last != null)) return
      if (state.value === 'idle' && key === lastNoPanelKey) return
      const r = Poe2.matchRevealLines(e.rows, { ...hint, lang })
      if (!r || !r.ok) {
        // 畫面上有 ≥ 2 行像詞綴、但湊不成 2–3 組的面板(背包物品浮窗等,或被否決規則擋掉)→ 不是揭露面板,靜靜清掉
        const why = r ? `no-panel${r.veto ? `:${r.veto.kind}` : ''}` : 'no-data'
        if (why !== lastMissLog) console.log(`[ocr] 不是揭露面板(${why}${r?.veto ? ` ${r.veto.detail.replace(/\s+/g, '')}` : ''});OCR ${e.rows.length} 行:${e.rows.map(l => l.text.replace(/\s+/g, '')).join(' | ').slice(0, 200)}`)
        lastMissLog = why
        clear(why)
        // 資料還沒載好(no-data)不記:載好後同一份列要重比(並請 main 重送,見下方 watch)
        lastNoPanelKey = r ? key : ''
        if (!r) resend.missed()
        return
      }
      lastMissLog = ''
      lastNoPanelKey = ''
      gate.remember(key)
      last = { r, client: e.client }
      state.value = 'result'
      layout()
      guessKey.value = guessNoteKey(r)
      // WP-S2:框選層的「上次偵測」參考框
      lastDetectedRegion.value = detectedRegion(r.groups, e.client)
      // log 列全部候選(徽章預設收起時,完整內容仍在 log)
      console.log(`[ocr] #${e.seq} ${r.groups.length} 組(profile ${r.profileSource}${hint.refName ? ` ${hint.refName}` : ''}` +
        `${e.timings?.ocrWallMs != null ? `;OCR ${e.timings.ocrWallMs} ms` : ''}):` +
        r.groups.map(g => g.candidates.map(c => `${tierText(c)} ${c.pool} ${Poe2.revealRangeLabel(c.ranges)}`).join(' / ') || '—').join(' | '))
    }

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clear('Esc') }
    const onResize = () => { layout() }
    onMounted(() => {
      window.addEventListener('keydown', onKey)
      window.addEventListener('resize', onResize)
    })
    onUnmounted(() => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    })
    // WP-S2:開框選層 → 清徽章
    watch(regionPickerOpen, (open) => { if (open) clear('開啟框選層') })
    // 設定「顯示全部候選」切換 → 以最後結果重排
    watch(() => config.revealShowAllCandidates, () => { layout() })
    // 第 11 步:徽章外觀改了 → 以最後結果重排(字級 / 字體影響高度)
    watch(styleVars, () => { layout() })
    // code review 第 C 批:全域字級(徽章跟隨全域時的字級、估計高度)/ 介面語言(徽章文字;看 i18n 實際的 locale,`uiLanguage` 改了要等字串檔載完才換)改了 → 以最後結果重排
    watch([() => config.fsBase, locale], () => { layout() })
    // 遮罩回報(第 18 步)與資料改變請 main 重送(第 B 批)在 useScanLayer 裡

    return { t, state, badges, guessKey, layer, styleVars }
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
  /* top = 徽章上緣(`stackBadges` 已依組中心算好並推開重疊) */
  max-width: 34em;
  padding: 4px 8px;
  border-radius: 6px;
  border-left: 3px solid var(--gold);
  background: color-mix(in srgb, var(--surface-1-c) 94%, transparent);
  box-shadow: var(--shadow-float);
  color: var(--ink-0);
  /* 第 11 步徽章外觀:變數沒設 = 原值(font-weight / text-shadow 沒設時 var() 無效 → 照舊繼承) */
  font-family: var(--badge-font, var(--font-ui));
  font-size: var(--badge-fs, var(--fs-base));
  font-weight: var(--badge-weight);
  text-shadow: var(--badge-halo);
  line-height: 1.45;
  white-space: nowrap;
}
.ocr-row.fuzzy { color: var(--warn); }
.ocr-row.dim, .ocr-row.raw { color: var(--ink-2); }
.ocr-row.raw { font-size: var(--badge-fs-xs, var(--fs-xs)); }
.ocr-more { margin-left: 0.5em; color: var(--ink-2); font-size: var(--badge-fs-xs, var(--fs-xs)); }
.ocr-note {
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
.ocr-note { bottom: 6%; color: var(--ink-2); font-size: var(--fs-xs); }
</style>
