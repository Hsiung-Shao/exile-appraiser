/**
 * exile-appraiser(WP-R2 §2):符文塑形面板「列格式解析」與「面板定位」的**零依賴**純函式。
 *
 * main(`main/src/ocr/runeshape-scan.ts` 的自動定位 / 快取失效,esbuild 打包)與 renderer(`match.ts` 名稱比對)共用同一份規則;
 * 本檔只准以相對路徑 import 零依賴模組(`../desecration/ocr-text`),不用 `@/` 別名。
 *
 * 列格式(2026-09-30 兩張繁中截圖確認,見 docs/runeshape.md):文字靠右對齊、左邊是符文圖示、列高一致。
 *   - `1x 遠古控制符文`、`3x 富豪石`:前綴數量 `Nx`(OCR 常把 `1x` 讀成 `lx` / `Ix` / `1 ×`)
 *   - `技能等級 20：傳導符文`:技能寶石 + 寶石等級(OCR 偶爾漏掉「級」:`技能等 20:`)
 *   - `技能：排斥`、`輔助：震盪符文`:技能 / 輔助寶石
 *   - `1x 奇術熔劑（等級18）`:名稱後綴等級(全形 / 半形括號、可能有空白)
 *   - `維里西姆堆`:沒有前綴
 * 全形冒號 / 括號由 `normalizeOcrText` 轉半形;OCR 的字間空白一律刪掉。
 */
import { CJK, normalizeOcrText, type OcrTextLine } from "../desecration/ocr-text";

export type RuneRowKind = "gem" | "skill" | "support" | "item";

export interface ParsedRuneRow {
  /** `gem` = `技能等級N:`、`skill` = `技能:`、`support` = `輔助:`、`item` = 其他(含 `Nx`) */
  kind: RuneRowKind;
  /** 名稱(正規化後,去掉前綴 / 數量 / 等級後綴 / 頭尾雜訊) */
  name: string;
  /** 名稱 + `(等級N)`(= items.ndjson 帶等級名稱正規化後的樣子);沒有等級後綴 = name */
  fullName: string;
  /** `Nx` 的 N;沒有 = 1 */
  quantity: number;
  /** 名稱後綴 `(等級N)` 的 N */
  level?: number;
  /** `技能等級N:` 的 N */
  gemLevel?: number;
  /** 有可辨識的前綴(`Nx` / `技能等級N:` / `技能:` / `輔助:`) */
  prefixed: boolean;
}

const CJK_CLASS = "㐀-鿿";
/** 開頭的雜訊(OCR 把圖示邊框讀成「…」「I」之類) */
const LEAD_JUNK = new RegExp(`^[^${CJK_CLASS}0-9lI|]+`);
/** 結尾的雜訊:非 CJK 且不是 `)`(右緣別的工具畫的數字、`,`、`1`),以及 OCR 把框線讀成的「丨」 */
const TAIL_JUNK = new RegExp(`(?:[^${CJK_CLASS})]|丨)+$`);
const TAIL_JUNK_KEEP_DIGITS = new RegExp(`(?:[^${CJK_CLASS})0-9]|丨)+$`);
/** `Nx`:1–3 位數(l / I / | 當 1),後面必須緊接 CJK(避免英文 `Ix…` 被當數量) */
const QTY_RE = new RegExp(`^([0-9lI|]{1,3})[xX×](?=[${CJK_CLASS}])`);
/** `技能等級N:`(容許 OCR 漏掉「等」或「級」);冒號半形後可能被讀成分號 */
const GEM_RE = /^技能等?級?(\d{1,2})[:;]/;
const SKILL_RE = /^技能[:;]/;
const SUPPORT_RE = /^輔助[:;]/;
/** 名稱後綴 `(等級N)`(右括號可能被 OCR 吃掉) */
const LEVEL_SUFFIX_RE = /\(等級(\d{1,2})\)?$/;

const toInt = (s: string) => Number(s.replace(/[lI|]/g, "1"));

export function parseRuneRow(text: string): ParsedRuneRow {
  let s = normalizeOcrText(text).replace(LEAD_JUNK, "");
  let kind: RuneRowKind = "item";
  let quantity = 1;
  let gemLevel: number | undefined;
  let prefixed = false;
  let m: RegExpExecArray | null;
  if ((m = QTY_RE.exec(s)) && toInt(m[1]) > 0) {
    quantity = toInt(m[1]);
    s = s.slice(m[0].length);
    prefixed = true;
  } else if ((m = GEM_RE.exec(s))) {
    kind = "gem";
    gemLevel = Number(m[1]);
    s = s.slice(m[0].length);
    prefixed = true;
  } else if ((m = SKILL_RE.exec(s))) {
    kind = "skill";
    s = s.slice(m[0].length);
    prefixed = true;
  } else if ((m = SUPPORT_RE.exec(s))) {
    kind = "support";
    s = s.slice(m[0].length);
    prefixed = true;
  }
  // 先只剝掉非數字的尾巴再找等級後綴(右括號被 OCR 吃掉時,數字就在最後);沒有等級後綴才連數字一起剝
  const s1 = s.replace(TAIL_JUNK_KEEP_DIGITS, "");
  let level: number | undefined;
  let name: string;
  const lv = LEVEL_SUFFIX_RE.exec(s1);
  if (lv) {
    level = Number(lv[1]);
    name = s1.slice(0, lv.index).replace(TAIL_JUNK, "");
  } else {
    name = s.replace(TAIL_JUNK, "");
  }
  const row: ParsedRuneRow = { kind, name, fullName: level != null ? `${name}(等級${level})` : name, quantity, prefixed };
  if (level != null) row.level = level;
  if (gemLevel != null) row.gemLevel = gemLevel;
  return row;
}

/** 面板列:有前綴、名稱至少 2 個 CJK 字(自動定位與「面板還在不在」都用這個判準) */
export function isPanelRow(text: string): boolean {
  const p = parseRuneRow(text);
  return p.prefixed && [...p.name].filter((c) => CJK.test(c)).length >= 2;
}

// ---------------- 自動定位 ----------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 至少這麼多列面板列才算找到面板 */
export const RUNE_LOCATE_MIN_ROWS = 2;
/** 同一面板的列:右緣(文字靠右對齊)與簇中位數差 ≤ 這麼多行高 */
export const RIGHT_ALIGN_LINES = 2.5;
/** 同一面板相鄰兩列的中心距 ≤ 這麼多行高(截圖列距約 2.8 行高;中間夾一列沒前綴的也要接得上) */
export const ROW_GAP_LINES = 6.5;
/** 外擴:右邊 0.6 行高(右緣外常有別的東西,例如別的工具畫的數字,不框進來) */
export const PAD_RIGHT_LINES = 0.6;
/** 外擴:左邊 max(框寬 × 0.5, 6 行高)(較長的名稱會往左延伸;左邊是符文圖示) */
export const PAD_LEFT_RATIO = 0.5;
export const PAD_LEFT_LINES = 6;
/** 外擴:上下各半個列距(蓋住第一 / 最後一列整列,不碰面板標題上方的東西) */
export const PAD_V_PITCH = 0.5;

const cy = (l: Rect) => l.y + l.h / 2;
const right = (l: Rect) => l.x + l.w;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function unionRect(rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface RunePanelLocation {
  /** 被採用那一簇的面板列 */
  rows: OcrTextLine[];
  /** rows 的外框 */
  box: Rect;
  /** 中位行高 */
  lineH: number;
  /** 中位列距(中心距);只有 1 個間距時就是它 */
  pitch: number;
  /** 外擴後的裁切框(夾在 bounds 內、整數像素) */
  crop: Rect;
  /** 各簇列數(除錯用) */
  clusters: number[];
}

/**
 * 在 OCR 行(任意座標單位,通常是整個 client ×1)裡找符文塑形面板:
 * 面板列(`isPanelRow`)依 y 排序,右緣對齊且相鄰中心距夠近的歸成一簇;取列數最多的一簇(≥ `RUNE_LOCATE_MIN_ROWS`,同數取先出現的);
 * 外框依行高 / 列距外擴後夾進 bounds。找不到回 null。
 */
export function locateRunePanel(lines: OcrTextLine[], bounds: Rect): RunePanelLocation | null {
  const rows = lines.filter((l) => isPanelRow(l.text)).sort((a, b) => cy(a) - cy(b) || a.x - b.x);
  if (rows.length < RUNE_LOCATE_MIN_ROWS) return null;
  const lineH = median(rows.map((l) => l.h)) || 1;
  const clusters: OcrTextLine[][] = [];
  for (const l of rows) {
    const c = clusters.find((g) => {
      const last = g[g.length - 1];
      return (
        cy(l) - cy(last) <= ROW_GAP_LINES * lineH &&
        Math.abs(right(l) - median(g.map(right))) <= RIGHT_ALIGN_LINES * lineH
      );
    });
    if (c) c.push(l);
    else clusters.push([l]);
  }
  let best: OcrTextLine[] | null = null;
  for (const g of clusters) if (g.length >= RUNE_LOCATE_MIN_ROWS && (!best || g.length > best.length)) best = g;
  if (!best) return null;
  const box = unionRect(best);
  const gaps = best.slice(1).map((l, i) => cy(l) - cy(best![i]));
  const pitch = median(gaps) || 2.5 * lineH;
  const padL = Math.max(PAD_LEFT_RATIO * box.w, PAD_LEFT_LINES * lineH);
  const padR = PAD_RIGHT_LINES * lineH;
  const padV = PAD_V_PITCH * pitch;
  const x0 = Math.max(bounds.x, Math.floor(box.x - padL));
  const y0 = Math.max(bounds.y, Math.floor(box.y - padV));
  const x1 = Math.min(bounds.x + bounds.w, Math.ceil(box.x + box.w + padR));
  const y1 = Math.min(bounds.y + bounds.h, Math.ceil(box.y + box.h + padV));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { rows: best, box, lineH, pitch, crop: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, clusters: clusters.map((g) => g.length) };
}

/**
 * WinRT OCR 偶爾把整塊面板當成**直書**(實測:整張 611×727 截圖 ×2 / ×3 時,每「欄」字變成一行、行高數百像素);
 * 裁掉面板上方無關的東西後同一塊 ×3 就正常。判準:≥ 3 個 CJK 字且高 ≥ 2.5 倍寬的行有 2 行以上
 * (或有 1 行且沒有任何正常的 CJK 行)。
 */
export function looksVertical(lines: OcrTextLine[]): boolean {
  let vertical = 0;
  let horizontal = 0;
  for (const l of lines) {
    const n = [...l.text].filter((c) => CJK.test(c)).length;
    if (!n) continue;
    if (n >= 3 && l.h >= 2.5 * l.w) vertical++;
    else horizontal++;
  }
  return vertical >= 2 || (vertical === 1 && horizontal === 0);
}
