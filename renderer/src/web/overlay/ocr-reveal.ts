/**
 * exile-appraiser(WP-S):靈魂之井揭露面板 OCR 的 renderer 端純邏輯(`OcrBadges.vue` 用;`renderer/test/ocr-reveal.test.ts` 測)。
 * - profile 來源:最近 10 分鐘內查價的 PoE2 物品(`App.vue` 解析成功時 `recordPoe2Item`);超過就不給 → 比對端推 profile、徽章加「?」。
 * - 徽章位置:比對結果的組矩形(client 實體像素)× 視窗 CSS 大小 / client 大小(overlay 視窗與 client 區對齊,CSS 原點 = client 左上)。
 * 只做型別匯入(renderer vitest 沒有別名)。
 */
import { shallowRef } from 'vue'
import type { Poe2RevealCandidate, Poe2RevealResult } from '@poe2-entry'
import type { OcrRegion } from '@ipc/types'

/** 最近查價物品當 profile 的有效期 */
export const LAST_ITEM_TTL_MS = 10 * 60_000
/** 徽章自動清除 */
export const BADGE_TTL_MS = 15_000
/** 錯誤訊息自動清除 */
export const ERROR_TTL_MS = 8_000
/** 徽章與該組右緣的間距(CSS px) */
export const BADGE_GAP_PX = 14

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
  /** CSS px(相對 overlay 視窗左上) */
  left: number
  top: number
  rows: BadgeRow[]
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

export function layoutBadges (
  result: OkResult,
  client: { w: number, h: number },
  viewport: { w: number, h: number },
  fmt: BadgeFormat
): BadgeView[] {
  const sx = client.w > 0 ? viewport.w / client.w : 1
  const sy = client.h > 0 ? viewport.h / client.h : 1
  const guess = !result.profileExact
  return result.groups.map((g, i) => ({
    key: `${i}:${Math.round(g.rect.y)}`,
    left: Math.round((g.rect.x + g.rect.w) * sx + BADGE_GAP_PX),
    top: Math.round((g.rect.y + g.rect.h / 2) * sy),
    rows: g.candidates.map(c => ({
      text: `${c.fuzzy ? '≈ ' : ''}${fmt.tier(c)}${guess ? '?' : ''} · ${fmt.pool(c)} · ${fmt.range(c)}`,
      fuzzy: c.fuzzy
    })),
    unmatched: g.lines.filter(l => !l.match).map(l => l.text.replace(/\s+/g, '')),
    empty: g.candidates.length === 0 && g.lines.some(l => l.match),
    guess
  }))
}

// ---- WP-S2:在遊戲畫面上框選 OCR 區域(OcrRegionPicker.vue)的共用狀態 ----

/**
 * 框選層是否開著(App.vue 據此忽略 Alt 隱藏與背景點擊、隱藏設定視窗;OcrBadges 開啟時清掉徽章)。
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
  /** 確認後(不回設定時):`reveal-now` = focus-game + 150 ms 後試辨識一次;`focus-game` = 只把焦點還給遊戲(掃描迴圈會自己開始) */
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
