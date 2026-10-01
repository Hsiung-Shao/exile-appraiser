// Poe Regex 核心:逐函式移植自 PobTools `pob-zh-engine/host/regex_gen.{h,cpp}`(同一作者自寫,非 poe.re)。
//
// 每個函式上方註明對應的 C++ 函式與行號(regex_gen.cpp @ pob-zh-engine d9ef0b6)。
// 語意差異只有「單位」:C++ 以 UTF-8 位元組運算(CharOffsets 找字元邊界),這裡以 Unicode 碼點運算。
// 對合法 UTF-8 / 只含 BMP 的資料兩者等價(多位元組字元的尾位元組永遠 ≥ 0x80,不會撞到 ASCII 語法字元與數字字元;
// 子字串比對以字元起點對齊;字典序比較用碼點序 = UTF-8 位元組序)。見 docs/regex-port.md。
//
// 規則(與 C++ 相同):
//   * 印出來的行(texts)才能「提出 token」與「算找到」;hidden / ambient 只能否決。
//   * token 只從 `#` 切開的單一字面片段內切(嚴格判是);判斷會不會誤中時 `#` 當任意數字(寬鬆判否)。
//   * 無 DOM、無檔案、無 Node API。

/** C++ `Mode`(regex_gen.h):any = "a|b"、all = a b、none = "!a|b" */
export type Mode = 'any' | 'all' | 'none'

/** C++ `Entry`(regex_gen.h) */
export interface Entry {
  id: string
  /** 遊戲印出的行,`#` = 數值 */
  texts: string[]
  /** 搜尋也會讀但不是詞綴行的文字(進階說明、標籤、提醒文字、名稱片段);只否決 */
  hidden?: string[]
}

/** C++ `Ambient`(regex_gen.h):頁面上每件物品都有的文字 */
export interface Ambient {
  lines?: string[]
  /** 稀有名稱左半的隨機字 */
  nameLeft?: string[]
  /** 稀有名稱右半的隨機字(保留前導空白) */
  nameRight?: string[]
}

/** C++ `Options`(regex_gen.h) */
export interface Options {
  /** token 最長碼點數(預設 12) */
  maxTokenChars?: number
  /** 允許 `^` / `$` 錨點(預設 true) */
  anchors?: boolean
}

/** C++ `Result`(regex_gen.h)。`usedTokens` = C++ 的 `tokens` */
export interface Result {
  query: string
  length: number
  usedTokens: string[]
  /** 無法單獨指定的勾選(語料索引,遞增) */
  unresolved: number[]
  exact: boolean
}

/** C++ `Check`(regex_gen.h) */
export interface Check {
  ok: boolean
  missing: number[]
  extra: number[]
  ambient: string[]
}

// ---- 常數與小工具 ----------------------------------------------------------------

/** regex_gen.cpp:14 `kMeta`:搜尋列當語法讀的字元;含有的 token 一律不考慮 */
const kMeta = '.^$*+?()[]{}|\\"!'
/** regex_gen.cpp:19 `kNumChars`:`#` 可能印成的字元 */
const kNumChars = '0123456789.,+-'

function hasAnyOf (s: string, set: string): boolean {
  for (const ch of s) if (set.includes(ch)) return true
  return false
}

/** regex_gen.cpp:21 `IsNumChar` */
function isNumChar (c: string): boolean {
  return (c >= '0' && c <= '9') || c === '.' || c === ',' || c === '-' || c === '+'
}

/** regex_gen.cpp:26 `LowerAscii` + :30 `Fold`:只摺 ASCII A–Z(與 C++ 相同,不做 Unicode 大小寫) */
export function fold (s: string): string {
  return s.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32))
}

/**
 * regex_gen.cpp:39 `CharOffsets`:每個字元起點的偏移 + 結尾。
 * C++ 是 UTF-8 位元組偏移;這裡是 UTF-16 code unit 偏移(每個碼點一格),`s.slice(off[a], off[b])` = 第 a..b 個碼點。
 */
export function charOffsets (s: string): number[] {
  const off: number[] = []
  let i = 0
  for (const ch of s) {
    off.push(i)
    i += ch.length
  }
  off.push(s.length)
  return off
}

/** regex_gen.cpp:291 `CharCount`:碼點數(遊戲搜尋列的計數方式) */
export function charCount (s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    // 低位代理不另計(一個碼點 = 一個字)
    if (c < 0xDC00 || c > 0xDFFF) n++
  }
  return n
}

/** 碼點序比較(= C++ std::string 的 UTF-8 位元組序)。C++ 的 `Render(a) < Render(b)` */
function lessCodePoint (a: string, b: string): boolean {
  const A = Array.from(a)
  const B = Array.from(b)
  const n = Math.min(A.length, B.length)
  for (let i = 0; i < n; i++) {
    const x = A[i].codePointAt(0)!
    const y = B[i].codePointAt(0)!
    if (x !== y) return x < y
  }
  return A.length < B.length
}

// ---- Line / Prep -----------------------------------------------------------------

/** regex_gen.cpp:54 `Line`:一行在 `#` 切開;frags.length = 數值數 + 1,空片段有意義(行首/行尾是數值) */
interface Line {
  frags: string[]
  /** `Atoms()` 的快取(C++ 每次 MayMatchLine 重建;結果相同,只是省時間) */
  atoms?: Atom[]
}

/** regex_gen.cpp:58 `Prepped` */
interface Prepped {
  lines: Line[]
  hasNumber: boolean
}

/** regex_gen.cpp:63 `Prep`:摺小寫後在 `#` 切片段;空行略過 */
function prep (texts: readonly string[] | undefined): Prepped {
  const p: Prepped = { lines: [], hasNumber: false }
  for (const raw of texts ?? []) {
    const t = fold(raw)
    if (t.length === 0) continue
    const frags = t.split('#')
    if (frags.length > 1) p.hasNumber = true
    p.lines.push({ frags })
  }
  return p
}

// ---- Token -------------------------------------------------------------------------

/** regex_gen.cpp:83 `Token` */
interface Token {
  body: string
  head: boolean
  tail: boolean
}

/** token 的雜湊鍵(取代 C++ `TokenHash`,regex_gen.cpp:94)。body 不可能含 `^`/`$`(kMeta 已排除),所以無碰撞 */
function tokenKey (t: Token): string {
  return `${t.head ? '^' : ''}${t.body}${t.tail ? '$' : ''}`
}

/** regex_gen.cpp:101 `Render`(與 tokenKey 同字串) */
function render (t: Token): string {
  return tokenKey(t)
}

/** regex_gen.cpp:110 `TokenChars`:碼點數 + 錨點 */
function tokenChars (t: Token): number {
  return (t.head ? 1 : 0) + (t.tail ? 1 : 0) + charCount(t.body)
}

// ---- matching ----------------------------------------------------------------------

/** regex_gen.cpp:121 `AlwaysMatchesLine`:token 是否對這行的每種 roll 都中(嚴格:只在單一字面片段內) */
function alwaysMatchesLine (ln: Line, t: Token): boolean {
  const n = ln.frags.length
  if (t.head && t.tail) return n === 1 && ln.frags[0] === t.body
  if (t.head) return ln.frags[0].startsWith(t.body)
  if (t.tail) return ln.frags[n - 1].endsWith(t.body)
  for (const f of ln.frags) if (f.includes(t.body)) return true
  return false
}

/** regex_gen.cpp:141 `Atom`:一個字面字元(C++ 是位元組,這裡是碼點)或一個數值萬用 */
interface Atom {
  ch: string
  wild: boolean
}

/** regex_gen.cpp:146 `Atoms` */
function atomsOf (ln: Line): Atom[] {
  if (ln.atoms) return ln.atoms
  const a: Atom[] = []
  for (let i = 0; i < ln.frags.length; i++) {
    if (i) a.push({ ch: '', wild: true })
    for (const c of ln.frags[i]) a.push({ ch: c, wild: false })
  }
  ln.atoms = a
  return a
}

/** regex_gen.cpp:158 `MatchFrom`:tok[ti..) 對 atoms[ai..);toEnd = 尾端 `$` */
function matchFrom (tok: readonly string[], ti: number, atoms: readonly Atom[], ai: number, toEnd: boolean): boolean {
  if (ti === tok.length) return !toEnd || ai === atoms.length
  if (ai === atoms.length) return false
  if (atoms[ai].wild) {
    // 印出的數值不會是空的:至少吃掉 token 的一個字元,且只能吃數值字元;token 可在數值中途結束
    let k = 0
    while (ti + k < tok.length && isNumChar(tok[ti + k])) k++
    for (let c = 1; c <= k; c++) {
      if (matchFrom(tok, ti + c, atoms, ai + 1, toEnd)) return true
    }
    return false
  }
  if (tok[ti] !== atoms[ai].ch) return false
  return matchFrom(tok, ti + 1, atoms, ai + 1, toEnd)
}

/** regex_gen.cpp:179 `MayMatchLine`:某種 roll 下可能中(寬鬆,用來判「會不會誤中」) */
function mayMatchLine (ln: Line, t: Token): boolean {
  if (t.body.length === 0) return true
  const atoms = atomsOf(ln)
  const tok = Array.from(t.body)
  if (t.head) return matchFrom(tok, 0, atoms, 0, t.tail)
  for (let start = 0; start < atoms.length; start++) {
    if (matchFrom(tok, 0, atoms, start, t.tail)) return true
  }
  return false
}

/** regex_gen.cpp:192 `AlwaysMatches` */
function alwaysMatches (p: Prepped, t: Token): boolean {
  for (const ln of p.lines) if (alwaysMatchesLine(ln, t)) return true
  return false
}

/** regex_gen.cpp:199 `MayMatch` */
function mayMatch (p: Prepped, t: Token): boolean {
  for (const ln of p.lines) if (mayMatchLine(ln, t)) return true
  return false
}

/**
 * regex_gen.cpp:210 `ForEachToken`:每個片段內 1..maxChars 碼點的子字串,含 kMeta 的跳過;
 * anchors 時另給 `^body`(片段是行首且從 0 開始)、`body$`(片段是行尾且到結尾)、`^body$`。
 */
function forEachToken (p: Prepped, maxChars: number, anchors: boolean, sink: (t: Token) => void): void {
  for (const ln of p.lines) {
    const nf = ln.frags.length
    for (let fi = 0; fi < nf; fi++) {
      const f = ln.frags[fi]
      if (f.length === 0) continue
      const off = charOffsets(f)
      const nc = off.length - 1
      for (let a = 0; a < nc; a++) {
        for (let b = a + 1; b <= nc && (b - a) <= maxChars; b++) {
          const body = f.slice(off[a], off[b])
          if (hasAnyOf(body, kMeta)) continue
          sink({ body, head: false, tail: false })
          if (!anchors) continue
          const atStart = fi === 0 && a === 0
          const atEnd = fi === nf - 1 && b === nc
          if (atStart) sink({ body, head: true, tail: false })
          if (atEnd) sink({ body, head: false, tail: true })
          if (atStart && atEnd) sink({ body, head: true, tail: true })
        }
      }
    }
  }
}

/** regex_gen.cpp:236 `QuoteIfNeeded` */
function quoteIfNeeded (term: string): string {
  return term.includes(' ') ? `"${term}"` : term
}

/** regex_gen.cpp:241 `ParseAlternation`:去掉前導 `!`,在 `|` 切,各段剝 `^`/`$` 並摺小寫;空段略過 */
function parseAlternation (term: string): Token[] {
  if (term.startsWith('!')) term = term.slice(1)
  const out: Token[] = []
  for (const part of term.split('|')) {
    if (part.length === 0) continue
    let s = part
    const t: Token = { body: '', head: false, tail: false }
    if (s.startsWith('^')) { t.head = true; s = s.slice(1) }
    if (s.endsWith('$')) { t.tail = true; s = s.slice(0, -1) }
    t.body = fold(s)
    out.push(t)
  }
  return out
}

/** regex_gen.cpp:263 `SplitTerms`:以空白切 term,雙引號內不切(引號本身丟掉) */
function splitTerms (q: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (const c of q) {
    if (c === '"') { inQuote = !inQuote; continue }
    if (c === ' ' && !inQuote) {
      if (cur.length) out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.length) out.push(cur)
  return out
}

/** regex_gen.cpp:281 `Candidate` */
interface Candidate {
  tok: Token
  rendered: string
  hits: number[]
  hiddenHits: number[] | null
  cost: number
}

function cloneResult (r: Result): Result {
  return { ...r, usedTokens: [...r.usedTokens], unresolved: [...r.unresolved] }
}

function binarySearch (arr: readonly number[], x: number): boolean {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo < arr.length && arr[lo] === x
}

// ---- Corpus ------------------------------------------------------------------------

/** regex_gen.h `Corpus` + regex_gen.cpp:302 `Corpus::Impl`:準備好的語料與三份索引 */
export class Corpus {
  private entries: Entry[] = []
  private prepped: Prepped[] = []
  private hidden: Prepped[] = []
  private ambient: Prepped = { lines: [], hasNumber: false }
  private opt: Required<Options> = { maxTokenChars: 12, anchors: true }
  /** token → 印出文字字面含它的語料(遞增) */
  private index = new Map<string, number[]>()
  /** 同上,但只看 hidden;命中永不算「找到」 */
  private hiddenIndex = new Map<string, number[]>()
  private ambientIndex = new Set<string>()
  private numbered: number[] = []
  private numberedHidden: number[] = []
  private leftTails = new Set<string>()
  private rightHeads = new Set<string>()
  private leftFull = new Set<string>()
  private rightFull = new Set<string>()
  /** build() 的小型 memo(同一組 picks + mode 的結果只算一次;只留最近幾筆,reset 時清空) */
  private buildMemo = new Map<string, Result>()

  constructor (entries?: Entry[], ambient?: Ambient, opt?: Options) {
    if (entries) this.reset(entries, ambient, opt)
  }

  /** regex_gen.cpp:379 `Empty` */
  empty (): boolean { return this.entries.length === 0 }
  /** regex_gen.cpp:380 `Size` */
  size (): number { return this.entries.length }
  /** regex_gen.cpp:381 `At` */
  at (i: number): Entry { return this.entries[i] }

  /** regex_gen.cpp:325 `Impl::JoinsName`:token 是否跨在稀有名稱兩個隨機字的接縫上;`^` 要整個左字、`$` 要整個右字 */
  private joinsName (tok: Token): boolean {
    if (this.leftTails.size === 0 || this.rightHeads.size === 0) return false
    const off = charOffsets(tok.body)
    const nc = off.length - 1
    for (let k = 1; k < nc; k++) {
      const a = tok.body.slice(0, off[k])
      const b = tok.body.slice(off[k])
      if (!(tok.head ? this.leftFull.has(a) : this.leftTails.has(a))) continue
      if (tok.tail ? this.rightFull.has(b) : this.rightHeads.has(b)) return true
    }
    return false
  }

  /**
   * regex_gen.cpp:347 `Impl::Safe`:六條否決,順序照 C++:
   *   ① 可見命中有未勾 ② ambient 索引 ③ hidden 索引命中未勾 ④ 名稱接縫
   *   ⑤ 不含數值字元 → 安全(字面索引已完整)⑥ 寬鬆比對:numbered 可見 → ambient(有數值時)→ numberedHidden
   */
  private safe (tok: Token, key: string, hits: readonly number[], isSelected: readonly boolean[]): boolean {
    for (const h of hits) if (!isSelected[h]) return false
    if (this.ambientIndex.has(key)) return false
    const hi = this.hiddenIndex.get(key)
    if (hi) for (const h of hi) if (!isSelected[h]) return false
    if (this.joinsName(tok)) return false
    if (!hasAnyOf(tok.body, kNumChars)) return true
    for (const i of this.numbered) {
      if (isSelected[i]) continue
      if (binarySearch(hits, i)) continue
      if (mayMatch(this.prepped[i], tok)) return false
    }
    if (this.ambient.hasNumber && mayMatch(this.ambient, tok)) return false
    for (const i of this.numberedHidden) {
      if (isSelected[i]) continue
      if (mayMatch(this.hidden[i], tok)) return false
    }
    return true
  }

  /** regex_gen.cpp:383 `Corpus::Reset`:建三份索引(可見 / 隱藏 / ambient)與名稱接縫集合 */
  reset (entries: Entry[], ambient: Ambient = {}, opt: Options = {}): void {
    this.entries = entries
    this.opt = {
      maxTokenChars: Math.max(1, opt.maxTokenChars ?? 12),
      anchors: opt.anchors ?? true
    }
    this.buildMemo = new Map()
    this.prepped = []
    this.hidden = []
    this.index = new Map()
    this.hiddenIndex = new Map()
    this.ambientIndex = new Set()
    this.numbered = []
    this.numberedHidden = []
    this.leftTails = new Set()
    this.rightHeads = new Set()
    this.leftFull = new Set()
    this.rightFull = new Set()
    for (const e of entries) {
      this.prepped.push(prep(e.texts))
      this.hidden.push(prep(e.hidden))
    }
    const { maxTokenChars, anchors } = this.opt
    for (let i = 0; i < this.prepped.length; i++) {
      if (this.prepped[i].hasNumber) this.numbered.push(i)
      const seen = new Set<string>()
      forEachToken(this.prepped[i], maxTokenChars, anchors, t => {
        const k = tokenKey(t)
        if (seen.has(k)) return
        seen.add(k)
        const v = this.index.get(k)
        if (v) v.push(i)
        else this.index.set(k, [i])
      })
    }
    // 隱藏文字索引:只收「也出現在可見 index」的鍵。safe() 與 build() 只拿候選 token(一定來自可見文字、必在 index 內)查它,
    // 不在 index 的鍵永遠不會被讀到;PoE1 gem_names 頁因此從約 30 萬鍵縮到約 1,400 鍵。必須在可見 index 全部建完後才建。
    for (let i = 0; i < this.hidden.length; i++) {
      if (this.hidden[i].hasNumber) this.numberedHidden.push(i)
      const seenHidden = new Set<string>()
      forEachToken(this.hidden[i], maxTokenChars, anchors, t => {
        const k = tokenKey(t)
        if (!this.index.has(k) || seenHidden.has(k)) return
        seenHidden.add(k)
        const v = this.hiddenIndex.get(k)
        if (v) v.push(i)
        else this.hiddenIndex.set(k, [i])
      })
    }
    this.ambient = prep(ambient.lines)
    forEachToken(this.ambient, maxTokenChars, anchors, t => { this.ambientIndex.add(tokenKey(t)) })
    const sides = (words: readonly string[] | undefined, left: boolean): void => {
      for (const raw of words ?? []) {
        const s = fold(raw)
        if (s.length === 0) continue
        ;(left ? this.leftFull : this.rightFull).add(s)
        const off = charOffsets(s)
        const nc = off.length - 1
        for (let k = 1; k <= nc && k <= maxTokenChars; k++) {
          if (left) this.leftTails.add(s.slice(off[nc - k]))
          else this.rightHeads.add(s.slice(0, off[k]))
        }
      }
    }
    sides(ambient.nameLeft, true)
    sides(ambient.nameRight, false)
  }

  /**
   * regex_gen.cpp:445 `Corpus::Build`。
   * any/none:貪婪加權集合覆蓋,分數 = 新覆蓋勾選數 ÷ (字數+1),平手先字數再碼點序;
   * all:每項一段,只命中自己(可見命中恰為自己、hidden 命中只能是自己)。
   */
  build (selected: readonly number[], mode: Mode): Result {
    const r: Result = { query: '', length: 0, usedTokens: [], unresolved: [], exact: true }
    const n = this.entries.length
    if (selected.length === 0 || n === 0) return r

    const isSelected = new Array<boolean>(n).fill(false)
    const picks: number[] = []
    for (const i of selected) {
      if (!Number.isInteger(i) || i < 0 || i >= n || isSelected[i]) continue
      isSelected[i] = true
      picks.push(i)
    }
    picks.sort((a, b) => a - b)
    if (picks.length === 0) return r

    const memoKey = `${mode}|${picks.join(',')}`
    const memo = this.buildMemo.get(memoKey)
    if (memo) return cloneResult(memo)
    const out = this.buildUncached(picks, isSelected, mode)
    this.buildMemo.set(memoKey, out)
    if (this.buildMemo.size > 8) this.buildMemo.delete(this.buildMemo.keys().next().value as string)
    return cloneResult(out)
  }

  private buildUncached (picks: readonly number[], isSelected: readonly boolean[], mode: Mode): Result {
    const r: Result = { query: '', length: 0, usedTokens: [], unresolved: [], exact: true }
    const n = this.entries.length
    const { maxTokenChars, anchors } = this.opt
    const proposed = new Set<string>()
    const cands: Candidate[] = []
    for (const s of picks) {
      forEachToken(this.prepped[s], maxTokenChars, anchors, t => {
        const key = tokenKey(t)
        if (proposed.has(key)) return
        proposed.add(key)
        const hits = this.index.get(key)
        if (!hits) return // C++:「cannot happen; cheap to survive」
        if (!this.safe(t, key, hits, isSelected)) return
        cands.push({ tok: t, rendered: render(t), hits, hiddenHits: this.hiddenIndex.get(key) ?? null, cost: tokenChars(t) + 1 })
      })
    }

    if (mode === 'all') {
      for (const s of picks) {
        let best: Candidate | null = null
        for (const c of cands) {
          if (c.hits.length !== 1 || c.hits[0] !== s) continue
          if (c.hiddenHits && c.hiddenHits.some(h => h !== s)) continue
          if (!best || c.cost < best.cost || (c.cost === best.cost && lessCodePoint(c.rendered, best.rendered))) best = c
        }
        if (best) r.usedTokens.push(best.rendered)
        else r.unresolved.push(s)
      }
      r.query = r.usedTokens.map(quoteIfNeeded).join(' ')
    } else {
      const done = new Array<boolean>(n).fill(false)
      let left = picks.length
      while (left > 0) {
        let best: Candidate | null = null
        let bestScore = 0
        for (const c of cands) {
          let fresh = 0
          for (const h of c.hits) if (isSelected[h] && !done[h]) fresh++
          if (fresh === 0) continue
          const score = fresh / c.cost
          if (!best || score > bestScore ||
            (score === bestScore && (c.cost < best.cost ||
              (c.cost === best.cost && lessCodePoint(c.rendered, best.rendered))))) {
            best = c
            bestScore = score
          }
        }
        if (!best) break
        r.usedTokens.push(best.rendered)
        for (const h of best.hits) {
          if (isSelected[h] && !done[h]) { done[h] = true; left-- }
        }
      }
      for (const s of picks) if (!done[s]) r.unresolved.push(s)
      const alt = r.usedTokens.join('|')
      if (alt.length) r.query = `"${mode === 'none' ? '!' : ''}${alt}"`
    }

    r.length = charCount(r.query)
    r.exact = r.unresolved.length === 0
    return r
  }

  /**
   * regex_gen.cpp:554 `Corpus::Verify`:重新讀「要貼進遊戲的字串」算它選到什麼。
   * definite 只看可見文字(判漏),possible 看可見 + hidden(判多);ambient / 名稱接縫另列。
   */
  verify (selected: readonly number[], query: string): Check {
    const n = this.entries.length
    const chk: Check = { ok: false, missing: [], extra: [], ambient: [] }
    const want = new Array<boolean>(n).fill(false)
    for (const i of selected) if (Number.isInteger(i) && i >= 0 && i < n) want[i] = true

    const terms = splitTerms(query)
    if (terms.length === 0) {
      for (let i = 0; i < n; i++) if (want[i]) chk.missing.push(i)
      chk.ok = chk.missing.length === 0
      return chk
    }

    const definite = new Array<boolean>(n).fill(false)
    const possible = new Array<boolean>(n).fill(false)
    for (const term of terms) {
      const alts = parseAlternation(term)
      for (let e = 0; e < n; e++) {
        for (const t of alts) {
          if (alwaysMatches(this.prepped[e], t)) definite[e] = true
          if (mayMatch(this.prepped[e], t) || mayMatch(this.hidden[e], t)) possible[e] = true
        }
      }
      for (const t of alts) {
        if (mayMatch(this.ambient, t) || this.joinsName(t)) chk.ambient.push(render(t))
      }
    }
    for (let e = 0; e < n; e++) {
      if (want[e] && !definite[e]) chk.missing.push(e)
      if (!want[e] && possible[e]) chk.extra.push(e)
    }
    chk.ok = chk.missing.length === 0 && chk.extra.length === 0 && chk.ambient.length === 0
    return chk
  }
}
