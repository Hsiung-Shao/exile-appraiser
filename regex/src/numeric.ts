// 數值範圍 → 遊戲搜尋列用的最短正則片段(自寫;不參考 poe.re,poe.re 無 LICENSE)。
//
//   rangeRegex({ min: 16 }, { digits: 2 })          → "(1[6-9]|[2-9]\d)"
//   rangeRegex({ max: 5 }, { digits: 1 })           → "[0-5]"
//   rangeRegex({ min: 0, max: 50 }, { digits: 3 })  → "([1-4]?\d|50)"
//
// 語意:片段「整段」比對一個不帶前導零的十進位整數字串 N(`String(N)`),N 在定義域 0 … 10^digits − 1 內,
// 且 min ≤ N ≤ max(缺 min = 0、缺 max = 定義域上限)。前後界(`%`、`$`、非數字字元)由呼叫端加;
// 測試(regex/test/numeric.test.ts)對 0–999 每個 N 以 `new RegExp('^(?:' + 片段 + ')$')` 逐值比對。
//
// 做法:依位數切成數段等長區間 → 每段用「共同前綴 + 首位分頭尾中三段」遞迴拆成數字字元類的序列 →
//   ① 兩位數以上的首位 `[1-9]` 換成 `\d`(遊戲印出的數字沒有前導零,整段比對下兩者等價)
//   ② 若 Q = X + P(X 是單一字元類、P 是另一個候選)→ 合併成 `X?P`(例:`\d|[1-4]\d` → `[1-4]?\d`)
// 只用 `\d`、`[…]`、`?`、`|`、`()`(不用 `{n}`:少一個語法依賴,長度也只差 1)。

export interface NumRange {
  min?: number
  max?: number
}

export interface NumOptions {
  /** 定義域的最大位數:1 → 0–9、2 → 0–99、3 → 0–999 */
  digits: 1 | 2 | 3
}

/** 一個字元類:數字 lo…hi;opt = 後面帶 `?` */
interface Atom {
  lo: number
  hi: number
  opt: boolean
}

type Pattern = Atom[]

export function domainMax (digits: number): number {
  return Math.pow(10, digits) - 1
}

/** 正規化成整數閉區間;空集合回 null */
export function normalizeRange (r: NumRange, o: NumOptions): [number, number] | null {
  const top = domainMax(o.digits)
  const lo = Math.max(0, Math.ceil(r.min ?? 0))
  const hi = Math.min(top, Math.floor(r.max ?? top))
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return null
  return [lo, hi]
}

function atom (lo: number, hi: number = lo): Atom {
  return { lo, hi, opt: false }
}
const D = (): Atom => atom(0, 9)

/** 等長十進位字串區間 [a, b](a ≤ b)→ 候選序列 */
function sameLength (a: string, b: string): Pattern[] {
  const n = a.length
  if (n === 0) return [[]]
  const a0 = Number(a[0])
  const b0 = Number(b[0])
  const ra = a.slice(1)
  const rb = b.slice(1)
  if (a0 === b0) return sameLength(ra, rb).map(p => [atom(a0), ...p])
  const zeros = '0'.repeat(n - 1)
  const nines = '9'.repeat(n - 1)
  const out: Pattern[] = []
  let lo = a0
  let hi = b0
  if (ra !== zeros) {
    out.push(...sameLength(ra, nines).map(p => [atom(a0), ...p]))
    lo++
  }
  let tail: Pattern[] = []
  if (rb !== nines) {
    tail = sameLength(zeros, rb).map(p => [atom(b0), ...p])
    hi--
  }
  if (lo <= hi) out.push([atom(lo, hi), ...Array.from({ length: n - 1 }, D)])
  out.push(...tail)
  return out
}

function renderAtom (x: Atom): string {
  let s: string
  if (x.lo === 0 && x.hi === 9) s = '\\d'
  else if (x.lo === x.hi) s = String(x.lo)
  else if (x.hi === x.lo + 1) s = `[${x.lo}${x.hi}]`
  else s = `[${x.lo}-${x.hi}]`
  return x.opt ? s + '?' : s
}

function renderPattern (p: Pattern): string {
  return p.map(renderAtom).join('')
}

function atomEq (x: Atom, y: Atom): boolean {
  return x.lo === y.lo && x.hi === y.hi && x.opt === y.opt
}

function patternEq (p: Pattern, q: Pattern): boolean {
  return p.length === q.length && p.every((x, i) => atomEq(x, q[i]))
}

/** ② 合併 `P` 與 `X P` → `X?P`,直到不能再合 */
function mergeOptional (list: Pattern[]): Pattern[] {
  const out = list.slice()
  let changed = true
  while (changed) {
    changed = false
    outer:
    for (let i = 0; i < out.length; i++) {
      for (let j = 0; j < out.length; j++) {
        if (i === j) continue
        const p = out[i]
        const q = out[j]
        if (q.length !== p.length + 1 || q[0].opt) continue
        if (!patternEq(q.slice(1), p)) continue
        const merged: Pattern = [{ ...q[0], opt: true }, ...p]
        // 保持原本順序:合併結果放在較短者的位置
        out[i] = merged
        out.splice(j, 1)
        changed = true
        break outer
      }
    }
  }
  return out
}

function joinAlternatives (parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `(${parts.join('|')})`
}

/**
 * 最短(啟發式)正則片段。空集合回空字串(呼叫端當「條件不成立 / 無效輸入」)。
 * 回傳值若含 `|` 一定已包在 `(…)` 內,可直接嵌進更長的 term。
 */
export function rangeRegex (r: NumRange, o: NumOptions): string {
  const span = normalizeRange(r, o)
  if (!span) return ''
  const [lo, hi] = span
  const pats: Pattern[] = []
  for (let len = 1; len <= o.digits; len++) {
    const first = len === 1 ? 0 : Math.pow(10, len - 1)
    const last = Math.pow(10, len) - 1
    const a = Math.max(lo, first)
    const b = Math.min(hi, last)
    if (a > b) continue
    for (const p of sameLength(String(a), String(b))) {
      // ① 首位 [1-9] → \d(len ≥ 2)
      if (len >= 2 && p[0].lo === 1 && p[0].hi === 9) p[0] = D()
      pats.push(p)
    }
  }
  const built = joinAlternatives(mergeOptional(pats).map(renderPattern))
  // 很窄的跨位數區間(例 8–10)逐一列舉反而較短
  const naive = naiveRangeRegex(r, o)
  return naive.length < built.length ? naive : built
}

/** 樸素寫法(逐一列舉),測試用來比長度 */
export function naiveRangeRegex (r: NumRange, o: NumOptions): string {
  const span = normalizeRange(r, o)
  if (!span) return ''
  const nums: string[] = []
  for (let n = span[0]; n <= span[1]; n++) nums.push(String(n))
  return joinAlternatives(nums)
}
