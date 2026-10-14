/**
 * 設定 › 記錄「存下倉庫擷取畫面」(IPC `stash-dump`)的結果 → 一句提示(純函式;`Log.vue` 用)。
 * 原因對照 main `StashScan.requestDump`(`ipc/types.ts` `StashDumpResult`);不認得的原因走通用失敗字串並帶原因字串。
 */
import type { StashDumpResult } from '@ipc/types'

export const STASH_DUMP_REASON_KEYS: Readonly<Record<string, string>> = {
  'not-showing': 'ppz.log.stash_dump_not_showing',
  timeout: 'ppz.log.stash_dump_timeout',
  disabled: 'ppz.log.stash_dump_disabled',
  'not-poe1': 'ppz.log.stash_dump_not_poe1',
  'not-intl': 'ppz.log.stash_dump_not_intl',
  'user-paused': 'ppz.log.stash_dump_paused',
  'not-overlay': 'ppz.log.stash_dump_not_overlay',
  'no-window': 'ppz.log.stash_dump_no_window',
  'qty-off': 'ppz.log.stash_dump_qty_off'
}

export function stashDumpMessage (r: StashDumpResult): { key: string, params: Record<string, string>, bad: boolean } {
  if (r.ok) return { key: 'ppz.log.stash_dump_saved', params: { file: r.file.split(/[\\/]/).pop() ?? r.file }, bad: false }
  const key = STASH_DUMP_REASON_KEYS[r.reason]
  if (key) return { key, params: {}, bad: true }
  return { key: 'ppz.log.stash_dump_failed', params: { msg: r.message ?? r.reason }, bad: true }
}
