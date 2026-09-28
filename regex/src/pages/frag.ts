// 演算法頁共用的片段組法(自寫)。只用 `.`、`*`、`[^\d]`、`\d`、`[…]`、`?`、`|`、`()`、`^`、`$`:
// 不用大寫跳脫(`\D`、`\W`):萬一遊戲先把搜尋字串摺成小寫,`\D` 會變成意思相反的 `\d`。
import { rangeRegex } from '../numeric'
import { rangeOp, type AlgoValue } from './types'

/** 標籤去掉數值佔位與尾端分隔(「物品等級：#」→「物品等級」、「Item Level #」→「Item Level」) */
export function labelBase (label: string): string {
  return label.replace(/#/g, '').replace(/[\s:：]+$/u, '').trim()
}

/**
 * 物品屬性行「標籤 … 數值」的片段。遊戲顯示的分隔各版不同(PoE1 繁中「物品等級：84」、PoE2「物品等級 84」、
 * 剪貼簿「物品等級: 84」、百分比前面有「+」),所以標籤後一律 `.*`,數值的邊界這樣保證:
 *   * ≥ 且是百分比:`標籤.*數值%` —— 後界 `%`;數值片段就算只吃到尾段(180 的「80」),尾段 ≥ N 推得出整數 ≥ N。
 *   * ≥ 且不是百分比:`標籤.*[^\d]數值` —— 前界「非數字字元」;吃到前段(160 的「16」)同理推得出 ≥ N。
 *   * ≤ / 區間:前界 `[^\d]` + 後界(百分比 `%`,否則 `$`)。
 * `anchorStart` = 行首 `^`(「等級」這種會出現在別的標籤裡的短字)。
 * regex/test/pages.test.ts 對 0–999 每個值、各種分隔寫法逐一驗證。
 */
export function propertyFragment (
  label: string, v: AlgoValue, digits: 1 | 2 | 3, percent: boolean, anchorStart = false
): string | null {
  const op = rangeOp(v)
  if (!op) return null
  const re = rangeRegex({ min: op === 'le' ? undefined : v.min, max: op === 'ge' ? undefined : v.max }, { digits })
  if (!re) return null
  const base = labelBase(label)
  if (!base) return null
  const needStart = op !== 'ge' || !percent
  const needEnd = !percent && op !== 'ge'
  return `${anchorStart ? '^' : ''}${base}${needStart ? '.*[^\\d]' : '.*'}${re}${percent ? '%' : ''}${needEnd ? '$' : ''}`
}

/** 整行等於某個標籤(已汙染、勢力) */
export function wholeLine (labels: string[]): string | null {
  const xs = [...new Set(labels.map(labelBase).filter(Boolean))]
  if (!xs.length) return null
  return xs.length === 1 ? `^${xs[0]}$` : `^(${xs.join('|')})$`
}

/** n 個相連插槽:`.-.-.-.-.-.`(插槽字元不假設是哪個字母;`-` = 相連、空白 = 斷開) */
export function linkedSockets (n: number): string | null {
  if (!Number.isInteger(n) || n < 2 || n > 6) return null
  return Array.from({ length: n }, () => '.').join('-')
}

/** 多重集合的全部相異排列 */
function permutations (letters: string[]): string[][] {
  const out: string[][] = []
  const sorted = [...letters].sort()
  const used = new Array<boolean>(sorted.length).fill(false)
  const cur: string[] = []
  const rec = (): void => {
    if (cur.length === sorted.length) { out.push([...cur]); return }
    for (let i = 0; i < sorted.length; i++) {
      if (used[i]) continue
      if (i > 0 && sorted[i] === sorted[i - 1] && !used[i - 1]) continue
      used[i] = true
      cur.push(sorted[i])
      rec()
      cur.pop()
      used[i] = false
    }
  }
  rec()
  return out
}

interface Trie { next: Map<string, Trie> }

/** trie → 正則:子樹相同的兄弟合成字元類(`[rg]-b`),多個分支才加括號 */
function renderTrie (t: Trie, top: boolean): string {
  if (t.next.size === 0) return ''
  const groups = new Map<string, string[]>()
  for (const [ch, sub] of t.next) {
    const s = renderTrie(sub, false)
    const g = groups.get(s)
    if (g) g.push(ch)
    else groups.set(s, [ch])
  }
  const alts = [...groups].map(([sub, chs]) => (chs.length === 1 ? chs[0] : `[${chs.sort().join('')}]`) + sub)
  if (alts.length === 1) return alts[0]
  return top ? alts.join('|') : `(${alts.join('|')})`
}

/**
 * 相連插槽含指定顏色組合(任意順序、需連續相鄰):例如 "rgb" → `r-(g-b|b-g)|g-(r-b|b-r)|b-(r-g|g-r)`。
 * 顏色字母 r / g / b / w;`-` 相連。整個片段是一個 term 內的 `|`(遊戲語法:term 內 `|` = 任一)。
 */
export function linkColors (choice: string): string | null {
  const letters = [...choice.toLowerCase()].filter(c => 'rgbw'.includes(c))
  if (letters.length < 2 || letters.length > 6) return null
  const root: Trie = { next: new Map() }
  for (const p of permutations(letters)) {
    let node = root
    const s = p.join('-')
    for (const ch of s) {
      let n = node.next.get(ch)
      if (!n) { n = { next: new Map() }; node.next.set(ch, n) }
      node = n
    }
  }
  return renderTrie(root, true)
}

/** 插槽行裡某顏色至少 n 個:`插槽.*b.*b.*b` */
export function socketColorCount (label: string, color: string, n: number): string | null {
  const base = labelBase(label)
  const c = color.toLowerCase()
  if (!base || !'rgbw'.includes(c) || c.length !== 1 || !Number.isInteger(n) || n < 1 || n > 6) return null
  return base + Array.from({ length: n }, () => `.*${c}`).join('')
}
