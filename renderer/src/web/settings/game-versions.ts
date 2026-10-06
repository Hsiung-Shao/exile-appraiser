/**
 * 設定 › 更新與關於:目前支援的遊戲版本(2026-10-07 使用者要求顯示;版號由使用者提供)。
 * 遊戲改版、資料同步(`npm run sync-data`、PoE2 交易站快照)或發版時確認仍是最新版本,不是就更新這裡。
 */
export const SUPPORTED_GAME_VERSIONS = {
  poe1: '3.29.3',
  poe2: '0.5.5d'
} as const
