/**
 * exile-appraiser(2026-10-01 褻瀆誤判修正):一簇「像詞綴」的行**是不是**靈魂之井揭露面板 —— 否決規則(docs/reveal-ocr.md「面板判定:否決規則」)。
 *
 * 使用者回報:沒開揭露面板時,背包物品的進階詞綴說明(每條詞綴上方有「前綴 / 後綴詞綴」標頭)被當成面板,疊出好幾枚徽章。
 * 只看「≥ 2 行像詞綴且分成 ≥ 2 組」擋不住:tiers.json 的模板含一般池 1,483 條,物品浮窗的詞綴本來就像詞綴;標頭行把詞綴撐開成每行一組。
 * 這裡收集面板**不會有**、物品浮窗**會有**的特徵,任一條成立就否決:
 *   1. `tooltip-header`:**至少 2 行**「浮窗詞綴標頭」形狀的未命中行(`MIN_TOOLTIP_HEADERS`)。標頭 = x 對齊、對不上模板的 CJK 行,
 *      緊貼在**下一條**命中行上方(≤ 分組門檻 1.9 × 行高),且**上一條**命中行也在分組門檻內、或上方根本沒有命中行
 *      (浮窗的詞綴一條接一條、每條上方一行標頭:上一條詞綴 → 標頭 ≈ 1.4 ×、標頭 → 詞綴 ≈ 1.25 ×)。
 *      2026-10-02 code review 第 A 批改:舊版「離任一相鄰命中行 ≤ 1.9 ×、一行就否決」會誤殺真面板裡認錯的一行 ——
 *      某選項第 2 行認錯(離上一行 ~1.5 ×、離下一個選項 ≥ 2.31 ×)、某選項第 1 行認錯(真實 body-armour-01 ×1:
 *      `增加25。/。護甲值和因` 離上一個選項 2.55 ×、離同選項下一行 1.17 ×)。前者不貼下一條、後者離上一條超過分組門檻 → 都不是標頭形狀;
 *      3 行選項的中間行 / 第 1 個選項的第 1 行認錯仍是標頭形狀,所以要 ≥ 2 行才否決(一個面板同時認錯兩行這種位置才會誤殺)。
 *      看起來像詞綴數值的行(帶 `%` 或 `+數字`,= OCR 認錯一兩個字的詞綴)不算標頭。
 *   2. `keyword-line`:命中框附近(上下各 6 × 行高、左右各 2 × 行高)有對不上模板的行含「前綴 / 後綴 / 詞綴 / 階級 / 物品等級」、
 *      或屬性格式的冒號(`護甲值: 103`、`需求: 等級 80`);「需求 / 品質」只在沒有 `%` 時算(模板有 `減少#%能力值需求`、`#%至全部技能的品質`)。
 *   3. `too-many-groups` / `group-too-tall`:組數 > 3 或任一組 > 3 行(面板最多 3 個選項;一個褻瀆詞綴最多 3 行,tiers.json parts ≤ 3)。
 *      2026-10-02 code review 第 A 批:分兩層 —— 挑窗前的原始段 / 簇先過 `rawRunVeto`(> 4 組、或一塊連續 > 3 行且語意切成 > 3 段
 *      = 明顯是浮窗);> 3 組的段再挑連續 3 組(`panelWindows` / renderer 依分數),**只對挑中的 3 組**套 `panelVeto`
 *      (真面板旁 6 × 行高內多一條像詞綴的雜行時,不再整段否決)。
 *      組 = 依 y 間距切的幾何組(`shapeGroups`,折行合併算一行);中間夾著一行「像詞綴數值、只是沒認出」的行而緊貼兩邊的相鄰組
 *      視為同一個選項(`glueGroups`,那行算進行數)。renderer(`ocr-match.ts`)另給 `splitCount`:> 3 行的組改算語意切段數
 *      (保留「門檻失準時幾何組 4 行再由語意切開」的容錯;物品浮窗連續 6 行仍會被切成 6 段 → 否決)。
 * 面板固定元素(「確認」按鈕、「靈魂之井」標題)**只加分**(`panelAnchorScore`,renderer 挑面板時用),不當必要條件。
 *
 * 三張真實正樣本(`fixtures/ocr/well-of-souls-*.ocr.json`)量測:組內行距 1.50–1.54 × 行高、組間 2.31–4.64 ×;組數 3、每組 1–3 行;
 * 命中框附近沒有任何冒號 / 關鍵字行(最近的非詞綴行是「確認」,在最後一行下方 3.9 × 行高);詞綴行之間沒有夾任何未命中行 → 三條規則都不觸發。
 *
 * 零依賴(只 import `ocr-text.ts`):main 經 esbuild 打包使用,只准相對路徑。座標單位由呼叫端決定(同一套即可)。
 *
 * 2026-10-02 第 22 步:英文客戶端(`lang: "en"`)。規則相同,只換「這行算不算文字」(兩個連續拉丁字母)、正規化(`normalizeOcrTextEn`)
 * 與關鍵字:`prefix` / `suffix` / `modifier` / `tier` / `item level`(正規化後 `itemlevel`)、軟關鍵字 `requires` / `quality`(沒有 `%` 才算;
 * 模板有 `#% to Quality of all Skills`);冒號同繁中(`Requires: Level 70`、`Quality: +20%`)。tiers.json 英文 670 個寫法(`text.en` + `enVariants`)
 * 都不含前 5 個關鍵字與冒號。加分:`Confirm`、`The Well of Souls`(比對 `wellofsoul`,OCR 偶爾把結尾讀成 `SOULR`)。
 * 省略 `lang` = 繁中(改版前的行為,逐位元不變)。
 */
import {
  ALIGN_RATIO,
  CJK,
  GROUP_GAP_RATIO,
  LATIN_WORD,
  PANEL_GAP_RATIO,
  hasLangText,
  normalizeOcrText,
  normalizeOcrTextEn,
  normalizeOcrTextFor,
  type OcrTextLang,
  type OcrTextLine,
} from "./ocr-text";

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
/**
 * 挑窗前的原始段 / 簇最多幾組(超過 = 明顯是浮窗,整段否決):面板 3 組 + 旁邊多一條像詞綴的雜行。
 * 負樣本:合成 C(稀有裝備 5 條有空隙)5 組、B(進階說明標頭)5 組;真實 tooltip-gloves ×3 是一塊連續 4 行(另由「連續 > 3 段」擋)。
 */
export const MAX_RAW_GROUPS = MAX_PANEL_GROUPS + 1;
/** `tooltip-header` 至少要幾行標頭形狀的未命中行才否決(一行可能是真面板某選項第 1 行 / 中間行認錯) */
export const MIN_TOOLTIP_HEADERS = 2;
/** 關鍵字否決行的範圍:命中框上下各這麼多行高(= 面板組距上限) */
export const VETO_NEAR_Y_RATIO = PANEL_GAP_RATIO;
/** 關鍵字否決行的範圍:命中框左右各這麼多行高(聊天訊息 / 背包字離面板更遠) */
export const VETO_NEAR_X_RATIO = 2;

/** 浮窗才有的字(面板與 tiers.json 模板都沒有) */
export const VETO_KEYWORDS = ["前綴", "後綴", "詞綴", "階級", "物品等級"] as const;
/** 浮窗屬性行常見、但詞綴模板也有的字:只在不像詞綴數值(沒有 `%`)時算 */
export const VETO_SOFT_KEYWORDS = ["需求", "品質"] as const;
/** 英文版(第 22 步;比對 `normalizeOcrTextEn` 之後的字串 = 小寫、沒有空白) */
export const VETO_KEYWORDS_EN = ["prefix", "suffix", "modifier", "tier", "itemlevel"] as const;
export const VETO_SOFT_KEYWORDS_EN = ["requires", "quality"] as const;
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
export function vetoLineReason(text: string, lang: OcrTextLang = "zh"): "colon" | "keyword" | null {
  if (lang === "en") {
    const e = normalizeOcrTextEn(text);
    if (!LATIN_WORD.test(e)) return null;
    if (COLON_RE.test(e)) return "colon";
    if (VETO_KEYWORDS_EN.some((k) => e.includes(k))) return "keyword";
    if (!e.includes("%") && VETO_SOFT_KEYWORDS_EN.some((k) => e.includes(k))) return "keyword";
    return null;
  }
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
function modValueLike(u: OcrTextLine, lang: OcrTextLang = "zh"): boolean {
  return MOD_VALUE_RE.test(normalizeOcrTextFor(u.text, lang)) && !vetoLineReason(u.text, lang);
}

/**
 * 幾何組 + 「黏合」:相鄰兩組之間夾著一行像詞綴數值的未命中行(認錯字的詞綴),離上一組最後一行與下一組第一行都 ≤ 分組門檻、x 對齊
 * → 兩組其實是同一個選項(3 行詞綴中間那行沒認出),併成一組,那行算進組的行數。
 */
export function glueGroups(
  groups: ShapeLine[][],
  free: OcrTextLine[],
  lineH: number,
  lang: OcrTextLang = "zh",
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
          modValueLike(u, lang),
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

/** 一簇命中行的「幾何組 + 黏合」(`panelVeto` / `rawRunVeto` / `panelWindows` 共用;`free` = 含 CJK 的未命中行) */
export function panelGroups(
  hits: ShapeLine[],
  others: OcrTextLine[],
  lang: OcrTextLang = "zh",
): { lineH: number; free: OcrTextLine[]; groups: Array<{ hits: ShapeLine[]; glue: OcrTextLine[] }> } {
  const lineH = shapeLineH(hits);
  const free = lang === "en" ? others.filter((u) => hasLangText(u.text, lang)) : others.filter((u) => CJK.test(u.text));
  return { lineH, free, groups: glueGroups(shapeGroups(hits, lineH), free, lineH, lang) };
}

export interface PanelVetoOptions {
  /**
   * renderer:超過 3 行的組改算「這些命中行被語意切成幾段」(門檻失準把相鄰選項併成一個幾何組時的容錯);
   * 省略(main)= 該組 > 3 行就 `group-too-tall`。
   */
  splitCount?: (hits: ShapeLine[]) => number;
  /** 第 22 步:OCR 文字語言(省略 = 繁中) */
  lang?: OcrTextLang;
}

/**
 * 一簇命中行(`hits`,可含折行合併的行)是不是浮窗;`others` = 同一次 OCR 裡**對不上模板**的行(含不含 CJK 都可,這裡只看含 CJK 的)。
 * 組 = `shapeGroups` 的幾何組再 `glueGroups`。不否決回 null。
 */
export function panelVeto(hits: ShapeLine[], others: OcrTextLine[], opts: PanelVetoOptions = {}): PanelVeto | null {
  if (!hits.length) return null;
  const lang = opts.lang ?? "zh";
  const { lineH, free, groups: glued } = panelGroups(hits, others, lang);
  // 3. 組數 / 每組行數
  let groups = 0;
  let maxLines = 0;
  for (const g of glued) {
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
    if (vetoLineReason(u.text, lang)) return { kind: "keyword-line", detail: u.text };
  }
  // 1. 浮窗的詞綴標頭:緊貼下一條命中行上方、上一條命中行也緊貼(或上方沒有命中行)、x 對齊的未命中行 ≥ 2 行
  const headers = tooltipHeaders(hits, free, lineH, lang);
  if (headers.length >= MIN_TOOLTIP_HEADERS) return { kind: "tooltip-header", detail: headers[0].text };
  return null;
}

/**
 * 「浮窗詞綴標頭」形狀的未命中行(依 y 排序):緊貼**下一條**命中行上方(中心距 ≤ 分組門檻 1.9 × 行高),
 * 且**上一條**命中行也在分組門檻內、或它上方沒有命中行;x 與下一條(或上一條)對齊;不像詞綴數值。
 * 門檻依據(三張正樣本 ×3):組內行距 1.50–1.54 ×、組間 2.31–4.64 ×,1.9 介於兩者之間 ——
 * 上一條命中行超過 1.9 × = 它是上一個選項 → 這行是某選項認錯的第 1 行,不是標頭(真實 body-armour-01 ×1 的 2.55 ×)。
 * 合併過的行(折行)以靠近對方的那一半為中心(同 `shapeGroups`)。
 */
export function tooltipHeaders(
  hits: ShapeLine[],
  free: OcrTextLine[],
  lineH = shapeLineH(hits),
  lang: OcrTextLang = "zh",
): OcrTextLine[] {
  const sorted = [...hits].sort((a, b) => cy(a) - cy(b));
  const gap = GROUP_GAP_RATIO * lineH;
  const top = (l: ShapeLine) => (l.merged ? l.y + lineH / 2 : cy(l));
  const bottom = (l: ShapeLine) => (l.merged ? l.y + l.h - lineH / 2 : cy(l));
  const out: OcrTextLine[] = [];
  for (const u of free) {
    const c = cy(u);
    const i = sorted.findIndex((l) => top(l) > c);
    if (i < 0) continue; // 下方沒有命中行
    const b = sorted[i];
    if (top(b) - c > gap) continue;
    const a = i > 0 ? sorted[i - 1] : null;
    if (a) {
      const d = c - bottom(a);
      if (d <= 0 || d > gap) continue;
    }
    if (!xAligned(u, b, lineH) && !(a && xAligned(u, a, lineH))) continue;
    if (modValueLike(u, lang)) continue;
    out.push(u);
  }
  return out.sort((p, q) => cy(p) - cy(q));
}

/**
 * 挑窗**之前**的否決(code review 第 A 批):原始段 / 簇明顯是浮窗 → 整段否決,不再挑 3 組。
 * - 任一組(幾何組 + 黏合)> 3 行:有 `splitCount`(renderer)時改算語意段數,> 3 段(一塊連續 4+ 行各自是一條詞綴,
 *   真實 tooltip-gloves ×3 的 4 行、合成 C' 的 6 行)→ `too-many-groups`;沒有(main)→ `group-too-tall`(與 `panelVeto` 相同)。
 * - 總組數 > `MAX_RAW_GROUPS`(4)→ `too-many-groups`(合成 B / C 都是 5 組;面板 3 組 + 1 條雜行 = 4 組不擋,交給挑窗)。
 * 關鍵字 / 標頭規則**不在這裡**:只對挑中的 3 組套(`panelVeto`),段裡遠處的雜行不連累面板。
 */
export function rawRunVeto(hits: ShapeLine[], others: OcrTextLine[], opts: PanelVetoOptions = {}): PanelVeto | null {
  if (!hits.length) return null;
  const { groups: glued } = panelGroups(hits, others, opts.lang ?? "zh");
  let groups = 0;
  for (const g of glued) {
    const n = g.hits.length + g.glue.length;
    if (n <= MAX_GROUP_LINES) {
      groups++;
      continue;
    }
    if (!opts.splitCount) return { kind: "group-too-tall", detail: `${n} 行` };
    const k = opts.splitCount(g.hits);
    if (k > MAX_PANEL_GROUPS) return { kind: "too-many-groups", detail: `連續 ${n} 行切成 ${k} 段` };
    groups += k;
  }
  if (groups > MAX_RAW_GROUPS) return { kind: "too-many-groups", detail: `${groups} 組` };
  return null;
}

/**
 * main(`ocr-locate.ts` `findPanelHits`)用:一簇命中行 → 可採用的命中行;否決回 `{ veto }`。
 * 先 `rawRunVeto`;≤ 3 組 → 整簇 `panelVeto`(與改版前相同);4 組 → 每個連續 3 組的視窗各自 `panelVeto`,
 * 採用**所有沒被否決的視窗**的聯集(main 只負責框裁切範圍,寧可框大;挑面板是 renderer 的事),全被否決回第一個原因。
 */
export function panelWindows(
  hits: ShapeLine[],
  others: OcrTextLine[],
  lang: OcrTextLang = "zh",
): { hits: ShapeLine[] } | { veto: PanelVeto } {
  const opts: PanelVetoOptions = { lang };
  const raw = rawRunVeto(hits, others, opts);
  if (raw) return { veto: raw };
  const { groups } = panelGroups(hits, others, lang);
  if (groups.length <= MAX_PANEL_GROUPS) {
    const v = panelVeto(hits, others, opts);
    return v ? { veto: v } : { hits };
  }
  const kept = new Set<ShapeLine>();
  let first: PanelVeto | null = null;
  for (let i = 0; i + MAX_PANEL_GROUPS <= groups.length; i++) {
    const win = groups.slice(i, i + MAX_PANEL_GROUPS).flatMap((g) => g.hits);
    const v = panelVeto(win, others, opts);
    if (v) first ??= v;
    else for (const l of win) kept.add(l);
  }
  if (!kept.size) return { veto: first! };
  return { hits: hits.filter((l) => kept.has(l)) };
}

/**
 * 面板固定元素加分(不是必要條件):命中框正下方(≤ 面板組距上限)x 對齊的「確認」按鈕 +1、
 * 上方 20 個行高內 x 對齊的「靈魂之井」標題(OCR 常掉第一個字:`魂之井`)+1。
 * 英文(第 22 步):`Confirm`、`The Well of Souls`(GGPK clientstrings `UnveilingWindowConfirmButton` / `UnveilingUITitle`;比對 `wellofsoul`;上方 24 個行高內)。
 */
export function panelAnchorScore(hits: ShapeLine[], others: OcrTextLine[], lang: OcrTextLang = "zh"): number {
  if (!hits.length) return 0;
  const confirm = lang === "en" ? "confirm" : "確認";
  const title = lang === "en" ? "wellofsoul" : "魂之井";
  // 標題在命中框上方幾個行高內:繁中 20(改版前);英文 24 —— 英文截圖 well-of-souls-weapon-en-04 實測標題在 20.2 個行高外
  // (英文詞綴字比繁中小、中間隔著物品圖)
  const titleLines = lang === "en" ? 24 : 20;
  const lineH = shapeLineH(hits);
  const box = unionBox(hits);
  const bcx = box.x + box.w / 2;
  let score = 0;
  const aligned = (u: OcrTextLine) => Math.abs(cx(u) - bcx) <= ALIGN_RATIO * lineH;
  if (
    others.some((u) => {
      const d = cy(u) - (box.y + box.h);
      return normalizeOcrTextFor(u.text, lang) === confirm && d > 0 && d <= PANEL_GAP_RATIO * lineH && aligned(u);
    })
  ) {
    score++;
  }
  if (
    others.some((u) => {
      const d = box.y - cy(u);
      return normalizeOcrTextFor(u.text, lang).includes(title) && d > 0 && d <= titleLines * lineH && aligned(u);
    })
  ) {
    score++;
  }
  return score;
}
