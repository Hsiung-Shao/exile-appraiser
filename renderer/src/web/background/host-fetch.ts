/**
 * `Host.proxy` 的 AbortSignal 轉接(2026-10-01 效能修正第 9 步):AbortSignal 過不了 contextBridge / 預覽 RPC,
 * 所以帶 signal 的請求改帶 `requestId` 給 main,signal 觸發時:
 * - 立即以 `signal.reason` reject(與 WHATWG fetch 相同;呼叫端照舊用 `signal.aborted` 判斷);
 * - 送 `fetchAbort(requestId)`(IPC `http-abort`)讓 main 取消進行中的 session fetch。
 * 沒帶 signal 的請求原樣轉交(參數與以前完全相同)。純函式模組(不 import Vue),renderer 測試直接測。
 */
import type { HostApi, HostFetchInit, HostFetchResult } from '@ipc/types'

export type ProxyInit = HostFetchInit & { signal?: AbortSignal }

let seq = 0
/** 每次呼叫唯一的 id(main 端鍵另含來源 / 預覽 cid)。 */
export function newRequestId (): string {
  seq = (seq + 1) % Number.MAX_SAFE_INTEGER
  return `r${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function abortReason (signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason
  const e = new Error('This operation was aborted')
  e.name = 'AbortError'
  return e
}

export async function fetchViaHost (host: Pick<HostApi, 'fetch' | 'fetchAbort'>, url: string, init?: ProxyInit): Promise<HostFetchResult> {
  if (!init || !('signal' in init)) return await host.fetch(url, init)
  const { signal, ...rest } = init
  if (!signal) return await host.fetch(url, rest)
  if (signal.aborted) throw abortReason(signal)
  const requestId = newRequestId()
  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(abortReason(signal))
      try { void host.fetchAbort?.(requestId)?.catch(() => {}) } catch {} // 通知 main 中止是盡力而為:舊 host 沒有 fetchAbort 或 IPC 已斷時刻意忽略
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([host.fetch(url, { ...rest, requestId }), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
