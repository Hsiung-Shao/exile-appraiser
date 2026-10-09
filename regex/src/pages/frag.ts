// 演算法頁共用的片段組法(自寫)。只用 `.`、`*`、`[^\d]`、`\d`、`[…]`、`?`、`|`、`()`、`^`、`$`
// (第 35 步的嚴格寫法另用 `\+`、`\)`、`{n,}`,依據見下方「嚴格寫法」段):
// 不用大寫跳脫(`\D`、`\W`):萬一遊戲先把搜尋字串摺成小寫,`\D` 會變成意思相反的 `\d`。
import { rangeRegex, readableRangeRegex } from '../numeric'
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

// ---- 嚴格寫法(第 35 步:地圖 / 換界石數值區用;商店頁仍用上面的 propertyFragment)----
//
// 依據 = 遊戲實際顯示格式「標籤 + 半形 / 全形冒號 + 空白 + 可有可無的 + + 數值 + %」:
//   * 社群在遊戲裡實際使用的寫法(使用者 2026-10-04 提供):`"怪群大小[:：] *\+?([2-9]\d|[1-9]\d{2,}) *%"`、
//     `"稀有度[:：] *稀有"`、`"階級 14"` —— 同時證明遊戲搜尋列支援 `[:：]`、`\+`、`{n,}`。
//   * 剪貼簿樣本:PoE1 繁中 `poe1/test/fixtures/cmn-Hant/map-*.txt`「物品數量: +84% (augmented)」「稀有度: 稀有」;
//     PoE2 解析器前綴 `data/poe2/cmn-Hant/client_strings.js`「怪群大小: 」「物品稀有度: 」(ee2-patched)。
// 前界固定在冒號後(`[:：] *\+?` 之後只能是數字),數值片段用 numeric.ts 可讀模式「整段」比對整個數字;
// 後界:百分比 ` *%`;非百分比的 ≤ / 區間 `([^0-9]|$)`;≥ 不需要後界(吃到的若只是數字的前段,整個數字只會更大)。
// 不用 `.*`:標籤行數值不符時不會跨到下一行去找符合的數字(regex/test/pages.test.ts 跨行負例)。

/** 屬性行「標籤: +N%」的嚴格片段;百分比沒有上界(`[1-9][0-9]{n,}`),非百分比上界 = 定義域 */
export function strictPropertyFragment (
  label: string, v: AlgoValue, digits: 1 | 2 | 3, percent: boolean
): string | null {
  const op = rangeOp(v)
  if (!op) return null
  const re = readableRangeRegex({ min: op === 'le' ? undefined : v.min, max: op === 'ge' ? undefined : v.max }, { digits, open: percent })
  if (!re) return null
  const base = labelBase(label)
  if (!base) return null
  // R10:遊戲印法「怪群大小: +13% (augmented)」「物品數量: +68% (augmented)」(兩遊戲,使用者自客戶端複製):
  // 半形冒號 + 一個空白、% 前沒有空白
  if (percent) return `${base}: \\+?${re}%`
  return `${base}[:：]? *\\+?${re}${op === 'ge' ? '' : '([^0-9]|$)'}`
}

/**
 * 地圖 / 換界石階級。⚠ 階級不在「地圖階級: 16」這種屬性行,而在物品名稱尾端:
 *   PoE1「地圖（階級 16）」「凋落的 地圖（階級 14）」/ 英文「Map (Tier 16)」—— APT 解析器 `MAP_TIER`
 *   (`data/poe1/{cmn-Hant,en}/client_strings.js` `/（階級 (\d+)）$/`、`/ \(Tier (\d+)\)$/`)與 12 個繁中剪貼簿樣本
 *   (`poe1/test/fixtures/cmn-Hant/map-*.txt`、`filter-visibility/map-*.txt`)都沒有「地圖階級」行;
 *   PoE2「換界石（階級 14）」/「Waystone (Tier 14)」(`data/poe2/{cmn-Hant,en}/items.ndjson` 基底名稱;ee2 解析器的階級也取自名稱),
 *   社群寫法「階級 14」比對的就是它。所以片段 = `階級 *N）` / `Tier N\)`,`）` / `)` 是後界(整個數字)。
 *   繁中用 ` *`:剪貼簿樣本是「（階級 16）」(有空白),PobTools 由 GGPK 產生的語料行是「地圖（階級#）」(沒有空白),兩種都涵蓋;
 *   英文樣本與語料都是「(Tier 16)」/「(Tier #)」,固定一個空白。
 *   語料(`regex_poe1.json` map_mods 隱藏行)裡魔法地圖名稱「堅定的地圖（階級#）」「Unwavering Map (Tier #)」同樣是名稱尾端帶階級。
 * ⚠ PoE1 T17「夢魘地圖」名稱沒有階級,任何階級條件都不會中它。
 */
export const TIER_NAME_FORMAT = {
  zh: { head: '階級 *', tail: '）' },
  en: { head: 'Tier ', tail: '\\)' }
} as const

/** 語料行(含 `#`)是不是「名稱（階級 #）」/「Name (Tier #)」—— 階級片段中它是對的,不算衝突 */
export function isTierNameLine (line: string): boolean {
  return /（階級 *#）|\(Tier #\)/i.test(line)
}

/**
 * `hi` > 0 = 最高階級(R10):≥ 條件改成 min..hi 的封閉區間(「≥15」of 1..16 → `1[56]` 而不是 `(1[5-9]|[2-9][0-9])`);
 * 下限高於 hi(存檔值超出輸入範圍)維持開放寫法。
 */
export function mapTierFragment (v: AlgoValue, digits: 1 | 2 | 3, lang: 'zh' | 'en', hi = 0): string | null {
  const op = rangeOp(v)
  if (!op) return null
  let max = op === 'ge' ? undefined : v.max
  if (op === 'ge' && hi > 0 && (v.min as number) <= hi) max = hi
  const re = readableRangeRegex({ min: op === 'le' ? undefined : v.min, max }, { digits })
  if (!re) return null
  const f = TIER_NAME_FORMAT[lang]
  return `${f.head}${re}${f.tail}`
}

/** 稀有度行「稀有度: 稀有」:`稀有度[:：] *稀有`(冒號後是文字,「物品稀有度: +50%」「怪物稀有度: +30%」不會中) */
export function rarityFragment (label: string, value: string): string | null {
  const base = labelBase(label)
  const val = value.trim()
  if (!base || !val) return null
  return `${base}[:：] *${val}`
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
