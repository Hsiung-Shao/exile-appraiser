/**
 * exile-appraiser(效能修正第 6 步,2026-10-01):掃描事件的「同一份結果」判定(`OcrBadges.vue` / `RuneshapePrices.vue` 用;
 * `renderer/test/scan-dedupe.test.ts` 測)。
 * main 已不重送相同的 `rows`(`panel-scan.ts` `rowsSignature`,10 秒內),但暫停後恢復、10 秒一次的重送仍會帶同一份列;
 * renderer 以「列文字 + 四捨五入座標 + client + 其他會影響比對的輸入」當鍵,與**目前畫著的**結果相同就不重新比對 / 排版 / 印 log。
 * 鍵必須包含所有會改變比對結果的輸入(資料集世代 `dataGeneration`、遊戲、褻瀆的 profile 提示、fallback),否則會留著舊結果。
 */
import { shallowRef } from 'vue'
import type { PanelScanRow } from '@ipc/types'

/**
 * 資料集世代:renderer `main.ts` 每次載完遊戲資料(切遊戲 / 客戶端語言)+1。
 * 同樣的 OCR 列在換資料之後可能對到不同東西,所以放進鍵裡。
 */
export const dataGeneration = shallowRef(0)

export function bumpDataGeneration (): void {
  dataGeneration.value++
}

/** 掃描結果的鍵:`extra` 放其他會影響比對的輸入(用 `|` 串起來) */
export function scanResultKey (rows: readonly PanelScanRow[], client: { w: number, h: number }, extra: string): string {
  let s = `${client.w}x${client.h}|${extra}`
  for (const r of rows) s += `\n${r.text}\t${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`
  return s
}

/**
 * 記住上一次**處理完並採用**的結果鍵。`repeat(key, showing)`:這次與上次相同,且上次的結果還畫著(`showing`)→ true(可跳過)。
 * 畫面被清掉(empty / Esc / 框選層)之後 `showing` 為假,同一份列會重新處理。
 */
export function createScanResultGate () {
  let last = ''
  return {
    repeat (key: string, showing: boolean): boolean {
      return showing && key === last
    },
    remember (key: string): void {
      last = key
    },
    reset (): void {
      last = ''
    }
  }
}
