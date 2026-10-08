/**
 * 就地回報(2026-10-08):回報按鈕放在問題旁邊,不只在查價面板最下方。
 *
 * App.vue `provide(REPORT_INLINE_KEY, …)`;移植的 poe1 / poe2 元件經 `@/web/ui/ReportInline.vue` inject,
 * 沒有注入(CLI、單元測試、其他宿主)時按鈕不畫。報告內容沿用 `report.ts`(同一件物品的剪貼簿 / 查詢),
 * 只多帶 `error` 一行說明是哪一條詞綴 / 哪個查價錯誤。
 */
import type { InjectionKey } from 'vue'

export type InlineReportKind = 'mod' | 'trade'

export interface InlineReporter {
  /** `detail` = 未解析詞綴原文 / 交易站錯誤訊息;省略 = 整件物品。 */
  report: (kind: InlineReportKind | 'item', detail?: string) => void
}

export const REPORT_INLINE_KEY: InjectionKey<InlineReporter> = Symbol('report-inline')

/** 報告裡 `error` 那一行(固定雙語,與 report.ts 的 requestNote 同風格)。 */
export function inlineReportError (kind: InlineReportKind | 'item', detail?: string): string | undefined {
  const d = (detail ?? '').trim()
  if (kind === 'mod') return `未解析詞綴 / Unrecognized modifier: ${d}`
  if (kind === 'trade') return `查價失敗 / Trade query failed: ${d}`
  return undefined
}
