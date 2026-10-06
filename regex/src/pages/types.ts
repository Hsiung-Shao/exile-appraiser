// 演算法頁(schema 2 `kind: 'numeric' | 'sockets'`)的型別。
//
// 對外形狀與語料頁(mods)一致:`RegexPage` + `entries: RegexEntry[]`,所以清單、勾選、書籤、分享碼都能共用;
// 差別只在每個項目多了 `input`(數值 / 選項)與 `fragment()`:演算法頁**不經 Corpus 覆蓋演算法**,
// 片段由程式直接組出,視為使用者確定的 term(combine.ts 對它們只做「會不會誤中其他頁詞綴」的檢查)。
import type { RegexEntry, RegexLang, RegexPage } from '../data'

export type AlgoKind = 'numeric' | 'sockets'

/** 數值條件:≥ / ≤ / 區間 */
export type RangeOp = 'ge' | 'le' | 'range'

/**
 * 一個演算法項目的輸入值(分享碼的 `numeric:{pageId:{entryId: AlgoValue}}`)。
 * range:min / max(缺 = 無界;兩者都有 = 區間);select / colors:choice;count:choice(顏色)+ min(數量)。
 */
export interface AlgoValue {
  min?: number
  max?: number
  choice?: string
}

export interface AlgoOption {
  id: string
  zh: string
  en: string
}

export type AlgoInput =
  | { kind: 'range', digits: 1 | 2 | 3, percent: boolean, ops: RangeOp[], lo: number, hi: number, def: AlgoValue }
  | { kind: 'select', options: AlgoOption[], def: AlgoValue }
  /** 鏈接顏色:choice = 顏色字母串(r / g / b),例如 "rgb"、"rrg";總數 2…maxTotal */
  | { kind: 'colors', maxTotal: number, def: AlgoValue }
  /** 插槽顏色數:choice = 顏色(r / g / b / w)、min = 至少幾個 */
  | { kind: 'count', options: AlgoOption[], lo: number, hi: number, def: AlgoValue }
  /**
   * 稀有度 | 汙染條件列(第 40 步,rarity.ts):稀有度可多選、汙染二選一(可都不選);
   * choice = 稀有度字母(n / m / r / u)+ 選填 `|u`(未汙染)/ `|c`(已汙染),舊單字 normal / magic / rare / unique 照讀
   */
  | { kind: 'rarity', options: AlgoOption[], corruption: AlgoOption[], def: AlgoValue }

export interface AlgoEntry extends RegexEntry {
  input: AlgoInput
  /** 片段對繁中客戶端的顯示假設尚未進遊戲實測(UI 標「待實測」) */
  untested?: boolean
  /** 產生片段;輸入不成立(例如空區間)回 null */
  fragment: (v: AlgoValue, lang: RegexLang) => string | null
  /**
   * 一列輸出多個 term(第 40 步條件列:稀有度、汙染各一個);有它時 combine 逐 term 加入,`fragment` 只是顯示用(以空白相連)。
   * 沒有任何 term = null(與 fragment 相同,當成輸入不成立)
   */
  terms?: (v: AlgoValue, lang: RegexLang) => string[] | null
  /**
   * 語料行(原文,含 `#`)本身就是這個項目要比對的對象 → combine 的 fragment 衝突檢查略過它(第 35 步:
   * 階級片段比對名稱「（階級 N）」,地圖詞綴頁的隱藏行收了魔法地圖名稱「堅定的地圖（階級#）」,中了是對的)
   */
  ownLine?: (line: string) => boolean
}

export interface AlgoPage extends RegexPage {
  kind: AlgoKind
  entries: AlgoEntry[]
  /**
   * 嵌入式數值區(第 32 步):宿主詞綴頁 id。有值 = 不出現在頁面下拉選單,顯示在宿主頁頂端、合併時緊接宿主頁
   * (見 ../sections.ts)。
   */
  sectionOf?: string
}

export function isAlgoPage (p: RegexPage | null | undefined): p is AlgoPage {
  return !!p && (p.kind === 'numeric' || p.kind === 'sockets')
}

/** 由 min / max 推 ≥ / ≤ / 區間;都沒有 = null(不成立) */
export function rangeOp (v: AlgoValue | undefined): RangeOp | null {
  if (!v) return null
  const hasMin = typeof v.min === 'number' && Number.isFinite(v.min)
  const hasMax = typeof v.max === 'number' && Number.isFinite(v.max)
  if (hasMin && hasMax) return 'range'
  if (hasMin) return 'ge'
  if (hasMax) return 'le'
  return null
}
