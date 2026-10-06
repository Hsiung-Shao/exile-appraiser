/**
 * 查價面板旁「相關物品」的大小(2026-10-06 使用者回報「字有點小」)。
 *
 * 移植的 RelatedItems.vue 內部用 rem(`text-base`、`w-8 h-8`…),rem = html 字級 = `--fs-base`(預設 13px),
 * APT 當時 html 是 16px → 整塊比 APT 小一號。不改移植檔的 class,改在外層套 CSS `zoom`:
 * 100% = APT 原本大小(× `LEGACY_FS_SCALE` 1.23,與 App.vue 面板寬同一個換算),並隨全域字級 `fsBase` 等比;
 * 設定 › 查價「相關物品大小」可再調 70–200%。
 */
export const RELATED_SCALE_MIN = 70
export const RELATED_SCALE_MAX = 200
export const RELATED_SCALE_DEFAULT = 100
/** 舊字級 16px / 新預設 13px(App.vue `LEGACY_FS_SCALE` 同值) */
export const RELATED_LEGACY_FS_SCALE = 1.23

/** 設定值正規化:非數字 / 缺 → 預設;超出範圍夾回;取整 */
export function normRelatedItemsScale (v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return RELATED_SCALE_DEFAULT
  return Math.min(RELATED_SCALE_MAX, Math.max(RELATED_SCALE_MIN, Math.round(v)))
}

/** 套在相關物品外層的 CSS zoom */
export function relatedItemsZoom (scalePct: unknown): number {
  return Math.round(RELATED_LEGACY_FS_SCALE * normRelatedItemsScale(scalePct)) / 100
}
