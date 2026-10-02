/**
 * exile-appraiser(WP-S):揭露面板 OCR 的**零依賴**文字工具(正規化 / skeleton / Levenshtein / 共用門檻)。
 *
 * 從 `ocr-match.ts` 抽出,讓兩邊共用同一份規則:
 * - renderer 的完整比對(`ocr-match.ts`,需要 tiers 資料 + parser);
 * - main process 的面板定位(`ocr-locate.ts` ← `main/src/ocr/locate-data.ts`,esbuild 打包進 main.js)。
 * 本檔只准 import 零依賴模組(相對路徑,不用 `@/` 別名 —— main 的 esbuild 沒有那個別名)。
 *
 * 2026-10-02 第 22 步:英文客戶端(OCR 語言包 `en-US`)。繁中的函式**一字不改**(預設 = 繁中),英文另有一組:
 * `OcrTextLang`(`zh` / `en`)、`normalizeOcrTextEn`、`hasLangText`、`templateSkeleton(t, "en")`、`fuzzyRules("en")`。
 * 英文同樣以「字元」比對(正規化 = 刪空白 + 轉小寫):small caps 字體的 OCR 常把一個字切開或把兩個字黏起來(`Dam age`、`toFire`),
 * 以單字(token)為單位的比對對這種錯誤反而脆弱;只是長度差的上限改由相似度門檻本身推導(英文詞綴長 20–60 字,
 * 繁中的「長度差 ≤ 2」對英文太嚴),見 `fuzzyRules`。說明見 docs/reveal-ocr.md「英文客戶端」。
 */
import { STAT_VALUE_RE } from "../parser/stat-value-re";

/** 一行 OCR 結果(座標單位由呼叫端決定,x/y/w/h 同一套即可;main 送 client 實體像素) */
export interface OcrTextLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const EPS = 1e-6;
/** 組內 / 組間的分界(中心距 ÷ 中位行高) */
export const GROUP_GAP_RATIO = 1.9;
/** 面板各組之間的最大中心距(÷ 中位行高) */
export const PANEL_GAP_RATIO = 6;
/** 行中心 x 與組中心 x 的最大差(÷ 中位行高) */
export const ALIGN_RATIO = 4;
export const FUZZY_MIN_SIM = 0.85;
export const FUZZY_MAX_LEN_DIFF = 2;

export const CJK = /[㐀-鿿]/;

/** OCR 文字語言(第 22 步):`zh` = 繁中客戶端(語言包 zh-Hant-TW)、`en` = 英文客戶端(en-US)。省略 = `zh`(改版前的行為) */
export type OcrTextLang = "zh" | "en";

/** WinRT OCR 語言標記 → 文字語言(`en-US` / `en-GB`… → en,其他 → zh) */
export function ocrTextLangOf(tag: string | null | undefined): OcrTextLang {
  return tag != null && /^en(?:-|$)/i.test(tag) ? "en" : "zh";
}

/** 英文行至少要有兩個連續拉丁字母(數字 / 符號 / 圖示雜訊不算) */
export const LATIN_WORD = /[A-Za-z]{2}/;

/** 這行有沒有該語言的文字(繁中 = 含 CJK;英文 = 含兩個連續拉丁字母) */
export function hasLangText(s: string, lang: OcrTextLang = "zh"): boolean {
  return lang === "en" ? LATIN_WORD.test(s) : CJK.test(s);
}

export function normalizeOcrText(s: string): string {
  const t = s
    .replace(/[\s　]+/g, "")
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const numeric = (c: string | undefined) => c != null && /[0-9%.]/.test(c);
  return t.replace(/[OoIl|]/g, (c, i: number, str: string) =>
    numeric(str[i - 1]) || numeric(str[i + 1]) ? (c === "O" || c === "o" ? "0" : "1") : c,
  );
}

const isLetter = (c: string | undefined) => c != null && /[A-Za-z]/.test(c);

/**
 * 英文 OCR 行的正規化(第 22 步;繁中用 `normalizeOcrText`,兩者互不影響):
 * 1. 全形 ASCII → 半形;彎引號 / 各種破折號 → `'` / `-`。
 * 2. 數字旁的 `O/o` → `0`、`l/I/|` → `1` —— **另一邊不能是字母**(`to45` 的 o、`Level 19` 的 l 不動;繁中沒有這個問題,所以規則不同);
 *    在刪空白**之前**做,字與數字之間原本的空白還在。
 * 3. 夾在兩個字母之間的 `0` → `o`、`1` / `|` → `l`(`Physica1 Damage` 這類 small caps 誤讀)。
 * 4. 刪所有空白與 `'`(`Thrud's` 常被讀成 `Thrud s` / `Thruds`),轉小寫。
 * 模板(`text.en`、items.ndjson 的英文名)走同一個函式,兩邊一致。
 */
export function normalizeOcrTextEn(s: string): string {
  let t = s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[‐‑‒–—−]/g, "-");
  const numeric = (c: string | undefined) => c != null && /[0-9%.]/.test(c);
  t = t.replace(/[OoIl|]/g, (c, i: number, str: string) => {
    const a = str[i - 1];
    const b = str[i + 1];
    return (numeric(a) && !isLetter(b)) || (numeric(b) && !isLetter(a)) ? (c === "O" || c === "o" ? "0" : "1") : c;
  });
  t = t.replace(/[01|]/g, (c, i: number, str: string) =>
    isLetter(str[i - 1]) && isLetter(str[i + 1]) ? (c === "0" ? "o" : "l") : c,
  );
  return t.replace(/[\s　']+/g, "").toLowerCase();
}

/** 依語言正規化(`zh` = `normalizeOcrText`,逐字不變) */
export function normalizeOcrTextFor(s: string, lang: OcrTextLang = "zh"): string {
  return lang === "en" ? normalizeOcrTextEn(s) : normalizeOcrText(s);
}

function valueRe(): RegExp {
  return new RegExp(STAT_VALUE_RE.source, "g");
}

/** OCR 行:數值 → `#`,回傳 skeleton 與數值(絕對值) */
export function ocrSkeleton(norm: string): { skeleton: string; values: number[] } {
  const values: number[] = [];
  const skeleton = norm.replace(valueRe(), (m: string) => {
    values.push(Math.abs(parseFloat(m)));
    return "#";
  });
  return { skeleton, values };
}

/** 模板:`#` 與寫死的數字都 → `#`,記住每個槽的來源 */
export function templateSkeleton(
  template: string,
  lang: OcrTextLang = "zh",
): { skeleton: string; slots: Array<"dyn" | number> } {
  const slots: Array<"dyn" | number> = [];
  // `[+-]?#`:少數模板自帶正負號(`擲彈技能有+#次冷卻使用次數`),OCR 端的 `+1` 整段被數值 regex 吃掉,這裡要一致
  const re = new RegExp(`[+-]?#|${STAT_VALUE_RE.source}`, "g");
  const skeleton = normalizeOcrTextFor(template, lang).replace(re, (m: string) => {
    slots.push(m.endsWith("#") ? "dyn" : Math.abs(parseFloat(m)));
    return "#";
  });
  return { skeleton, slots };
}

/** 依碼點切開(與 `[...s]` 同一種切法:代理對算一個字) */
export function codePoints(s: string): string[] {
  return [...s];
}

// 效能修正第 8 步:Levenshtein 的兩列緩衝重複使用(不每列新建陣列)。函式不遞迴、不呼叫外部程式碼 → 單執行緒下不會重入;
// 迴圈內只用區域變數 prev / cur 指向的那兩塊,擴容只影響之後的呼叫。
let levRowA = new Int32Array(64);
let levRowB = new Int32Array(64);

/** 已切成碼點的 Levenshtein(結果與 `levenshtein(a, b)` 相同) */
export function levenshteinCp(A: readonly string[], B: readonly string[]): number {
  const n = B.length;
  if (levRowA.length < n + 1) {
    levRowA = new Int32Array(n + 1);
    levRowB = new Int32Array(n + 1);
  }
  let prev = levRowA;
  let cur = levRowB;
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= A.length; i++) {
    cur[0] = i;
    const ai = A[i - 1];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ai === B[j - 1] ? 0 : 1));
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[n];
}

export function levenshtein(a: string, b: string): number {
  return levenshteinCp(codePoints(a), codePoints(b));
}

/** skeleton 模糊相似度(1 = 相同);長度差 > FUZZY_MAX_LEN_DIFF 回 0(不值得算) */
export function skeletonSimilarity(a: string, b: string): number {
  const A = codePoints(a);
  const B = codePoints(b);
  if (Math.abs(A.length - B.length) > FUZZY_MAX_LEN_DIFF) return 0;
  return 1 - levenshteinCp(A, B) / Math.max(A.length, B.length, 1);
}

/**
 * 效能修正第 8 步:長度剪枝。查詢長度 L、候選長度 m 時相似度的上界:
 * Levenshtein ≥ d = |L − m|,且 `1 − x / M` 對 x 單調遞減(同一個 M 下浮點除法也單調)→ `sim ≤ 1 − d / M`,M = max(L, m, 1)。
 * 上界都達不到門檻(或 d > FUZZY_MAX_LEN_DIFF)的長度,原本的比對一定以「低於門檻」跳過 → 不必算,結果不變。
 * 用與比對處**同一個浮點運算式**判定(不手寫常數);換算:d = 0 恆可、d = 1 要 M ≥ 7、d = 2 要 M ≥ 14。
 * (`matchLine` 的分母寫成 max(L, m):呼叫時 L ≥ 1(skeleton 含 CJK 字),與 max(L, m, 1) 相同。)
 */
export function fuzzyLengthPossible(L: number, m: number, rules: FuzzyRules = ZH_FUZZY): boolean {
  const d = Math.abs(L - m);
  if (d > rules.maxLenDiff) return false;
  return 1 - d / Math.max(L, m, 1) >= rules.minSim - EPS;
}

/** 模糊比對的門檻:相似度下限 + 長度差上限 */
export interface FuzzyRules {
  minSim: number;
  maxLenDiff: number;
}

/** 繁中(改版前的門檻,逐位元不變) */
export const ZH_FUZZY: FuzzyRules = { minSim: FUZZY_MIN_SIM, maxLenDiff: FUZZY_MAX_LEN_DIFF };
/**
 * 英文(第 22 步):相似度下限同繁中 0.85(字元層級;英文正規化刪了空白、轉小寫),**不另設長度差上限** ——
 * 長度差 d 本身就受 `1 − d / max(L, m) ≥ 0.85` 約束(≈ 長度的 15%;30 字的詞綴容許差 5 字),
 * 繁中的「≤ 2」是給 5–15 字的 CJK 模板用的,英文詞綴 20–60 字,small caps 漏 / 多一個字母、兩字黏在一起就超過。
 * 數字(數值)不參與相似度:skeleton 已把數值換成 `#`;符文名稱另有「數字必須相同」。
 * 量測(data/poe2/desecration 英文 670 個寫法 → skeleton 兩兩比較)見 docs/reveal-ocr.md「英文客戶端」。
 */
export const EN_FUZZY: FuzzyRules = { minSim: FUZZY_MIN_SIM, maxLenDiff: Number.POSITIVE_INFINITY };

export function fuzzyRules(lang: OcrTextLang = "zh"): FuzzyRules {
  return lang === "en" ? EN_FUZZY : ZH_FUZZY;
}

/** 依規則的相似度(長度差超過上限回 0;`zh` = `skeletonSimilarity`) */
export function similarityWith(a: string, b: string, rules: FuzzyRules = ZH_FUZZY): number {
  const A = codePoints(a);
  const B = codePoints(b);
  if (Math.abs(A.length - B.length) > rules.maxLenDiff) return 0;
  return 1 - levenshteinCp(A, B) / Math.max(A.length, B.length, 1);
}

/**
 * 模糊比對的候選表:依碼點長度分桶,`candidates(L)` 回傳可能達門檻的候選**索引,遞增排序 = 原本的遍歷順序**
 * (「取最高分、同分依出現順序」的語意因此與全掃相同)。碼點陣列預先切好(`cps[i]`)。資料建好後不可再改。
 */
export class FuzzyCandidates<T> {
  readonly items: readonly T[];
  readonly cps: string[][];
  private readonly byLen = new Map<number, number[]>();
  private readonly memo = new Map<number, number[]>();
  readonly rules: FuzzyRules;

  constructor(items: readonly T[], keyOf: (t: T) => string, rules: FuzzyRules = ZH_FUZZY) {
    this.items = items;
    this.rules = rules;
    this.cps = items.map((t) => codePoints(keyOf(t)));
    this.cps.forEach((cp, i) => {
      const b = this.byLen.get(cp.length);
      if (b) b.push(i);
      else this.byLen.set(cp.length, [i]);
    });
  }

  candidates(L: number): number[] {
    let out = this.memo.get(L);
    if (out) return out;
    out = [];
    // 長度差上限:規則給的(繁中 2),或由相似度門檻推得的上界(英文:d ≤ (1 − minSim) × max(L, m),m ≤ L / minSim)
    const span = Number.isFinite(this.rules.maxLenDiff) ? this.rules.maxLenDiff : Math.ceil(L / this.rules.minSim) + 1;
    for (let m = Math.max(0, L - span); m <= L + span; m++) {
      if (!fuzzyLengthPossible(L, m, this.rules)) continue;
      const b = this.byLen.get(m);
      if (b) out.push(...b);
    }
    out.sort((a, b) => a - b);
    this.memo.set(L, out);
    return out;
  }
}

/** 模糊比對結果快取上限(每個索引各一份) */
export const FUZZY_CACHE_MAX = 2000;

/** 有上限的 LRU(Map 插入順序 = 新舊;讀到就移到最新)。值可以是 null / false,用 `has` 判斷有沒有 */
export class Lru<K, V> {
  private readonly map = new Map<K, V>();
  constructor(readonly max: number = FUZZY_CACHE_MAX) {}

  has(k: K): boolean {
    return this.map.has(k);
  }

  get(k: K): V | undefined {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k) as V;
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }

  set(k: K, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    else if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as K);
    this.map.set(k, v);
  }

  get size(): number {
    return this.map.size;
  }
}
