/**
 * 設定 › 關於:目前支援的遊戲版本(2026-10-07 使用者要求顯示;版號由使用者提供)。
 * 2026-11-25 起由 scripts/poe{1,2}-season/update.mjs --write 依 GGPK 新版的 game_version 自動寫(scripts/season/lib.mjs setGameVersion)。
 */
export const SUPPORTED_GAME_VERSIONS = {
  poe1: '3.30.0d',
  poe2: '0.5.5e'
} as const
