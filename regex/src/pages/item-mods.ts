// 第 37 步(2026-10-04):物品詞綴數值頁 `item_mod_values`(PoE1)/ `item_mod_values_poe2`(PoE2)。
//
// 使用者:PoE1 常用正則是地圖、聖甲蟲、物品詞綴的數值;既有頁面沒有「物品詞綴數值」篩選。
//
// 資料:`data/<game>/{cmn-Hant,en}/stats.ndjson`(APT / EE2 的 stat 表,逐位元組同步;本檔只讀不寫)。
//   每行一個 stat(或 `{resolve, stats:[…]}` 群組):`ref` 英文模板、`matchers[].string` 該語言的顯示模板(`#` = 數值)、
//   `trade.ids.<類別>[]` 交易站 stat id。
// 對接:**以交易站 stat id(去掉類別前綴,例如 `stat_3299347043`)+ 英文 `ref` 為語言無關鍵**,兩語言各自讀檔後以鍵配對,
//   不用列位置對位。同一個 stat id 在資料裡出現多行(例如「增加 #% 暴擊率」與「增加 #% 全域暴擊率」共用 id)時以 `id|ref` 區分。
// 收錄:有 explicit / implicit / crafted / fractured 任一類 trade id(= 會出現在物品上的詞綴),
//   且該語言恰好一條「非 negate、非固定值、恰好一個 `#`、單行」的模板;其餘列入排除統計(`ItemModStats.excluded`)。
//   多數值詞綴(「附加 # 至 # 火焰傷害」)本步不收。
//
// 片段 = [錨點 ^] 前文 P + [\+?] + 數值 + 後文 S [錨點 $]:
//   * 數值 = numeric.ts `readableRangeRegex`(只寫 `[0-9]`;≥ 開放上界 `[1-9][0-9]{n,}`)。
//   * **預設整行**(協調者裁定,使用者 2026-10-04「寧可多幾個字也要好讀」):P = `#` 前整段文字 + 行首 `^`、S = `#` 後整段文字 + 行尾 `$`
//     (例 `^\+?N 最大生命$`、`^增加 \+?N% 移動速度$`;PobTools 產生器同樣以行為單位使用 `^` / `$`)。
//     行尾錨點輸出為 `LINE_END` `($| \()`(行尾或接著破裂等「空白 + 括號標記」;唯一性把「本行文字 + ` (`…」的模板也算衝突);
//     錨點挑選與長度(`cost`)仍以 `$` 一字計,收錄結果不變。
//     只有整行超過長度上限時才往回縮:先拿掉錨點、再從 P 的開頭 / S 的結尾**以詞為單位**縮(詞界 = 空白與標點,`isWordBreak`;
//     繁中沒有標點就不縮 —— 寧可整條不收),縮最少、且仍**全部模板語料唯一**的那個。不在詞中間截斷。
//   * 邊界:≥ 不需要(片段吃到的若只是數字的一段,整個數字只會更大);≤ / 區間在沒有 P 時補前界 `(^|[^0-9])`、
//     沒有 S 時補後界 `([^0-9]|$)`(與第 35 步 `strictPropertyFragment` 同一套)。
//   * `\+?`:模板(英文 ref 或該語言模板)寫 `+#`,或 P 不是空的(P 與數字之間可能夾 `+`)時加上。
// 唯一性(`buildModIndex`,結構化判斷,不逐值列舉):把該語言**全部** stat 的全部 matcher 行(含 negate / 固定值 / 偽詞綴)
//   拆成「數字位置」(`#` 或字面數字串),片段要能命中某行,必須在某個數字位置「前文以 P 結尾、後文以 S 開頭」;
//   與自己文字完全相同的行(同字的區域 / 全域詞綴、偽詞綴)不算衝突。判斷時去掉數字前的 `+`、英文摺小寫(都只會多算衝突)。
//   別行的 `#` 對上 P / S 裡的數字一律當衝突(保守);縮到詞界仍超過上限(繁中 40 / 英文 60)就不提供該詞綴(排除原因 `too_long`)。
//   regex/test/item-mods.test.ts 另以真正的 RegExp 對全部模板行逐一驗證(自身 0–999 逐值、其他行數值任意)。
// 已知限制(UI 註明、文件記錄):數值只認整數(小數詞綴 `dp` 不收);負值(「-5% 火焰抗性」)在 ≥ 條件下會被當成正數命中。
import { readableRangeRegex } from '../numeric'
import type { RegexGame, RegexLang } from '../data'
import { rangeOp, type AlgoEntry, type AlgoPage, type AlgoValue, type RangeOp } from './types'

export const ITEM_MOD_PAGE_IDS: Record<RegexGame, string> = {
  poe1: 'item_mod_values',
  poe2: 'item_mod_values_poe2'
}

export function isItemModPageId (id: string): boolean {
  return id === ITEM_MOD_PAGE_IDS.poe1 || id === ITEM_MOD_PAGE_IDS.poe2
}

/** 會出現在物品上的詞綴類別(trade id 前綴) */
export const ITEM_MOD_TRADE_CATS = ['explicit', 'implicit', 'crafted', 'fractured'] as const

/**
 * P + S(含跳脫與錨點)的長度上限;超過就不提供(排除原因 too_long)。
 * 英文字較長(同樣的辨識度約要 1.5 倍字數):繁中 40、英文 60(整行預設下,英文多數排除都是超過 60 字又縮不到詞界內)。
 */
export const MAX_ANCHOR_TEXT: Readonly<Record<RegexLang, number>> = { zh: 40, en: 60 }

// ---- 分類(純函式,依英文 ref 關鍵字;語言無關) ----

export type ItemModCategory = 'life' | 'mana' | 'es' | 'resist' | 'attr' | 'speed' | 'damage' | 'move' | 'other'

export const ITEM_MOD_CATEGORIES: ReadonlyArray<{ id: ItemModCategory, zh: string, en: string }> = [
  { id: 'life', zh: '生命', en: 'Life' },
  { id: 'mana', zh: '魔力', en: 'Mana' },
  { id: 'es', zh: '能量護盾', en: 'Energy Shield' },
  { id: 'resist', zh: '抗性', en: 'Resistances' },
  { id: 'attr', zh: '屬性', en: 'Attributes' },
  { id: 'speed', zh: '攻速 / 施速', en: 'Attack / Cast Speed' },
  { id: 'damage', zh: '傷害', en: 'Damage' },
  { id: 'move', zh: '移動速度', en: 'Movement Speed' },
  { id: 'other', zh: '其他', en: 'Other' }
]

/**
 * 依英文 ref 分類(先符合先贏,順序 = 移速 → 抗性 → 屬性 → 能量護盾 → 生命 → 魔力 → 攻速施速 → 傷害 → 其他)。
 * 例:「+#% to Fire Resistance」→ resist;「Regenerate # Life per second」→ life;「#% increased Movement Speed」→ move。
 */
export function itemModCategory (ref: string): ItemModCategory {
  const r = ref.toLowerCase()
  if (/\bmovement speed\b/.test(r)) return 'move'
  if (/\bresistances?\b/.test(r)) return 'resist'
  if (/\b(strength|dexterity|intelligence|attributes)\b/.test(r)) return 'attr'
  if (/\benergy shield\b/.test(r)) return 'es'
  if (/\blife\b/.test(r)) return 'life'
  if (/\bmana\b/.test(r)) return 'mana'
  if (/\b(attack|cast) speed\b/.test(r)) return 'speed'
  if (/\bdamage\b/.test(r)) return 'damage'
  return 'other'
}

// ---- 讀 stats.ndjson(只留需要的欄位) ----

export interface StatLite {
  ref: string
  /** 交易站 stat id(去掉類別前綴);explicit → implicit → crafted → fractured 的第一個;沒有 = null(不是物品詞綴) */
  statId: string | null
  /** 小數詞綴 */
  dp: boolean
  /** 全部 matcher 字串(含 negate / 固定值;不含 advanced) */
  strings: string[]
  /** 可當模板的 matcher:非 negate、非固定值 */
  plain: string[]
  /** 非 negate 的 matcher(含固定值;唯一性判斷時命中它們不算誤中) */
  same: string[]
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function liteOf (s: Json): StatLite | null {
  const ref = typeof s.ref === 'string' ? s.ref : ''
  if (!ref || !Array.isArray(s.matchers)) return null
  const strings: string[] = []
  const plain: string[] = []
  const same: string[] = []
  for (const m of s.matchers) {
    if (!isObj(m) || typeof m.string !== 'string') continue
    strings.push(m.string)
    if (m.negate !== true) same.push(m.string)
    if (m.negate !== true && m.value === undefined) plain.push(m.string)
  }
  let statId: string | null = null
  const ids = isObj(s.trade) && isObj(s.trade.ids) ? s.trade.ids : {}
  for (const c of ITEM_MOD_TRADE_CATS) {
    const v = ids[c]
    if (Array.isArray(v) && typeof v[0] === 'string') {
      const dot = v[0].indexOf('.')
      statId = dot >= 0 ? v[0].slice(dot + 1) : v[0]
      break
    }
  }
  return { ref, statId, dp: s.dp === true, strings, plain, same }
}

/** stats.ndjson → StatLite[](群組攤平;壞行略過) */
export function parseStatsNdjson (text: string): StatLite[] {
  const out: StatLite[] = []
  let start = 0
  while (start < text.length) {
    let end = text.indexOf('\n', start)
    if (end < 0) end = text.length
    const line = text.slice(start, end).trim()
    start = end + 1
    if (!line) continue
    let j: unknown
    try { j = JSON.parse(line) } catch { continue }
    if (!isObj(j)) continue
    const list = Array.isArray(j.stats) ? j.stats : [j]
    for (const s of list) {
      if (!isObj(s)) continue
      const l = liteOf(s)
      if (l) out.push(l)
    }
  }
  return out
}

// ---- 唯一性索引 ----

/** `#` 的佔位字元(代表一串數字) */
const SLOT = '\u0000'
const isDigit = (c: string): boolean => c >= '0' && c <= '9'

/**
 * 去掉 `#` 前的 `+`:模板的 `+#` 與 `#` 是同一行(stats 的 matcher 多半不寫 `+`,遊戲顯示有),片段在數值前一律容許 `\+?`。
 * 字面數字前的 `+`(「，+1 最大精魂」)是固定文字,保留;模型比對時另把「數字串前一個 `+`」視為可有可無(runsOf / suffixMatch / afterMatches)。
 */
function stripPlus (s: string): string {
  return s.replace(/\+(?=#)/g, '')
}

/** 模型用的正規化:`#` 前的 `+` 去掉、trim、`#` → 佔位;case = 摺小寫(英文) */
function normLine (s: string, fold: boolean): string {
  const t = stripPlus(s).trim().replace(/#/g, SLOT)
  return fold ? t.toLowerCase() : t
}

interface Run {
  line: number
  before: string
  after: string
}

export interface ModIndex {
  lines: string[]
  /** 依 after 排序 */
  byAfter: Run[]
  lineNo: Map<string, number>
  fold: boolean
}

/** 一行的全部數字位置:每個 `#` 佔位、每段字面數字串 */
function runsOf (line: string, idx: number): Run[] {
  const out: Run[] = []
  let i = 0
  while (i < line.length) {
    const c = line[i]
    if (c === SLOT) {
      const before = line.slice(0, i)
      out.push({ line: idx, before, after: line.slice(i + 1) })
      i++
    } else if (isDigit(c)) {
      let j = i
      while (j < line.length && isDigit(line[j])) j++
      // 數字前的 `+` 由片段的 `\+?` 吃掉 → 前文不含它
      const before = line.slice(0, line[i - 1] === '+' ? i - 1 : i)
      out.push({ line: idx, before, after: line.slice(j) })
      i = j
    } else i++
  }
  return out
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** 一個語言的全部模板行(多行 matcher 拆行)→ 索引 */
export function buildModIndex (stats: readonly StatLite[], lang: RegexLang): ModIndex {
  const fold = lang === 'en'
  const lineNo = new Map<string, number>()
  const lines: string[] = []
  for (const s of stats) {
    for (const str of s.strings) {
      for (const part of str.split('\n')) {
        const n = normLine(part, fold)
        if (!n || lineNo.has(n)) continue
        lineNo.set(n, lines.length)
        lines.push(n)
      }
    }
  }
  const runs: Run[] = []
  lines.forEach((l, i) => { runs.push(...runsOf(l, i)) })
  const byAfter = [...runs].sort((a, b) => cmp(a.after, b.after))
  return { lines, byAfter, lineNo, fold }
}

/** 第一個 ≥ key 的位置 */
function lowerBound (arr: readonly Run[], key: string, get: (r: Run) => string): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (get(arr[mid]) < key) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** after 以 prefix 開頭的區間 [a, b) */
function prefixRange (arr: readonly Run[], prefix: string, get: (r: Run) => string): [number, number] {
  const a = lowerBound(arr, prefix, get)
  let lo = a
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (get(arr[mid]).startsWith(prefix)) lo = mid + 1
    else hi = mid
  }
  return [a, lo]
}


const META = '.^$*+?()[]{}|\\'
/** 片段裡的字面文字跳脫(與 combine.ts escapeTerm 同一組字元) */
export function escapeFragText (s: string): string {
  let out = ''
  for (const c of s) out += META.includes(c) ? '\\' + c : c
  return out
}

/** 一個語言的錨點選擇結果(P / S 為原字形;fragment 依它組字串) */
export interface ModAnchor {
  /** `#` 前要比對的文字(尾段;caret = 整段前文 + 行首錨點) */
  p: string
  s: string
  caret: boolean
  dollar: boolean
  plus: boolean
  /** P + S 跳脫後的長度(含錨點;有 `alt` 時含交替群組) */
  cost: number
  /**
   * 多種寫法仲裁(item-mod-forms.json)的交替段:`side` 那一段(p 或 s,原字形)第 `at` 起 `len` 個字
   * (= 第一種寫法的差異段 `opts[0]`)換成 `(opts…)` 交替。沒有 = 單一寫法(舊行為)。
   */
  alt?: { side: 'p' | 's', at: number, len: number, opts: string[] }
}

/** 大區間(例如 S = 「%」)不逐一走,改試更長的 S */
const MAX_SCAN = 1500

/**
 * 行尾標記:遊戲搜尋文字在破裂(實測)/ 固定 / 符文等詞綴行的文字後面接「空白 + 括號標記」(`增加238%法術傷害 (fractured)`),
 * 所以片段的「行尾」= 真正行尾或接著這段標記(2026-10-09 使用者實測:`法術傷害$` 不中、`法術傷害 \(` 中、`法術傷害\(` 不中)。
 */
export const LINE_END = '($| \\()'
const MARKER_HEAD = ' ('

/**
 * 別行的後文 `other` 是否以 S 開頭(exact = 整段相等)。`other` 裡的 `#` 佔位可對上 S 的一整串數字(保守:視為相符)。
 */
function afterMatches (other: string, s: string, exact: boolean): boolean {
  let i = 0
  let k = 0
  while (k < s.length) {
    if (i >= other.length) return false
    if (other[i] === SLOT) {
      // 佔位 = 可有可無的 `+` + 一串數字
      if (s[k] === '+') { k++; if (k >= s.length) return true }
      if (!isDigit(s[k])) return false
      while (k < s.length && isDigit(s[k])) k++
      i++
      continue
    }
    if (other[i] !== s[k]) return false
    i++
    k++
  }
  return !exact || i === other.length || other.startsWith(MARKER_HEAD, i)
}

/**
 * B 的尾段與別行前文 `other` 相符的最長長度(由右往左;`other` 的 `#` 佔位吃掉 B 的一整串數字,保守)。
 * `whole` = other 也剛好用完(兩段前文相同 → 連行首錨點都分不開)。
 */
function suffixMatch (b: string, other: string): { n: number, whole: boolean } {
  let i = b.length - 1
  let o = other.length - 1
  while (i >= 0 && o >= 0) {
    if (other[o] === SLOT) {
      // 佔位 = 可有可無的 `+` + 一串數字(由右往左:先吃數字再吃 `+`)
      if (!isDigit(b[i])) break
      while (i >= 0 && isDigit(b[i])) i--
      if (i >= 0 && b[i] === '+') i--
      o--
      continue
    }
    if (other[o] !== b[i]) break
    i--
    o--
  }
  return { n: b.length - 1 - i, whole: i < 0 && o < 0 }
}

/** S 裡第一個數字之前的部分(依它在排序陣列取區間,再逐筆用 afterMatches 過濾) */
function plainHead (s: string): string {
  for (let i = 0; i < s.length; i++) if (isDigit(s[i])) return s.slice(0, i)
  return s
}

/**
 * 模板(單一 `#`)→ P / S:預設整行(行首 + 行尾錨點),超過 limit 才在詞界往回縮;都不唯一 / 都太長 = null。
 * `template` 是該語言原字形模板;`sameLines` = 同一個 stat 的非 negate 模板(含固定值那幾行,例如「1 個附加的天賦為珠寶插槽」),
 * 命中它們不算誤中(就是這個詞綴);negate 行(「減少 #% 移動速度」)仍算衝突。
 */
export function chooseAnchor (
  idx: ModIndex, template: string, plusHint: boolean, limit = MAX_ANCHOR_TEXT[idx.fold ? 'en' : 'zh'], sameLines: readonly string[] = []
): ModAnchor | null {
  const shown = stripPlus(template).trim()
  const own = idx.fold ? shown.toLowerCase() : shown
  const at = own.indexOf('#')
  if (at < 0 || own.indexOf('#', at + 1) >= 0 || own.length !== shown.length) return null
  const ownNorm = own.replace(/#/g, SLOT)
  const same = new Set<number>()
  const ownLine = idx.lineNo.get(ownNorm)
  if (ownLine !== undefined) same.add(ownLine)
  for (const s of sameLines) {
    for (const part of s.split('\n')) {
      const n = idx.lineNo.get(normLine(part, idx.fold))
      if (n !== undefined) same.add(n)
    }
  }
  const B = ownNorm.slice(0, at)
  const A = ownNorm.slice(at + 1)
  const shownB = shown.slice(0, at)
  const shownA = shown.slice(at + 1)
  // P 的起點 / S 的終點只能落在詞界(使用者 2026-10-04:寧可多幾個字也要好讀,不在詞中間截斷)
  const pStarts: number[] = [0]
  for (let i = 1; i <= shownB.length; i++) if (isWordBreak(shownB[i - 1])) pStarts.push(i)
  if (!pStarts.includes(shownB.length)) pStarts.push(shownB.length)
  const sEnds: number[] = []
  for (let k = 0; k < shownA.length; k++) if (isWordBreak(shownA[k])) sEnds.push(k)
  sEnds.push(shownA.length)

  let best: ModAnchor | null = null
  const consider = (j: number, caret: boolean, k: number, dollar: boolean): void => {
    const p = shownB.slice(shownB.length - j)
    const s = shownA.slice(0, k)
    if (!p && !s && !caret && !dollar) return
    const plus = plusHint || p.length > 0 || caret
    const cost = escapeFragText(p).length + escapeFragText(s).length + (caret ? 1 : 0) + (dollar ? 1 : 0)
    if (cost > limit) return
    // 越完整越好:預設 = 整行(行首 + 行尾錨點);超過上限才往回縮,縮最少的那個
    if (!best || cost > best.cost || (cost === best.cost && s.length > best.s.length)) {
      best = { p, s, caret, dollar, plus, cost }
    }
  }

  /** 衝突集合 → 需要的 P 長度與是否要行首錨點;無解 = null */
  const needP = (conflicts: Iterable<Run>): { j: number, caret: boolean } | null => {
    let j = 0
    let caret = false
    for (const c of conflicts) {
      if (same.has(c.line)) continue
      const m = suffixMatch(B, c.before)
      if (m.n >= B.length) {
        if (m.whole) return null
        caret = true
      } else j = Math.max(j, m.n + 1)
    }
    if (caret) return { j: B.length, caret: true }
    return { j, caret: false }
  }

  /** S(exact = 整段後文 + `$`)的衝突;區間太大 = null(不考慮這個 S) */
  const conflictsOf = (s: string, exact: boolean): Run[] | null => {
    const head = plainHead(s)
    let [a, b] = prefixRange(idx.byAfter, head, r => r.after)
    if (exact && head === s) {
      // 整段相等:只取完全相同的那一段(後文完全相同的必排在以它開頭的區間最前面)
      // 加上「本行文字 + 行尾標記」寫法的模板(`LINE_END` 也會命中它們)
      let e = a
      while (e < b && idx.byAfter[e].after === s) e++
      const [ma, mb] = prefixRange(idx.byAfter, s + MARKER_HEAD, r => r.after)
      return [...idx.byAfter.slice(a, e), ...idx.byAfter.slice(ma, mb)]
    } else if (b - a > MAX_SCAN && !exact) return null
    const out: Run[] = []
    for (let i = a; i < b; i++) {
      const r = idx.byAfter[i]
      if (head === s ? (!exact || r.after === s) : afterMatches(r.after, s, exact)) out.push(r)
    }
    return out
  }

  const trySide = (k: number, dollar: boolean): void => {
    const list = conflictsOf(A.slice(0, k), dollar)
    if (!list) return
    const n = needP(list)
    if (!n) return
    for (const start of pStarts) {
      const j = shownB.length - start
      if (n.caret) { if (start === 0) consider(j, true, k, dollar); continue }
      if (j >= n.j) consider(j, false, k, dollar)
      if (start === 0) consider(j, true, k, dollar)
    }
  }
  trySide(A.length, true)
  for (const k of sEnds) trySide(k, false)
  return best
}

/** 詞界:空白與標點(繁中不以單字切,沒有標點就不縮) */
function isWordBreak (c: string): boolean {
  return /[\s,，、:：;；。.!！?？()（）「」『』[\]/·]/.test(c)
}

/** ≤ / 區間上限的定義域(三位數) */
export const ITEM_MOD_MAX = 999

/** 錨點 + 數值條件 → 片段;條件不成立 = null */
export function itemModFragment (a: ModAnchor, v: AlgoValue): string | null {
  const op = rangeOp(v)
  if (!op) return null
  // ≤ / 區間的上限在定義域 0–999 內(≥ 沒有上限);超出 = 不成立(不悄悄夾成 999)
  if (op !== 'ge' && (v.max! > ITEM_MOD_MAX || v.max! < 0)) return null
  const num = readableRangeRegex(
    { min: op === 'le' ? undefined : v.min, max: op === 'ge' ? undefined : v.max },
    { digits: 3, open: op === 'ge' }
  )
  if (!num) return null
  const bounded = op !== 'ge'
  const left = bounded && !a.p && !a.caret ? '(^|[^0-9])' : ''
  const right = bounded && !a.s && !a.dollar ? '([^0-9]|$)' : ''
  let p = sideText(a, 'p')
  // 片段開頭的 `!` = 遊戲的排除語法,要跳脫
  if (!a.caret && p.startsWith('!')) p = '\\' + p
  return `${a.caret ? '^' : ''}${p}${left}${a.plus ? '\\+?' : ''}${num}${sideText(a, 's')}${right}${a.dollar ? LINE_END : ''}`
}

/** 交替群組:兩種寫法其中一種差異段是空的 → `(X)?`;否則 `(A|B|…)`(遊戲正則避免 `(?:`) */
function altGroup (opts: readonly string[]): string {
  const nonEmpty = opts.filter(o => o)
  if (nonEmpty.length === 1 && opts.length === 2) return `(${escapeFragText(nonEmpty[0])})?`
  return `(${opts.map(escapeFragText).join('|')})`
}

/** 錨點的 p / s 跳脫後文字(有交替段就換成群組) */
function sideText (a: ModAnchor, side: 'p' | 's'): string {
  const t = side === 'p' ? a.p : a.s
  const alt = a.alt
  if (!alt || alt.side !== side) return escapeFragText(t)
  return escapeFragText(t.slice(0, alt.at)) + altGroup(alt.opts) + escapeFragText(t.slice(alt.at + alt.len))
}

// ---- 多種寫法仲裁(data/regex/item-mod-forms.json) ----

/** 仲裁表:`<statId>|<ref>` → 該語言查得到的寫法(stats.ndjson 原 matcher 字串、原順序) */
export interface ItemModForms {
  zh: Record<string, string[]>
  en: Record<string, string[]>
}

/** 解析仲裁檔(schema 1)取一個遊戲;格式不對 = null(呼叫端退回沒有仲裁 = 舊行為) */
export function parseItemModForms (text: string, game: RegexGame): ItemModForms | null {
  let j: unknown
  try { j = JSON.parse(text) } catch { return null }
  if (!isObj(j) || j.schema !== 1 || !isObj(j[game])) return null
  const g = j[game] as Json
  const lang = (v: unknown): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    if (!isObj(v)) return out
    for (const [k, xs] of Object.entries(v)) {
      if (Array.isArray(xs) && xs.length && xs.every(x => typeof x === 'string')) out[k] = xs as string[]
    }
    return out
  }
  return { zh: lang(g.zh), en: lang(g.en) }
}

/** 多種寫法 → 共同前綴 / 後綴 + 差異段;差異段含 `#` 或任一寫法多行 = null */
function splitForms (forms: readonly string[]): { cp: number, cs: number, opts: string[] } | null {
  if (forms.some(f => f.includes('\n'))) return null
  const minLen = Math.min(...forms.map(f => f.length))
  let cp = 0
  while (cp < minLen && forms.every(f => f[cp] === forms[0][cp])) cp++
  let cs = 0
  while (cs < minLen - cp && forms.every(f => f[f.length - 1 - cs] === forms[0][forms[0].length - 1 - cs])) cs++
  const opts = forms.map(f => f.slice(cp, f.length - cs))
  if (opts.some(o => o.includes('#'))) return null
  return { cp, cs, opts }
}

/**
 * 多種寫法的交替錨點:每種寫法都要以**整行**(行首 + 行尾錨點、不縮短)通過 `chooseAnchor` 唯一性判斷
 * (交替只會命中這幾種寫法本身,所以逐一驗證 = 整條驗證);組合後片段(P + S 含交替,跳脫後 + 錨點)不得超過 limit。
 */
function altAnchor (
  idx: ModIndex, forms: readonly string[], plusHint: boolean, limit: number, sameLines: readonly string[]
): ModAnchor | null {
  const shown = forms.map(f => stripPlus(f).trim())
  const sp = splitForms(shown)
  if (!sp) return null
  for (const f of shown) {
    const a = chooseAnchor(idx, f, plusHint, Number.MAX_SAFE_INTEGER, sameLines)
    const at = f.indexOf('#')
    if (!a || !a.caret || !a.dollar || a.p !== f.slice(0, at) || a.s !== f.slice(at + 1)) return null
  }
  const f0 = shown[0]
  const hash = f0.indexOf('#')
  const p = f0.slice(0, hash)
  const s = f0.slice(hash + 1)
  const len = sp.opts[0].length
  const alt: ModAnchor['alt'] = hash < sp.cp
    ? { side: 's', at: sp.cp - hash - 1, len, opts: sp.opts }
    : { side: 'p', at: sp.cp, len, opts: sp.opts }
  const a: ModAnchor = { p, s, caret: true, dollar: true, plus: true, cost: 0, alt }
  a.cost = sideText(a, 'p').length + sideText(a, 's').length + 2
  return a.cost > limit ? null : a
}

// ---- 建頁 ----

export type ItemModExcludeReason =
  | 'decimal' | 'multi_value' | 'multi_form' | 'multiline' | 'missing_lang' | 'no_unique' | 'too_long'

export interface ItemModData {
  game: RegexGame
  entries: ItemModEntryData[]
  /** 物品詞綴總數(有 explicit / implicit / crafted / fractured trade id 的 stat,依鍵去重) */
  itemStats: number
  /** 同字合併(兩語模板都相同的不同 stat id) */
  merged: number
  excluded: Record<ItemModExcludeReason, number>
  /** 每個原因最多 8 筆例子(英文 ref) */
  samples: Record<ItemModExcludeReason, string[]>
}

export interface ItemModEntryData {
  id: string
  ref: string
  zh: string
  en: string
  cat: ItemModCategory
  percent: boolean
  anchors: Record<RegexLang, ModAnchor>
}

function keyOfStat (s: StatLite): string | null {
  return s.statId ? `${s.statId}|${s.ref}` : null
}

/** 有一種被其他每一種包含的寫法(PoE2「增加#%移動速度」⊂「玩家增加#%移動速度」) */
function coreForm (forms: readonly string[]): string | undefined {
  return forms.find(f => forms.every(o => o.includes(f)))
}

type Template = { t: string, alts?: string[] } | { reason: ItemModExcludeReason }

/**
 * 該語言的模板:恰好一條非 negate、非固定值的 matcher,且恰好一個 `#`、單行。
 * 多種寫法:有一種被其他每一種包含就用它(片段多半也中較長的寫法;唯一性判斷時同一 stat 的其他寫法不算誤中);
 * 否則查仲裁(`arb` = item-mod-forms.json 該鍵的寫法):沒有 → multi_form;一種 → 用它;多種 → 交替
 * (`alts`;差異段含 `#` / 多行 → multi_form)。
 */
function templateOf (s: StatLite, arb?: readonly string[]): Template {
  if (s.dp) return { reason: 'decimal' }
  const single = s.plain.filter(m => (m.match(/#/g) ?? []).length === 1)
  if (!single.length) return { reason: 'multi_value' }
  let t = single[0].trim()
  let alts: string[] | undefined
  if (single.length > 1) {
    const forms = single.map(m => m.trim())
    const core = coreForm(forms)
    if (core) t = core
    else {
      const picked = (arb ?? []).filter(f => (f.match(/#/g) ?? []).length === 1).map(f => f.trim())
      if (!picked.length) return { reason: 'multi_form' }
      if (picked.length === 1) t = picked[0]
      else {
        // 仲裁多種一律交替(含彼此包含的情形:差異段之一為空 → `(X)?`)。不取被包含者:仲裁寫法用整行錨點,
        // 較短的那種整行片段中不了較長的寫法(「#% increased Pack Size」整行不中「… in Map」)。
        if (!splitForms(picked.map(f => stripPlus(f).trim()))) return { reason: 'multi_form' }
        t = picked[0]
        alts = picked
      }
    }
  }
  if (t.includes('\n')) return { reason: 'multiline' }
  return alts ? { t, alts } : { t }
}

/** 模板 → 錨點(單一寫法走 chooseAnchor;交替走 altAnchor) */
function anchorOf (idx: ModIndex, tpl: { t: string, alts?: string[] }, plusHint: boolean, limit: number, same: readonly string[]): ModAnchor | null {
  if (tpl.alts) return altAnchor(idx, tpl.alts, plusHint || tpl.alts.some(f => /\+#/.test(f)), limit, same)
  return chooseAnchor(idx, tpl.t, plusHint || /\+#/.test(tpl.t), limit, same)
}

const EMPTY_COUNTS = (): Record<ItemModExcludeReason, number> => ({
  decimal: 0, multi_value: 0, multi_form: 0, multiline: 0, missing_lang: 0, no_unique: 0, too_long: 0
})

/**
 * 兩語言 stat 表 → 可選詞綴(含兩語錨點)+ 排除統計。純函式;建索引約數百 ms(renderer 第一次開頁才跑)。
 * 兩語言都找得到唯一片段才收(輸出語言切換時同一列兩邊都能用)。
 */
export function buildItemModData (
  game: RegexGame, zhStats: readonly StatLite[], enStats: readonly StatLite[], forms: ItemModForms | null = null
): ItemModData {
  const zhIdx = buildModIndex(zhStats, 'zh')
  const enIdx = buildModIndex(enStats, 'en')
  const enByKey = new Map<string, StatLite>()
  for (const s of enStats) { const k = keyOfStat(s); if (k && !enByKey.has(k)) enByKey.set(k, s) }
  const excluded = EMPTY_COUNTS()
  const samples: Record<ItemModExcludeReason, string[]> = {
    decimal: [], multi_value: [], multi_form: [], multiline: [], missing_lang: [], no_unique: [], too_long: []
  }
  const exclude = (r: ItemModExcludeReason, ref: string): void => {
    excluded[r]++
    if (samples[r].length < 8) samples[r].push(ref)
  }
  const seenKey = new Set<string>()
  const seenText = new Set<string>()
  const usedId = new Set<string>()
  const entries: ItemModEntryData[] = []
  let itemStats = 0
  let merged = 0
  for (const zs of zhStats) {
    const key = keyOfStat(zs)
    if (!key || seenKey.has(key)) continue
    seenKey.add(key)
    itemStats++
    const es = enByKey.get(key)
    if (!es) { exclude('missing_lang', zs.ref); continue }
    const zt = templateOf(zs, forms?.zh[key])
    if ('reason' in zt) { exclude(zt.reason, zs.ref); continue }
    const et = templateOf(es, forms?.en[key])
    if ('reason' in et) { exclude(et.reason, zs.ref); continue }
    // 兩語模板都相同的不同 stat(同字的區域 / 全域詞綴):物品上分不出來,併成一列(留第一個鍵)
    const textKey = `${stripPlus(zt.t)}\u0001${stripPlus(et.t).toLowerCase()}`
    if (seenText.has(textKey)) { merged++; continue }
    const plusHint = /\+#/.test(zs.ref)
    const za = anchorOf(zhIdx, zt, plusHint, MAX_ANCHOR_TEXT.zh, zs.same)
    const ea = anchorOf(enIdx, et, plusHint, MAX_ANCHOR_TEXT.en, es.same)
    if (!za || !ea) {
      // 有解但超過長度上限 vs 根本沒有唯一寫法:放寬上限再試一次來區分
      exclude(longOnly(zhIdx, zt, za, plusHint, zs.same) || longOnly(enIdx, et, ea, plusHint, es.same) ? 'too_long' : 'no_unique', zs.ref)
      continue
    }
    seenText.add(textKey)
    const id = usedId.has(zs.statId!) ? key : zs.statId!
    usedId.add(id)
    entries.push({
      id,
      ref: zs.ref,
      zh: zt.t,
      en: et.t,
      cat: itemModCategory(zs.ref),
      percent: zt.t.includes('#%') || et.t.includes('#%'),
      anchors: { zh: za, en: ea }
    })
  }
  return { game, entries, itemStats, merged, excluded, samples }
}

/** 沒找到錨點時:是不是只因為超過長度上限(放寬到 400 字就找得到) */
function longOnly (idx: ModIndex, tpl: { t: string, alts?: string[] }, found: ModAnchor | null, plusHint: boolean, same: readonly string[]): boolean {
  if (found) return false
  if (tpl.alts) return anchorOf(idx, tpl, plusHint, 400, same) !== null
  return chooseAnchor(idx, tpl.t, false, 400, same) !== null
}

const ALL_OPS: RangeOp[] = ['ge', 'le', 'range']

/** 資料 → 演算法頁;data = null(還沒載)= 沒有項目的頁(清單 / 書籤看得到頁名,勾選等載入後才還原) */
export function itemModPage (game: RegexGame, data: ItemModData | null): AlgoPage {
  const entries: AlgoEntry[] = (data?.entries ?? []).map(d => ({
    id: d.id,
    g: ITEM_MOD_CATEGORIES.findIndex(c => c.id === d.cat),
    t17: false,
    affixZh: '',
    zh: [d.zh],
    en: [d.ref],
    // 英文客戶端顯示的模板(搜尋也比對它)
    hiddenZh: [],
    hiddenEn: [d.en],
    input: { kind: 'range', digits: 3, percent: d.percent, ops: ALL_OPS, lo: 0, hi: 999, def: { min: 1 } },
    fragment: (v: AlgoValue, lang: RegexLang) => itemModFragment(d.anchors[lang], v)
  }))
  const poe1 = game === 'poe1'
  return {
    game,
    id: ITEM_MOD_PAGE_IDS[game],
    kind: 'numeric',
    title: '物品詞綴數值',
    titleEn: 'Item mod values',
    note: (poe1 ? 'PoE1' : 'PoE2') + ' 物品詞綴(明確 / 固定 / 工藝 / 破裂)的數值條件,每條各自一個 term(同時成立)。模板取自 stats.ndjson,' +
      '片段預設是整行模板文字(行首 / 行尾錨點),太長才以詞為單位往回縮,並保證在全部詞綴模板中唯一;只收恰好一個數值的詞綴(「附加 # 至 # 火焰傷害」這類不收),小數與負值不支援。',
    limit: 250,
    groups: ITEM_MOD_CATEGORIES.map(c => c.zh),
    groupsEn: ITEM_MOD_CATEGORIES.map(c => c.en),
    entries,
    ambientZh: [],
    ambientEn: [],
    namePrefixZh: [],
    nameSuffixZh: [],
    namePrefixEn: [],
    nameSuffixEn: []
  }
}

// ---- 清單篩選(UI 用的純函式) ----

export interface ItemModFilter {
  /** 空白分隔的關鍵字,全部都要出現(繁中模板 / 英文 ref / 英文模板,不分大小寫) */
  search: string
  /** 分類索引(= ITEM_MOD_CATEGORIES 的位置);-1 = 全部 */
  group: number
  /** 只看已勾選 */
  pickedOnly: boolean
}

/**
 * 篩選 → 要顯示的列索引:已勾選的永遠在前(不受關鍵字 / 分類 / 上限影響),其餘依資料順序,最多 `cap` 列。
 * `total` = 符合條件的列數(含已勾選)。
 */
export function filterItemMods (
  page: AlgoPage, picked: readonly number[], f: ItemModFilter, cap = 200
): { rows: number[], total: number } {
  const words = f.search.toLowerCase().split(/\s+/).filter(Boolean)
  const pickedSet = new Set(picked)
  const match = (i: number): boolean => {
    const e = page.entries[i]
    if (f.group >= 0 && e.g !== f.group) return false
    if (!words.length) return true
    const hay = [...e.zh, ...e.en, ...e.hiddenEn].join('\n').toLowerCase()
    return words.every(w => hay.includes(w))
  }
  const rows = [...pickedSet].filter(i => i >= 0 && i < page.entries.length).sort((a, b) => a - b)
  let total = rows.length
  if (f.pickedOnly) return { rows, total }
  for (let i = 0; i < page.entries.length; i++) {
    if (pickedSet.has(i) || !match(i)) continue
    total++
    if (rows.length < cap + pickedSet.size) rows.push(i)
  }
  return { rows, total }
}

/** 每個分類的項目數(下拉選單用) */
export function itemModGroupCounts (page: AlgoPage): number[] {
  const n = ITEM_MOD_CATEGORIES.map(() => 0)
  for (const e of page.entries) if (e.g >= 0 && e.g < n.length) n[e.g]++
  return n
}
