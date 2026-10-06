// 多頁合併:每頁各自 Build,再依遊戲搜尋列語法合成一串。
//
// 遊戲語法:空白 = AND(每個 term 都要中)、term 內 `|` = 任一、`!` 只作用於緊接的那一個 term、含空白的 term 用 `"…"` 包起來。
// 合成規則:
//   * 語料頁(mods / names)用面板的模式:any → 全部頁的 token 以 `|` 併成**一個** term;all → 每個 token 各一個 term;
//     none → 併進**唯一一個** `"!a|b|…"` term。
//   * 演算法頁(numeric / sockets)每個勾選各一個 term(同時成立;例:階級 ≥16 且 物品數量 ≥80);
//     第 40 步的稀有度 | 汙染條件列一個勾選可出兩個 term(`AlgoEntry.terms`),`!` 開頭的 term 加引號。
//   * 自訂文字:使用者輸入 → 正則跳脫 → 獨立 term(不驗證,標 unverified)。
//   * 排除詞:跳脫後併進 none 的那個 `!` term。
//   順序:any term、all terms、演算法 terms、自訂 terms、none term。只有一個語料頁時,結果與該頁 `Corpus.build().query` 逐字相同。
// 驗證:參與的語料頁 **corpus 聯集**(entries 與 ambient 都聯集)對「語料頁 token 組成的那部分」做 `Verify`
//   (跨頁誤中會以 extra 顯示);演算法片段不經 Corpus,只檢查會不會誤中聯集裡任一詞綴行(`#` 代入多個樣本值);
//   排除詞若命中已勾選的詞綴(any / all 模式)= 自相矛盾,也列為衝突。
import { charCount, Corpus, type Ambient, type Check, type Entry, type Mode } from './gen'
import { buildCorpus, entryLines, isCorpusPage, pageAmbient, type PageKind, type RegexLang, type RegexPage } from './data'
import { isAlgoPage, type AlgoValue } from './pages/types'

export interface CombineSel {
  page: RegexPage
  picks: readonly number[]
  /** 演算法頁:entryId → 值(沒給就用項目預設值) */
  values?: Readonly<Record<string, AlgoValue>>
}

export interface CombineInput {
  lang: RegexLang
  mode: Mode
  pages: readonly CombineSel[]
  custom?: readonly string[]
  excludes?: readonly string[]
}

export interface PageContribution {
  id: string
  kind: PageKind
  /** 勾選數 */
  picked: number
  /** 貢獻長度 = 各片段字數 + 每片段 1 個分隔字元(`|` 或空白);引號與 `!` 另計在總長 */
  length: number
  /** 無法單獨指定的勾選數(語料頁);演算法頁 = 輸入不成立的勾選數 */
  unresolved: number
  /** 這頁產生的片段(語料頁 = token、演算法頁 = term 內容) */
  fragments: string[]
}

export type ConflictKind = 'extra' | 'missing' | 'ambient' | 'fragment' | 'exclude' | 'invalid'

export interface Conflict {
  kind: ConflictKind
  /** 頁 id(fragment / invalid = 演算法頁;extra / missing / exclude = 被影響的語料頁) */
  page?: string
  /** 項目 id */
  entry?: string
  /** 顯示用:片段、行文字或 ambient token */
  text: string
}

export interface CombineResult {
  query: string
  length: number
  limit: number
  perPage: PageContribution[]
  custom: Array<{ text: string, term: string, unverified: true }>
  excludes: Array<{ text: string, token: string }>
  customLength: number
  excludesLength: number
  /**
   * 送進 Verify 的字串:只有語料頁 token 的那部分(any / all / none 同 gen.ts 寫法)。
   * 演算法片段與自訂文字不在內:Verify 把 term 當字面 token 讀,而片段裡的 `.` `-` 與數字在它的模型中是「可能是數值」的字元,
   * 放進去只會得到無意義的 extra;它們改用正則逐行檢查(fragment 衝突)。
   */
  verifyQuery: string
  /** 聯集 corpus 的 Verify(verifyQuery);沒有語料頁勾選時 ok=true、其餘空 */
  check: Check
  conflicts: Conflict[]
  ok: boolean
}

/** gen.ts `QuoteIfNeeded` 同規則 */
function quoteIfNeeded (term: string): string {
  // `!` 開頭 = 否定片段(第 40 步條件列「未汙染」):包引號讓 `!` 作用於整個 term
  return term.includes(' ') || term.startsWith('!') ? `"${term}"` : term
}

/** 使用者輸入 → 遊戲搜尋列的字面 term:去掉 `"`(term 界線)、跳脫正則語法、開頭的 `!` 也跳脫 */
export function escapeTerm (s: string): string {
  const t = s.replace(/"/g, '').trim().replace(/[\\^$.|?*+()[\]{}]/g, c => '\\' + c)
  return t.startsWith('!') ? '\\' + t : t
}

/** 合併的 Verify 字串(只有語料頁 token):any / all / none 三種寫法與 gen.ts build 相同 */
function modQuery (mode: Mode, tokens: string[]): string {
  if (!tokens.length) return ''
  if (mode === 'all') return tokens.map(quoteIfNeeded).join(' ')
  return `"${mode === 'none' ? '!' : ''}${tokens.join('|')}"`
}

// ---- 聯集 corpus(依頁物件與語言快取) ----
interface UnionCorpus {
  pages: RegexPage[]
  lang: RegexLang
  corpus: Corpus
  offsets: number[]
  /** 聯集索引 → [頁 id, 項目 id] */
  owner: Array<[string, string]>
}
const unionCache: UnionCorpus[] = []

function unionCorpus (pages: RegexPage[], lang: RegexLang): UnionCorpus {
  if (pages.length === 1) {
    const p = pages[0]
    return { pages, lang, corpus: buildCorpus(p, lang), offsets: [0], owner: p.entries.map(e => [p.id, e.id]) }
  }
  const hit = unionCache.find(u => u.lang === lang && u.pages.length === pages.length && u.pages.every((p, i) => p === pages[i]))
  if (hit) return hit
  const entries: Entry[] = []
  const owner: Array<[string, string]> = []
  const offsets: number[] = []
  const amb: Required<Ambient> = { lines: [], nameLeft: [], nameRight: [] }
  for (const p of pages) {
    offsets.push(entries.length)
    for (const d of p.entries) {
      const l = entryLines(d, lang)
      entries.push({ id: `${p.id}:${d.id}`, texts: l.texts, hidden: l.hidden })
      owner.push([p.id, d.id])
    }
    const a = pageAmbient(p, lang)
    amb.lines.push(...(a.lines ?? []))
    amb.nameLeft.push(...(a.nameLeft ?? []))
    amb.nameRight.push(...(a.nameRight ?? []))
  }
  const u: UnionCorpus = { pages, lang, corpus: new Corpus(entries, amb), offsets, owner }
  unionCache.unshift(u)
  if (unionCache.length > 4) unionCache.pop()
  return u
}

/** `#` 代入的樣本值:涵蓋 1–3 位數與常見百分比 */
const SAMPLES = ['1', '5', '10', '16', '20', '30', '50', '80', '100', '150', '300']

function instantiate (line: string): string[] {
  return line.includes('#') ? SAMPLES.map(s => line.replace(/#/g, s)) : [line]
}

function safeRegExp (src: string): RegExp | null {
  try { return new RegExp(src, 'i') } catch { return null }
}

export function combine (input: CombineInput): CombineResult {
  const { lang, mode } = input
  const anyTokens: string[] = []
  const allTerms: string[] = []
  const algoTerms: string[] = []
  const noneTokens: string[] = []
  const modTokens: string[] = []
  const perPage: PageContribution[] = []
  const conflicts: Conflict[] = []
  const corpusSels: CombineSel[] = []
  const corpusUnresolved: number[][] = []
  const algoFrags: Array<{ page: string, entry: string, frag: string, own?: (line: string) => boolean }> = []
  let limit = 250

  for (const sel of input.pages) {
    const picks = [...new Set(sel.picks)].filter(i => Number.isInteger(i) && i >= 0 && i < sel.page.entries.length).sort((a, b) => a - b)
    if (!picks.length) continue
    limit = Math.min(limit, sel.page.limit || 250)
    const kind: PageKind = sel.page.kind ?? 'mods'
    if (isAlgoPage(sel.page)) {
      const frags: string[] = []
      let bad = 0
      for (const i of picks) {
        const e = sel.page.entries[i]
        const v = sel.values?.[e.id] ?? e.input.def
        // 第 40 步:一列可以輸出多個 term(稀有度 | 汙染條件列),各自一個 AND term
        let ts: string[] | null
        if (e.terms) ts = e.terms(v, lang)
        else {
          const f = e.fragment(v, lang)
          ts = f ? [f] : null
        }
        if (!ts?.length) {
          bad++
          conflicts.push({ kind: 'invalid', page: sel.page.id, entry: e.id, text: e[lang][0] ?? e.id })
          continue
        }
        for (const f of ts) {
          frags.push(f)
          algoTerms.push(quoteIfNeeded(f))
          algoFrags.push({ page: sel.page.id, entry: e.id, frag: f, own: e.ownLine })
        }
      }
      perPage.push({
        id: sel.page.id, kind, picked: picks.length, unresolved: bad, fragments: frags,
        length: frags.reduce((n, f) => n + charCount(quoteIfNeeded(f)) + 1, 0)
      })
      continue
    }
    if (!isCorpusPage(sel.page)) continue
    const r = buildCorpus(sel.page, lang).build(picks, mode)
    corpusSels.push({ page: sel.page, picks })
    corpusUnresolved.push(r.unresolved)
    modTokens.push(...r.usedTokens)
    if (mode === 'any') anyTokens.push(...r.usedTokens)
    else if (mode === 'none') noneTokens.push(...r.usedTokens)
    else allTerms.push(...r.usedTokens.map(quoteIfNeeded))
    perPage.push({
      id: sel.page.id, kind, picked: picks.length, unresolved: r.unresolved.length, fragments: r.usedTokens,
      length: r.usedTokens.reduce((n, t) => n + charCount(mode === 'all' ? quoteIfNeeded(t) : t) + 1, 0)
    })
  }

  const custom = (input.custom ?? []).map(t => ({ text: t, term: escapeTerm(t), unverified: true as const })).filter(c => c.term)
  // 排除詞開頭的 `!` 也跳脫(否則第一個排除詞會與 none term 的 `!` 疊成 `!!`)
  const excludes = (input.excludes ?? []).map(t => ({ text: t, token: escapeTerm(t) })).filter(x => x.token)
  noneTokens.push(...excludes.map(x => x.token))

  const terms: string[] = []
  if (anyTokens.length) terms.push(`"${anyTokens.join('|')}"`)
  terms.push(...allTerms, ...algoTerms, ...custom.map(c => quoteIfNeeded(c.term)))
  if (noneTokens.length) terms.push(`"!${noneTokens.join('|')}"`)
  const query = terms.join(' ')

  // ---- 驗證 ----
  const verifyQuery = modQuery(mode, modTokens)
  let check: Check = { ok: true, missing: [], extra: [], ambient: [] }
  if (corpusSels.length) {
    const u = unionCorpus(corpusSels.map(s => s.page), lang)
    const selected: number[] = []
    corpusSels.forEach((s, k) => { for (const i of s.picks) selected.push(u.offsets[k] + i) })
    check = u.corpus.verify(selected, verifyQuery)
    const unresolvedSet = new Set<number>()
    corpusSels.forEach((s, k) => {
      for (const i of corpusUnresolved[k]) unresolvedSet.add(u.offsets[k] + i)
    })
    for (const i of check.extra) {
      const [page, entry] = u.owner[i]
      conflicts.push({ kind: 'extra', page, entry, text: u.corpus.at(i).texts[0] ?? entry })
    }
    for (const i of check.missing) {
      if (unresolvedSet.has(i)) continue
      const [page, entry] = u.owner[i]
      conflicts.push({ kind: 'missing', page, entry, text: u.corpus.at(i).texts[0] ?? entry })
    }
    for (const a of check.ambient) conflicts.push({ kind: 'ambient', text: a })

    // 演算法片段 / 排除詞 對聯集詞綴行
    // 只有真的要比對(有演算法片段,或非 none 模式有排除詞)才展開 lines
    let linesMemo: Array<{ idx: number, text: string, raw: string }> | null = null
    const getLines = (): Array<{ idx: number, text: string, raw: string }> => {
      if (linesMemo) return linesMemo
      const out: Array<{ idx: number, text: string, raw: string }> = []
      for (let i = 0; i < u.corpus.size(); i++) {
        const e = u.corpus.at(i)
        for (const l of [...e.texts, ...(e.hidden ?? [])]) for (const t of instantiate(l)) out.push({ idx: i, text: t, raw: l })
      }
      return (linesMemo = out)
    }
    for (const f of algoFrags) {
      // 否定片段(`!…`)不會「誤中」詞綴行
      if (f.frag.startsWith('!')) continue
      const re = safeRegExp(f.frag)
      if (!re) continue
      const hit = getLines().find(l => re.test(l.text) && !f.own?.(l.raw))
      if (hit) conflicts.push({ kind: 'fragment', page: f.page, entry: f.entry, text: `${f.frag} ⇐ ${hit.text}` })
    }
    if (mode !== 'none') {
      const picked = new Set(selected)
      for (const x of excludes) {
        const re = safeRegExp(x.token)
        if (!re) continue
        const hit = getLines().find(l => picked.has(l.idx) && re.test(l.text))
        if (hit) {
          const [page, entry] = u.owner[hit.idx]
          conflicts.push({ kind: 'exclude', page, entry, text: `${x.text} ⇐ ${hit.text}` })
        }
      }
    }
  }

  const length = charCount(query)
  return {
    query,
    length,
    limit,
    perPage,
    custom,
    excludes,
    verifyQuery,
    customLength: custom.reduce((n, c) => n + charCount(quoteIfNeeded(c.term)) + 1, 0),
    excludesLength: excludes.reduce((n, x) => n + charCount(x.token) + 1, 0),
    check,
    conflicts,
    ok: conflicts.length === 0 && check.missing.length === 0
  }
}
