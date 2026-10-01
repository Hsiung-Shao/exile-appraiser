// exile-appraiser:host-config 裡「會影響 OCR 自動掃描(褻瀆 / 符文塑形)排程」的欄位。
// main 的 onHostConfig 只在這些欄位變了(或第一次)才 poke 掃描器;其他設定(熱鍵、聊天指令…)改了不需要。
// 欄位集合對應 main.ts 兩個 Scan 的 readConfig:enabled / game / region / intervalMs。
import type { HostConfigForMain } from '@ipc/types'

type ScanCfg = Pick<HostConfigForMain, 'game' | 'revealAutoEnabled' | 'revealIntervalMs' | 'ocrRegion' | 'runeshapeEnabled' | 'runeshapeRegion' | 'runeshapeIntervalMs'>

export function scanConfigKey (cfg: ScanCfg): string {
  return JSON.stringify([
    cfg.game, cfg.revealAutoEnabled, cfg.revealIntervalMs, cfg.ocrRegion ?? null,
    cfg.runeshapeEnabled, cfg.runeshapeRegion ?? null, cfg.runeshapeIntervalMs
  ])
}
