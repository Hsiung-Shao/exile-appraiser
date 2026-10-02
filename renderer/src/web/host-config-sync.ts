// exile-appraiser:renderer → main 的 host-config 送出節流。
// 設定頁每改一個欄位(聊天指令文字欄每打一個字)watch 都會觸發;main 每收一份就重註冊全域熱鍵、poke 掃描器。
// 這裡:① 內容與上次送出的相同就不送;② 一般欄位 trailing debounce(預設 300 ms);
// ③ 第一次(啟動)與「需要立即生效」的欄位(遊戲 / overlayMode:main 會據此重新啟動;掃描開關 / 區域 / 間隔:設定頁狀態列要讀新狀態)立刻送;
// ④ flush() 把等待中的立刻送出;⑤ settled():等到沒有等待中 / 送出中的設定(main 已回覆)—— 設定頁狀態列在它之後才讀掃描統計
// (code review 第 C 批:原本狀態列固定 300 ms 後讀,與 300 ms 去抖剛好同時,改區域後 300 ms 內又改別的欄位就讀到舊狀態)。
export const HOST_CONFIG_DEBOUNCE_MS = 300

export interface HostConfigSyncDeps<T> {
  send: (cfg: T) => void | Promise<void>
  delayMs?: number
  /** 這些欄位變了就不延後(main 會因它們重新啟動 / 切換遊戲,或設定頁要馬上讀新狀態) */
  immediateKeys?: Array<keyof T>
  /** 測試注入;預設 setTimeout / clearTimeout */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

export function createHostConfigSync<T extends object> (deps: HostConfigSyncDeps<T>) {
  const delay = deps.delayMs ?? HOST_CONFIG_DEBOUNCE_MS
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((t) => { clearTimeout(t as ReturnType<typeof setTimeout>) })
  let lastSent: string | null = null
  let lastSentCfg: T | null = null
  let pending: { cfg: T, key: string } | null = null
  let timer: unknown = null
  /** 送出中(send 回傳的 promise 還沒結束) */
  let inflight: Promise<unknown> | null = null
  let waiters: Array<() => void> = []
  const idle = () => pending == null && inflight == null
  const wake = () => {
    if (!idle()) return
    const w = waiters
    waiters = []
    w.forEach(fn => { fn() })
  }

  const cancel = () => {
    if (timer != null) clearTimer(timer)
    timer = null
    pending = null
  }
  const sendNow = (cfg: T, key: string) => {
    cancel()
    lastSent = key
    lastSentCfg = cfg
    try {
      const r = deps.send(cfg)
      if (r && typeof (r as Promise<void>).catch === 'function') {
        const p: Promise<unknown> = (r as Promise<void>)
          .catch(() => { if (lastSent === key) lastSent = null })
          .finally(() => { if (inflight === p) inflight = null; wake() })
        inflight = p
      }
    } catch {
      if (lastSent === key) lastSent = null // 送失敗 → 下次同內容仍會重送
    }
    wake()
  }

  return {
    /** watch 回呼:排程(或立刻)送出這份設定 */
    update (cfg: T): void {
      const key = JSON.stringify(cfg)
      if (key === lastSent) { cancel(); wake(); return } // 又改回已送出的內容 → 不送
      if (pending?.key === key) return
      const immediate = lastSentCfg == null || (deps.immediateKeys ?? []).some(k => JSON.stringify(cfg[k]) !== JSON.stringify(lastSentCfg![k]))
      if (immediate) { sendNow(cfg, key); return }
      cancel()
      pending = { cfg, key }
      timer = setTimer(() => { const p = pending; if (p) sendNow(p.cfg, p.key) }, delay)
    },
    /** 把等待中的設定立刻送出(視窗關閉前) */
    flush (): void {
      if (pending) sendNow(pending.cfg, pending.key)
    },
    /** 沒有等待中 / 送出中的設定時 resolve(送出失敗也算結束) */
    settled (): Promise<void> {
      if (idle()) return Promise.resolve()
      return new Promise<void>(resolve => { waiters.push(resolve) })
    },
    /** 測試用 */
    get hasPending (): boolean { return pending != null }
  }
}

/** 設定送到 main 之後,再給掃描器一輪(poke 後立刻 tick)才讀統計 */
export const STATS_AFTER_HOST_CONFIG_MS = 300

/**
 * 設定頁狀態列:等設定送到 main(`settled`)後再 `delayMs` 才讀(`read`)。測試注入計時器。
 */
export async function afterHostConfigApplied (
  settled: () => Promise<void>,
  read: () => void,
  delayMs = STATS_AFTER_HOST_CONFIG_MS,
  setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms)
): Promise<void> {
  try { await settled() } catch { /* 送出失敗也照讀(顯示 main 目前的狀態) */ }
  setTimer(read, delayMs)
}
