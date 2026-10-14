// 查價面板 B 改版(2026-10-14):可見詞綴依來源分「詞綴」/「偽屬性(總和)」兩張卡片。純函式(不 import vue),兩代共用。
export type ModCardId = 'mods' | 'pseudo'

export interface ModCardRow {
  group?: unknown
  tag?: string
  disabled?: boolean
  meta?: { tag?: string, disabled?: boolean }
}

export interface ModCard<T> {
  id: ModCardId
  rows: T[]
  /** 沒停用(會送進查詢)的列數 */
  selected: number
}

/** PoE1 群組列(FilterGroup)以 meta 代表 */
function head (row: ModCardRow): { tag?: string, disabled?: boolean } {
  return row.group && row.meta ? row.meta : row
}

export function modCardOf (row: ModCardRow): ModCardId {
  return head(row).tag === 'pseudo' ? 'pseudo' : 'mods'
}

export function splitModCards<T extends ModCardRow> (rows: readonly T[]): { mods: ModCard<T>, pseudo: ModCard<T> } {
  const mods: ModCard<T> = { id: 'mods', rows: [], selected: 0 }
  const pseudo: ModCard<T> = { id: 'pseudo', rows: [], selected: 0 }
  for (const row of rows) {
    const card = modCardOf(row) === 'pseudo' ? pseudo : mods
    card.rows.push(row)
    if (!head(row).disabled) card.selected++
  }
  return { mods, pseudo }
}
