// 物品詞綴數值頁:多種寫法仲裁檔(data/regex/item-mod-forms.json)沒載入時,靠仲裁才收錄的詞綴不在清單裡 →
// 存檔裡勾過的這些鍵還原不到。store 把它們暫存起來,寫回存檔時用這裡接回去(使用者再存檔不會把它們洗掉)。

export interface KeyList {
  keys: readonly string[]
  /** 與 keys 同索引的繁中模板(可省略 = 全部空字串) */
  alt?: readonly string[]
}

/**
 * 目前的鍵 + 暫存鍵:kept 接在 current 後面;重複的鍵保留 current 的位置與 alt;缺 alt 補空字串。不改動輸入。
 */
export function mergeKeptKeys (current: KeyList, kept: KeyList | undefined): { keys: string[], alt: string[] } {
  const keys = [...current.keys]
  const alt = current.keys.map((_, i) => current.alt?.[i] ?? '')
  if (!kept) return { keys, alt }
  const seen = new Set(keys)
  kept.keys.forEach((k, i) => {
    if (seen.has(k)) return
    seen.add(k)
    keys.push(k)
    alt.push(kept.alt?.[i] ?? '')
  })
  return { keys, alt }
}
