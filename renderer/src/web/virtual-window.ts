// exile-appraiser:虛擬捲動共用純函式(DustTable.vue / RegexList.vue)。
// 可視範圍用整數索引表示:`windowRows` 只依賴 startIdx / endIdx(整數 computed,值沒變就不觸發),
// 不直接依賴每像素都在變的 scrollTop,避免每個 scroll 事件都重新產生整個陣列、重 render 全部可視列。

/** 可視列區間 [start, end)(含上下 overscan 列),與原本 windowRows 的算式逐字相同 */
export function windowStartIdx (scrollTop: number, rowH: number, overscan: number): number {
  return Math.max(0, Math.floor(scrollTop / rowH) - overscan)
}

export function windowEndIdx (scrollTop: number, viewH: number, rowH: number, overscan: number, count: number): number {
  return Math.min(count, Math.ceil((scrollTop + viewH) / rowH) + overscan)
}

/**
 * 每個動畫幀最多執行一次 `fn`:同一幀內呼叫多次只處理一次,且處理時讀的是當下最新狀態(最後位置一定處理到)。
 * `raf` / `caf` 可注入(測試用);`cancel()` 取消尚未執行的那一次。
 */
export function rafThrottle (
  fn: () => void,
  raf: (cb: () => void) => number = cb => requestAnimationFrame(cb),
  caf: (id: number) => void = id => cancelAnimationFrame(id)
): { (): void, cancel: () => void } {
  let id: number | null = null
  const run = (() => {
    if (id != null) return
    id = raf(() => {
      id = null
      fn()
    })
  }) as { (): void, cancel: () => void }
  run.cancel = () => {
    if (id != null) caf(id)
    id = null
  }
  return run
}
