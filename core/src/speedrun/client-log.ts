// speedrun 計時器(2026-11-10):遊戲 Client.txt 的「進入區域」行。
// 兩代都寫 `… [DEBUG Client N] Generating level <lv> area "<id>" with seed <n>`;id 與介面語言無關(使用者本機 log 實測)。
// 零依賴:main(esbuild)以相對路徑 import。

const AREA_RE = /Generating level (\d+) area "([^"]+)"/

export function parseAreaLine (line: string): { area: string, level: number } | null {
  const m = AREA_RE.exec(line)
  return m ? { area: m[2], level: Number(m[1]) } : null
}

// 2026-11-20:PoE1 打完基塔弗的抗性懲罰訊息(speedrun.com 第 5 / 10 章的終點;比進城早約 20 秒)。
// 系統訊息的名字欄是空的(`] : `),玩家聊天 / NPC 對白不會中;字串取自 GGPK clientstrings(繁中 / 英文),其他語言認不到 → 照舊進城才分段。
const KITAVA_RE = /\] : .*(?:奇塔弗|Kitava).*?(殘酷|cruel|無情|merciless)/i

/** 基塔弗訊息行 → 等同進入該章的觸發區(第 5 章 `2_6_town`、第 10 章 `2_11_endgame_town`) */
export function parseKitavaLine (line: string): string | null {
  const m = KITAVA_RE.exec(line)
  if (!m) return null
  return /殘酷|cruel/i.test(m[1]) ? '2_6_town' : '2_11_endgame_town'
}
