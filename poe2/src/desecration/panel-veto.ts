/**
 * exile-appraiser(2026-10-01 褻瀆誤判修正):一簇「像詞綴」的行**是不是**靈魂之井揭露面板 —— 否決規則(docs/reveal-ocr.md「面板判定:否決規則」)。
 *
 * 使用者回報:沒開揭露面板時,背包物品的進階詞綴說明(每條詞綴上方有「前綴 / 後綴詞綴」標頭)被當成面板,疊出好幾枚徽章。
 * 只看「≥ 2 行像詞綴且分成 ≥ 2 組」擋不住:tiers.json 的模板含一般池 1,483 條,物品浮窗的詞綴本來就像詞綴;標頭行把詞綴撐開成每行一組。
 * 這裡收集面板**不會有**、物品浮窗**會有**的特徵,任一條成立就否決:
 *   1. `tooltip-header`:命中的詞綴行之間夾著 x 對齊、離相鄰命中行 ≤ 分組門檻(1.9 × 行高)、對不上模板的 CJK 行(浮窗的詞綴標頭)。
 *      面板選項之間的空隙 > 1.9 × 行高(那種行由 `ocr-match.ts` `bridgeUnmatched` 補成「中間沒認出的選項」,不在這條);
 *      看起來像詞綴數值的行(帶 `%` 或 `+數字`,= OCR 認錯一兩個字的詞綴)不算標頭(真面板裡某一行沒認出時不要誤殺)。
 *   2. `keyword-line`:命中框附近(上下各 6 × 行高、左右各 2 × 行高)有對不上模板的行含「前綴 / 後綴 / 詞綴 / 階級 / 物品等級」、
 *      或屬性格式的冒號(`護甲值: 103`、`需求: 等級 80`);「需求 / 品質」只在沒有 `%` 時算(模板有 `減少#%能力值需求`、`#%至全部技能的品質`)。
 *   3. `too-many-groups` / `group-too-tall`:組數 > 3 或任一組 > 3 行(面板最多 3 個選項;一個褻瀆詞綴最多 3 行,tiers.json parts ≤ 3)。
 *      組 = 依 y 間距切的幾何組(`shapeGroups`,折行合併算一行);中間夾著一行「像詞綴數值、只是沒認出」的行而緊貼兩邊的相鄰組
 *      視為同一個選項(`glueGroups`,那行算進行數)。renderer(`ocr-match.ts`)另給 `splitCount`:> 3 行的組改算語意切段數
 *      (保留「門檻失準時幾何組 4 行再由語意切開」的容錯;物品浮窗連續 6 行仍會被切成 6 段 → 否決)。
 * 面板固定元素(「確認」按鈕、「靈魂之井」標題)**只加分**(`panelAnchorScore`,renderer 挑面板時用),不當必要條件。
 *
 * 三張真實正樣本(`fixtures/ocr/well-of-souls-*.ocr.json`)量測:組內行距 1.50–1.54 × 行高、組間 2.31–4.64 ×;組數 3、每組 1–3 行;
 * 命中框附近沒有任何冒號 / 關鍵字行(最近的非詞綴行是「確認」,在最後一行下方 3.9 × 行高);詞綴行之間沒有夾任何未命中行 → 三條規則都不觸發。
 *
 * 零依賴(只 import `ocr-text.ts`):main 經 esbuild 打包使用,只准相對路徑。座標單位由呼叫端決定(同一套即可)。
 */
import { ALIGN_RATIO, CJK, GROUP_GAP_RATIO, PANEL_GAP_RATIO, normalizeOcrText, type OcrTextLine } from "./ocr-text";

/** 命中行;`merged` = 由兩行折行合併(實際佔兩行高) */
export interface ShapeLine extends OcrTextLine {
  merged?: boolean;
}

export type PanelVetoKind = "tooltip-header" | "keyword-line" | "too-many-groups" | "group-too-tall";

export interface PanelVeto {
  kind: PanelVetoKind;
  /** 觸發的那一行(log 用;組數 / 行數規則為 `n 組` / `n 行`) */
  detail: string;
}

/** 面板最多幾個選項 */
export const MAX_PANEL_GROUPS = 3;
/** 一個選項(褻瀆詞綴)最多幾行 */
export const MAX_GROUP_LINES = 3;
/** 關鍵字否決行的範圍:命中框上下各這麼多行高(= 面板組距上限) */
export const VETO_NEAR_Y_RATIO = PANEL_GAP_RATIO;
/** 關鍵字否決行的範圍:命中框左右各這麼多行高(聊天訊息 / 背包字離面板更遠) */
export const VETO_NEAR_X_RATIO = 2;

/** 浮窗才有的字(面板與 tiers.json 模板都沒有) */
export const VETO_KEYWORDS = ["前綴", "後綴", "詞綴", "階級", "物品等級"] as const;
/** 浮窗屬性行常見、但詞綴模板也有的字:只在不像詞綴數值(沒有 `%`)時算 */
export const VETO_SOFT_KEYWORDS = ["需求", "品質"] as const;
const COLON_RE = /[:：∶﹕]/;
/** 像詞綴的數值(`%`、`+數字`):這種未命中行是認錯字的詞綴,不當浮窗標頭 */
const MOD_VALUE_RE = /%|\+\d/;

const cy = (l: OcrTextLine) => l.y + l.h / 2;
const cx = (l: OcrTextLine) => l.x + l.w / 2;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 命中行的中位行高(合併過的行算半高) */
export function shapeLineH(hits: ShapeLine[]): number {
  return median(hits.map((l) => (l.merged ? l.h / 2 : l.h))) || 1;
}

/** 這行文字是不是浮窗才有的屬性 / 標頭行(冒號、關鍵字);不是回 null */
export function vetoLineReason(text: string): "colon" | "keyword" | null {
  const t = normalizeOcrText(text);
  if (!CJK.test(t)) return null;
  if (COLON_RE.test(t)) return "colon";
  if (VETO_KEYWORDS.some((k) => t.includes(k))) return "keyword";
  if (!t.includes("%") && VETO_SOFT_KEYWORDS.some((k) => t.includes(k))) return "keyword";
  return null;
}

/**
 * 依 y 間距切幾何組(相鄰中心距 > `GROUP_GAP_RATIO` × 行高 = 下一組;合併過的行以靠近對方的那一行為中心,同 `ocr-match.ts` `groupLines`)。
 * 不看 x(呼叫端的簇本來就是 x 對齊的)。
 */
export function shapeGroups(hits: ShapeLine[], lineH = shapeLineH(hits)): ShapeLine[][] {
  const sorted = [...hits].sort((a, b) => cy(a) - cy(b));
  if (!sorted.length) return [];
  const groups: ShapeLine[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevCy = prev.merged ? prev.y + prev.h - lineH / 2 : cy(prev);
    const curCy = cur.merged ? cur.y + lineH / 2 : cy(cur);
    if (curCy - prevCy > GROUP_GAP_RATIO * lineH) groups.push([cur]);
    else groups[groups.length - 1].push(cur);
  }
  return groups;
}

function unionBox(ls: OcrTextLine[]): { x: number; y: number; w: number; h: number } {
  const x0 = Math.min(...ls.map((r) => r.x));
  const y0 = Math.min(...ls.map((r) => r.y));
  const x1 = Math.max(...ls.map((r) => r.x + r.w));
  const y1 = Math.max(...ls.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** u 與 a 的 x 對齊:中心、左緣或右緣相差 ≤ ALIGN_RATIO × 行高 */
function xAligned(u: OcrTextLine, a: OcrTextLine, lineH: number): boolean {
  const tol = ALIGN_RATIO * lineH;
  return Math.abs(cx(u) - cx(a)) <= tol || Math.abs(u.x - a.x) <= tol || Math.abs(u.x + u.w - (a.x + a.w)) <= tol;
}

/** 像詞綴數值的未命中行(OCR 認錯字的詞綴):不當浮窗標頭;夾在兩組之間且緊貼兩邊時當成同一個選項的一行 */
function modValueLike(u: OcrTextLine): boolean {
  return MOD_VALUE_RE.test(normalizeOcrText(u.text)) && !vetoLineReason(u.text);
}

/**
 * 幾何組 + 「黏合」:相鄰兩組之間夾著一行像詞綴數值的未命中行(認錯字的詞綴),離上一組最後一行與下一組第一行都 ≤ 分組門檻、x 對齊
 * → 兩組其實是同一個選項(3 行詞綴中間那行沒認出),併成一組,那行算進組的行數。
 */
export function glueGroups(
  groups: ShapeLine[][],
  free: OcrTextLine[],
  lineH: number,
): Array<{ hits: ShapeLine[]; glue: OcrTextLine[] }> {
  const gap = GROUP_GAP_RATIO * lineH;
  const out: Array<{ hits: ShapeLine[]; glue: OcrTextLine[] }> = [];
  for (const g of groups) {
    const prev = out[out.length - 1];
    if (prev) {
      const a = prev.hits[prev.hits.length - 1];
      const b = g[0];
      const aCy = a.merged ? a.y + a.h - lineH / 2 : cy(a);
      const bCy = b.merged ? b.y + lineH / 2 : cy(b);
      const glue = free.filter(
        (u) =>
          cy(u) > aCy &&
          cy(u) < bCy &&
          cy(u) - aCy <= gap &&
          bCy - cy(u) <= gap &&
          (xAligned(u, a, lineH) || xAligned(u, b, lineH)) &&
          modValueLike(u),
      );
      if (glue.length) {
        prev.hits.push(...g);
        prev.glue.push(...glue);
        continue;
      }
    }
    out.push({ hits: [...g], glue: [] });
  }
  return out;
}

export interface PanelVetoOptions {
  /**
   * renderer:超過 3 行的組改算「這些命中行被語意切成幾段」(門檻失準把相鄰選項併成一個幾何組時的容錯);
   * 省略(main)= 該組 > 3 行就 `group-too-tall`。
   */
  splitCount?: (hits: ShapeLine[]) => number;
}

/**
 * 一簇命中行(`hits`,可含折行合併的行)是不是浮窗;`others` = 同一次 OCR 裡**對不上模板**的行(含不含 CJK 都可,這裡只看含 CJK 的)。
 * 組 = `shapeGroups` 的幾何組再 `glueGroups`。不否決回 null。
 */
export function panelVeto(hits: ShapeLine[], others: OcrTextLine[], opts: PanelVetoOptions = {}): PanelVeto | null {
  if (!hits.length) return null;
  const lineH = shapeLineH(hits);
  const free = others.filter((u) => CJK.test(u.text));
  // 3. 組數 / 每組行數
  let groups = 0;
  let maxLines = 0;
  for (const g of glueGroups(shapeGroups(hits, lineH), free, lineH)) {
    const n = g.hits.length + g.glue.length;
    if (n > MAX_GROUP_LINES && opts.splitCount) {
      groups += opts.splitCount(g.hits);
    } else {
      groups++;
      maxLines = Math.max(maxLines, n);
    }
  }
  if (maxLines > MAX_GROUP_LINES) return { kind: "group-too-tall", detail: `${maxLines} 行` };
  if (groups > MAX_PANEL_GROUPS) return { kind: "too-many-groups", detail: `${groups} 組` };

  // 2. 命中框附近的屬性 / 標頭行
  const box = unionBox(hits);
  const nearY = VETO_NEAR_Y_RATIO * lineH;
  const nearX = VETO_NEAR_X_RATIO * lineH;
  for (const u of free) {
    const c = cy(u);
    if (c < box.y - nearY || c > box.y + box.h + nearY) continue;
    if (u.x + u.w < box.x - nearX || u.x > box.x + box.w + nearX) continue;
    if (vetoLineReason(u.text)) return { kind: "keyword-line", detail: u.text };
  }
  // 1. 夾在相鄰兩條命中行之間、緊貼著(≤ 分組門檻)、x 對齊的未命中行 = 浮窗的詞綴標頭
  const sorted = [...hits].sort((a, b) => cy(a) - cy(b));
  const gap = GROUP_GAP_RATIO * lineH;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const aCy = a.merged ? a.y + a.h - lineH / 2 : cy(a);
    const bCy = b.merged ? b.y + lineH / 2 : cy(b);
    for (const u of free) {
      const c = cy(u);
      if (c <= aCy || c >= bCy) continue;
      if (Math.min(c - aCy, bCy - c) > gap) continue;
      if (!xAligned(u, a, lineH) && !xAligned(u, b, lineH)) continue;
      if (modValueLike(u)) continue;
      return { kind: "tooltip-header", detail: u.text };
    }
  }
  return null;
}

/**
 * 面板固定元素加分(不是必要條件):命中框正下方(≤ 面板組距上限)x 對齊的「確認」按鈕 +1、
 * 上方 20 個行高內 x 對齊的「靈魂之井」標題(OCR 常掉第一個字:`魂之井`)+1。
 */
export function panelAnchorScore(hits: ShapeLine[], others: OcrTextLine[]): number {
  if (!hits.length) return 0;
  const lineH = shapeLineH(hits);
  const box = unionBox(hits);
  const bcx = box.x + box.w / 2;
  let score = 0;
  const aligned = (u: OcrTextLine) => Math.abs(cx(u) - bcx) <= ALIGN_RATIO * lineH;
  if (
    others.some((u) => {
      const d = cy(u) - (box.y + box.h);
      return normalizeOcrText(u.text) === "確認" && d > 0 && d <= PANEL_GAP_RATIO * lineH && aligned(u);
    })
  ) {
    score++;
  }
  if (
    others.some((u) => {
      const d = box.y - cy(u);
      return normalizeOcrText(u.text).includes("魂之井") && d > 0 && d <= 20 * lineH && aligned(u);
    })
  ) {
    score++;
  }
  return score;
}
