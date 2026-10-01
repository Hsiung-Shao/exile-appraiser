/**
 * exile-appraiser(WP-S):揭露面板 OCR 的**零依賴**文字工具(正規化 / skeleton / Levenshtein / 共用門檻)。
 *
 * 從 `ocr-match.ts` 抽出,讓兩邊共用同一份規則:
 * - renderer 的完整比對(`ocr-match.ts`,需要 tiers 資料 + parser);
 * - main process 的面板定位(`ocr-locate.ts` ← `main/src/ocr/locate-data.ts`,esbuild 打包進 main.js)。
 * 本檔只准 import 零依賴模組(相對路徑,不用 `@/` 別名 —— main 的 esbuild 沒有那個別名)。
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

export function normalizeOcrText(s: string): string {
  const t = s
    .replace(/[\s　]+/g, "")
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const numeric = (c: string | undefined) => c != null && /[0-9%.]/.test(c);
  return t.replace(/[OoIl|]/g, (c, i: number, str: string) =>
    numeric(str[i - 1]) || numeric(str[i + 1]) ? (c === "O" || c === "o" ? "0" : "1") : c,
  );
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
export function templateSkeleton(template: string): { skeleton: string; slots: Array<"dyn" | number> } {
  const slots: Array<"dyn" | number> = [];
  // `[+-]?#`:少數模板自帶正負號(`擲彈技能有+#次冷卻使用次數`),OCR 端的 `+1` 整段被數值 regex 吃掉,這裡要一致
  const re = new RegExp(`[+-]?#|${STAT_VALUE_RE.source}`, "g");
  const skeleton = normalizeOcrText(template).replace(re, (m: string) => {
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
export function fuzzyLengthPossible(L: number, m: number): boolean {
  const d = Math.abs(L - m);
  if (d > FUZZY_MAX_LEN_DIFF) return false;
  return 1 - d / Math.max(L, m, 1) >= FUZZY_MIN_SIM - EPS;
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

  constructor(items: readonly T[], keyOf: (t: T) => string) {
    this.items = items;
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
    for (let m = Math.max(0, L - FUZZY_MAX_LEN_DIFF); m <= L + FUZZY_MAX_LEN_DIFF; m++) {
      if (!fuzzyLengthPossible(L, m)) continue;
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
