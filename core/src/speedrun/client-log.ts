// speedrun 計時器(2026-11-10):遊戲 Client.txt 的「進入區域」行。
// 兩代都寫 `… [DEBUG Client N] Generating level <lv> area "<id>" with seed <n>`;id 與介面語言無關(使用者本機 log 實測)。
// 零依賴:main(esbuild)以相對路徑 import。

const AREA_RE = /Generating level (\d+) area "([^"]+)"/

export function parseAreaLine (line: string): { area: string, level: number } | null {
  const m = AREA_RE.exec(line)
  return m ? { area: m[2], level: Number(m[1]) } : null
}
