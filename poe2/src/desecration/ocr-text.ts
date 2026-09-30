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

export function levenshtein(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[B.length];
}

/** skeleton 模糊相似度(1 = 相同);長度差 > FUZZY_MAX_LEN_DIFF 回 0(不值得算) */
export function skeletonSimilarity(a: string, b: string): number {
  const la = [...a].length;
  const lb = [...b].length;
  if (Math.abs(la - lb) > FUZZY_MAX_LEN_DIFF) return 0;
  return 1 - levenshtein(a, b) / Math.max(la, lb, 1);
}
