// 查價面板 B 改版(2026-10-14):可見詞綴依來源分「詞綴」/「偽屬性(總和)」兩張卡片。純函式(不 import vue),兩代共用。
// 2026-10-16:另分「原始詞綴」卡 —— revealed(本來被丟掉 / 藏起、現在列出的原始詞綴)且非 pseudo 的列(使用者實機回饋,預設收起)。
export type ModCardId = 'mods' | 'raw' | 'pseudo'

export interface ModCardRow {
  group?: unknown
  tag?: string
  disabled?: boolean
  revealed?: boolean
  meta?: { tag?: string, disabled?: boolean, revealed?: boolean }
}

export interface ModCard<T> {
  id: ModCardId
  rows: T[]
  /** 沒停用(會送進查詢)的列數 */
  selected: number
}

/** PoE1 群組列(FilterGroup)以 meta 代表 */
function head (row: ModCardRow): { tag?: string, disabled?: boolean, revealed?: boolean } {
  return row.group && row.meta ? row.meta : row
}

export function modCardOf (row: ModCardRow): ModCardId {
  const h = head(row)
  if (h.tag === 'pseudo') return 'pseudo'
  return h.revealed ? 'raw' : 'mods'
}

export function splitModCards<T extends ModCardRow> (rows: readonly T[]): { mods: ModCard<T>, raw: ModCard<T>, pseudo: ModCard<T> } {
  const cards = {
    mods: { id: 'mods', rows: [], selected: 0 } as ModCard<T>,
    raw: { id: 'raw', rows: [], selected: 0 } as ModCard<T>,
    pseudo: { id: 'pseudo', rows: [], selected: 0 } as ModCard<T>
  }
  for (const row of rows) {
    const card = cards[modCardOf(row)]
    card.rows.push(row)
    if (!head(row).disabled) card.selected++
  }
  return cards
}
