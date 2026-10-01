/**
 * exile-appraiser(WP-S):靈魂之井揭露面板(褻瀆)的 renderer 端純邏輯(`OcrBadges.vue` 用;`renderer/test/ocr-reveal.test.ts` 測)。
 * - profile 來源:最近 10 分鐘內查價的 PoE2 物品(`App.vue` 解析成功時 `recordPoe2Item`);超過就不給 → 比對端推 profile、徽章加「?」。
 * - 徽章位置:比對結果的組矩形(client 實體像素)× 視窗 CSS 大小 / client 大小(overlay 視窗與 client 區對齊,CSS 原點 = client 左上)。
 *   2026-10-01 第 13 步:徽章左緣對齊同一個 x(所有組右緣的最大值 + 14),依組中心由上而下排、往下推開不重疊(間距 `BADGE_STACK_GAP_PX`),
 *   超出視窗下緣整體上移(`stackBadges`);一組多候選時預設只顯示最可能的一列 + 「+N」(設定「顯示全部候選」可全列)。
 * - 2026-10-01 起徽章跟著 main 的自動辨識事件(`reveal-scan-result`)持續更新:有列 → 重新比對;`empty` / `inactive` / 暫停 → 清除
 *   (沒有 15 秒自動消失、沒有「再按一次清除」)。`revealScanAction` 決定每個事件要做什麼。
 * 只做型別匯入(renderer vitest 沒有別名)。
 */
import { shallowRef } from 'vue'
import type { Poe2RevealCandidate, Poe2RevealResult } from '@poe2-entry'
import type { OcrRegion, RevealScanEvent, RuneshapeStats } from '@ipc/types'

/** 最近查價物品當 profile 的有效期 */
export const LAST_ITEM_TTL_MS = 10 * 60_000
/** 徽章與該組右緣的間距(CSS px) */
export const BADGE_GAP_PX = 14
/** 上下相鄰兩枚徽章之間至少留的空隙(CSS px) */
export const BADGE_STACK_GAP_PX = 4

export type RevealScanAction =
  /** 有列:交給 `matchRevealLines` 比對並重畫徽章 */
  | { kind: 'match' }
  /** 清掉徽章 */
  | { kind: 'clear', reason: string }
  /** 不動(繼續辨識:下一個有列的事件再畫) */
  | { kind: 'ignore' }

/** 自動辨識事件 → 徽章層動作(只清除於 empty / inactive / 暫停;PoE1 一律清) */
export function revealScanAction (ev: Pick<RevealScanEvent, 'reason' | 'rows'>, game: 'poe1' | 'poe2'): RevealScanAction {
  if (ev.reason === 'rows') {
    if (game !== 'poe2') return { kind: 'clear', reason: '不是 PoE2' }
    return ev.rows.length ? { kind: 'match' } : { kind: 'clear', reason: '沒有列' }
  }
  if (ev.reason === 'user-resumed') return { kind: 'ignore' }
  const why: Record<string, string> = { empty: '面板關了', inactive: '停止辨識', 'user-paused': '使用者暫停' }
  return { kind: 'clear', reason: why[ev.reason] ?? ev.reason }
}

/**
 * 設定頁的褻瀆自動辨識狀態列(main `reveal-stats`);沒有統計 / 不在掃描(非暫停)→ null。
 * 2026-10-01 第 13 步:有框區域時只看區域(不再退回整個畫面),狀態與符文塑形相同:框選的區域內有 / 沒有找到面板。
 */
export function revealScanStatus (
  s: Pick<RuneshapeStats, 'reason' | 'panel' | 'mode'> | undefined,
  t: (key: string, args?: Record<string, unknown>) => string,
  hotkey: string
): { code: string, warn: boolean, text: string } | null {
  if (!s) return null
  if (s.reason === 'user-paused') return { code: 'paused', warn: true, text: t('ppz.ocr.scan_status_paused', { hotkey: hotkey || '—' }) }
  if (s.mode === 'manual' && s.panel !== 'unknown') {
    return s.panel === 'found'
      ? { code: 'manual-found', warn: false, text: t('ppz.runeshape.status_manual_found') }
      : { code: 'manual-not-found', warn: true, text: t('ppz.runeshape.status_manual_not_found') }
  }
  if (s.panel === 'found') return { code: 'found', warn: false, text: t('ppz.ocr.scan_status_found') }
  return { code: 'searching', warn: false, text: t('ppz.ocr.scan_status_searching') }
}

/**
 * 「?」的說明:`all` = 三組候選的可能底材沒有交集(或不取交集),階層是依**全部**可能底材推算;
 * 其餘(交集 / 類別)維持原文案。profile 精確時不顯示(回 null)。
 */
export function guessNoteKey (r: Pick<Extract<Poe2RevealResult, { ok: true }>, 'profileExact' | 'profileSource'>): string | null {
  if (r.profileExact) return null
  return r.profileSource === 'all' ? 'ppz.ocr.guess_title_all' : 'ppz.ocr.guess_title'
}

export interface LastPoe2Item { refName: string, category?: string, at: number }

export const lastPoe2Item = shallowRef<LastPoe2Item | null>(null)

export function recordPoe2Item (item: { info: { refName?: string }, category?: string }, now = Date.now()): void {
  const refName = item.info.refName
  if (!refName) return
  lastPoe2Item.value = { refName, category: item.category, at: now }
}

/** 還在有效期內的 profile 提示;過期或沒有 → {}(比對端自己推) */
export function profileHint (last: LastPoe2Item | null, now = Date.now()): { refName?: string, category?: string } {
  if (!last || now - last.at > LAST_ITEM_TTL_MS) return {}
  return { refName: last.refName, category: last.category }
}

export interface BadgeRow {
  text: string
  fuzzy: boolean
}

export interface BadgeView {
  key: string
  /** CSS px(相對 overlay 視窗左上);`top` = 徽章**上緣**(2026-10-01 第 13 步起;原本是垂直中心) */
  left: number
  top: number
  /** 該組的垂直中心(CSS px):徽章盡量對齊它,被上一枚推開時才往下 */
  anchorY: number
  rows: BadgeRow[]
  /** 收起來沒顯示的候選數(「+N」;設定「顯示全部候選」開著 = 0) */
  more: number
  /** 組內對不上的行(OCR 原文,去空白) */
  unmatched: string[]
  /** 有命中的行但資料表沒有這些 profile 的對應 Tier */
  empty: boolean
  /** profile 不是精確底材(徽章加「?」) */
  guess: boolean
}

export interface BadgeFormat {
  tier: (c: Poe2RevealCandidate) => string
  pool: (c: Poe2RevealCandidate) => string
  range: (c: Poe2RevealCandidate) => string
}

type OkResult = Extract<Poe2RevealResult, { ok: true }>

/** 估徽章高度用的尺寸(CSS px;`OcrBadges.vue` 的 `.ocr-badge`:字級 `--fs-base`、行高 1.45、上下 padding 4 px、原文列 `--fs-xs`) */
export interface BadgeMetrics {
  rowPx: number
  smallRowPx: number
  padPx: number
}
export function badgeMetrics (fsBasePx = 13): BadgeMetrics {
  const fs = Number.isFinite(fsBasePx) && fsBasePx > 0 ? fsBasePx : 13
  return { rowPx: fs * 1.45, smallRowPx: (fs - 2) * 1.45, padPx: 8 }
}

/** 第一次排版用的估計高度(畫出來之後 `OcrBadges.vue` 量實際高度再排一次) */
export function estimateBadgeHeight (b: Pick<BadgeView, 'rows' | 'empty' | 'unmatched'>, m: BadgeMetrics = badgeMetrics()): number {
  const main = b.rows.length + (b.empty ? 1 : 0)
  return Math.max(1, main) * m.rowPx + b.unmatched.length * m.smallRowPx + m.padPx
}

/**
 * 防碰撞:依 `anchorY`(組中心)由上而下,徽章上緣 = max(中心 − 半高, 上一枚下緣 + 間距);
 * 最後一枚超出視窗下緣 → 整體上移(最多移到第一枚貼齊視窗上緣,再多就讓下緣超出,不壓縮間距)。
 * `heights[i]` 對應 `views[i]`;回傳新陣列(順序同 `views`),`top` 為整數。
 */
export function stackBadges (views: BadgeView[], heights: number[], viewportH: number, gap = BADGE_STACK_GAP_PX): BadgeView[] {
  const order = views.map((_, i) => i).sort((a, b) => views[a].anchorY - views[b].anchorY || a - b)
  const tops = new Array<number>(views.length).fill(0)
  let bottom = Number.NEGATIVE_INFINITY
  for (const i of order) {
    const h = Math.max(0, heights[i] ?? 0)
    // 整數上緣:往上取整會吃掉間距,所以推開時向上取整、對齊中心時四捨五入
    const want = Math.round(views[i].anchorY - h / 2)
    const top = Number.isFinite(bottom) ? Math.max(want, Math.ceil(bottom + gap)) : want
    tops[i] = top
    bottom = top + h
  }
  if (order.length && viewportH > 0) {
    const first = tops[order[0]]
    const overflow = Math.ceil(bottom - viewportH)
    const shift = Math.min(Math.max(0, overflow), Math.max(0, first))
    if (shift > 0) for (const i of order) tops[i] -= shift
  }
  return views.map((v, i) => ({ ...v, top: tops[i] }))
}

/**
 * 組 → 徽章。`showAll`(設定「顯示全部候選」,預設關):關 = 每組只列最可能的一個候選(第一個非模糊命中,沒有就第一個;
 * 候選順序同 `matchReveal`:Tier 下限 → 詞綴池)+ 「+N」;開 = 全列。左緣統一 = 所有組右緣的最大值 + 14,上下不重疊(`stackBadges`)。
 */
export function layoutBadges (
  result: OkResult,
  client: { w: number, h: number },
  viewport: { w: number, h: number },
  fmt: BadgeFormat,
  opts: { showAll?: boolean, metrics?: BadgeMetrics } = {}
): BadgeView[] {
  const sx = client.w > 0 ? viewport.w / client.w : 1
  const sy = client.h > 0 ? viewport.h / client.h : 1
  const guess = !result.profileExact
  const right = result.groups.length ? Math.max(...result.groups.map(g => g.rect.x + g.rect.w)) : 0
  const left = Math.round(right * sx + BADGE_GAP_PX)
  const views: BadgeView[] = result.groups.map((g, i) => {
    const shown = opts.showAll || g.candidates.length <= 1
      ? g.candidates
      : [g.candidates.find(c => !c.fuzzy) ?? g.candidates[0]]
    return {
      key: `${i}:${Math.round(g.rect.y)}`,
      left,
      top: 0,
      anchorY: (g.rect.y + g.rect.h / 2) * sy,
      rows: shown.map(c => ({
        text: `${c.fuzzy ? '≈ ' : ''}${fmt.tier(c)}${guess ? '?' : ''} · ${fmt.pool(c)} · ${fmt.range(c)}`,
        fuzzy: c.fuzzy
      })),
      more: g.candidates.length - shown.length,
      unmatched: g.lines.filter(l => !l.match).map(l => l.text.replace(/\s+/g, '')),
      empty: g.candidates.length === 0 && g.lines.some(l => l.match),
      guess
    }
  })
  const m = opts.metrics ?? badgeMetrics()
  return stackBadges(views, views.map(v => estimateBadgeHeight(v, m)), viewport.h)
}

// ---- WP-S2:在遊戲畫面上框選 OCR 區域(OcrRegionPicker.vue)的共用狀態 ----

/**
 * 框選層是否開著(App.vue 據此忽略背景點擊、隱藏設定視窗;OcrBadges 開啟時清掉徽章)。
 * WP-R2:同一個框選層也框符文塑形面板(`regionPickerTarget` / `REGION_PICKER_SPECS`)。
 */
export const regionPickerOpen = shallowRef(false)
/** 最近一次比對成功的面板外框(client 比例,已外擴;`region-geom.ts` 的 `detectedRegion`),框選層的「上次偵測」參考框 */
export const lastDetectedRegion = shallowRef<OcrRegion | null>(null)

export type RegionPickerSource = 'settings' | 'hotkey'
/**
 * 框選層怎麼結束的:`confirm` 確認、`cancel` 取消鈕 / Esc(renderer 收得到時)、`clear` 清除區域、
 * `lost` overlay 失焦 / 視窗隱藏(使用者已經回到遊戲)。
 */
export type RegionPickerOutcome = 'confirm' | 'cancel' | 'clear' | 'lost'

/** 目前(或最近一次)框選層是從哪裡開的 */
export const regionPickerSource = shallowRef<RegionPickerSource | null>(null)
/** 最近一次關閉的來源與結果(App.vue 據此決定要不要回到設定視窗) */
export const regionPickerClosed = shallowRef<{ source: RegionPickerSource | null, outcome: RegionPickerOutcome, target?: RegionPickerTarget } | null>(null)

// ---- WP-R2:框選層參數化(同一個 OcrRegionPicker.vue 框兩種區域) ----

/** 框哪一種區域:`reveal` = 靈魂之井揭露面板(WP-S2);`runeshape` = 符文塑形面板(WP-R2) */
export type RegionPickerTarget = 'reveal' | 'runeshape'

export interface RegionPickerSpec {
  target: RegionPickerTarget
  /** 存到設定的哪個欄位(client 比例) */
  field: 'ocrRegion' | 'runeshapeRegion'
  /** 說明條標題 / 副標(i18n 鍵) */
  titleKey: string
  subKey: string
  /**
   * 確認後(不回設定時):`reveal-now` = focus-game + 150 ms 後請褻瀆自動辨識立刻重看(`ocr-reveal-now` → `rescan`);
   * `focus-game` = 只把焦點還給遊戲(掃描迴圈會自己開始)
   */
  afterConfirm: 'reveal-now' | 'focus-game'
  /** 顯示「上次偵測」參考框與「套用上次偵測」鈕(只有揭露面板有偵測結果) */
  showLastDetected: boolean
}

export const REGION_PICKER_SPECS: Readonly<Record<RegionPickerTarget, RegionPickerSpec>> = {
  reveal: {
    target: 'reveal',
    field: 'ocrRegion',
    titleKey: 'ppz.ocr.region.picker.help',
    subKey: 'ppz.ocr.region.picker.sub',
    afterConfirm: 'reveal-now',
    showLastDetected: true
  },
  runeshape: {
    target: 'runeshape',
    field: 'runeshapeRegion',
    titleKey: 'ppz.runeshape.picker.help',
    subKey: 'ppz.runeshape.picker.sub',
    afterConfirm: 'focus-game',
    showLastDetected: false
  }
}

/** 目前(或最近一次)框選層框的是哪一種區域 */
export const regionPickerTarget = shallowRef<RegionPickerTarget>('reveal')

export function regionPickerSpec (target: RegionPickerTarget = regionPickerTarget.value): RegionPickerSpec {
  return REGION_PICKER_SPECS[target] ?? REGION_PICKER_SPECS.reveal
}

/**
 * 由設定視窗開的框選層,使用者自己結束(確認 / 取消 / 清除)→ 回到設定的熱鍵分頁;
 * 失焦 / 視窗隱藏代表使用者已回到遊戲,不再把 overlay 叫回來。熱鍵開的一律不回設定。
 */
export function returnsToSettings (source: RegionPickerSource | null, outcome: RegionPickerOutcome): boolean {
  return source === 'settings' && outcome !== 'lost'
}

/** WP-R2:`target` 省略 = 揭露面板(WP-S2 的既有行為與熱鍵不變) */
export function openRegionPicker (source: RegionPickerSource, target: RegionPickerTarget = 'reveal'): void {
  if (regionPickerOpen.value) return
  regionPickerSource.value = source
  regionPickerTarget.value = target
  regionPickerOpen.value = true
  console.log(`[ocr-region] 開啟框選層(${source}${target !== 'reveal' ? `,${target}` : ''})`)
}

export function closeRegionPicker (reason: string, outcome: RegionPickerOutcome = 'cancel'): void {
  if (!regionPickerOpen.value) return
  // 先記結果再關:App.vue 的 regionPickerOpen watcher 讀得到
  // WP-R2:`target` 只在不是揭露面板時帶(省略 = reveal,WP-S2 的形狀不變)
  const target = regionPickerTarget.value
  regionPickerClosed.value = target === 'reveal'
    ? { source: regionPickerSource.value, outcome }
    : { source: regionPickerSource.value, outcome, target }
  regionPickerOpen.value = false
  console.log(`[ocr-region] 關閉框選層(${reason})`)
}

/** `T4`;範圍 `T3–T5` */
export function tierText (c: Pick<Poe2RevealCandidate, 'tier' | 'tierRange'>): string {
  if (c.tier != null) return `T${c.tier}`
  const [lo, hi] = c.tierRange
  return lo === hi ? `T${lo}` : `T${lo}–T${hi}`
}
