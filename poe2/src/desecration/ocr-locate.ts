/**
 * exile-appraiser(WP-S 兩段式):揭露面板「定位」—— 在低倍率(×1)的整張 OCR 結果裡找出**對得上褻瀆詞綴模板**的行,
 * 算出面板所在的裁切框,第 2 段只把那一塊 ×3 送 OCR(docs/reveal-ocr.md「兩段式辨識」)。
 *
 * - 純函式、零依賴(只 import `ocr-text.ts` 與型別),main process 經 esbuild 打包使用(`main/src/ocr/locate-data.ts`);
 *   poe2 vitest 直接測(`test/desecration/ocr-locate.test.ts`)。
 * - 命中規則與 renderer 的 `matchLine` 同一套 skeleton(精確 / Levenshtein ≥ 0.85 且長度差 ≤ 2),但**只回答「像不像詞綴」**:
 *   不看數值範圍、不分 entry、不推 Tier(那些仍在 renderer 的 `matchReveal`)。
 * - 座標單位由呼叫端決定(main 用擷取影像的實體像素)。
 * - 2026-10-01:每一簇命中行再過 `panel-veto.ts` 的否決規則(物品浮窗的詞綴標頭 / 屬性行 / 組數或行數太多),被否決的簇不採用
 *   (使用者回報背包物品的進階詞綴說明被當成揭露面板)。
 * - 2026-10-02 code review 第 A 批:與 renderer `selectPanel` 一致化 —— 簇先過 `rawRunVeto`(明顯是浮窗才整簇否決),
 *   4 組的簇再對每個連續 3 組的視窗各自套否決(`panelWindows`),真面板旁多一條像詞綴的雜行時不整簇丟掉。
 * - 2026-10-02 第 22 步:英文客戶端 —— `buildLocateIndex(tiers, "en")` 改收 `text.en` + `text.enVariants`,索引帶 `lang: "en"`,
 *   之後所有函式依索引的語言走英文的正規化 / 文字判定 / 模糊門檻(`ocr-text.ts` `EN_FUZZY`)/ 否決關鍵字;繁中索引沒有 `lang`(行為逐位元不變)。
 */
import {
  ALIGN_RATIO,
  CJK,
  FUZZY_MIN_SIM,
  EPS,
  FuzzyCandidates,
  GROUP_GAP_RATIO,
  LATIN_WORD,
  Lru,
  PANEL_GAP_RATIO,
  codePoints,
  fuzzyRules,
  hasLangText,
  levenshteinCp,
  normalizeOcrText,
  normalizeOcrTextEn,
  ocrSkeleton,
  templateSkeleton,
  type OcrTextLang,
  type OcrTextLine,
} from "./ocr-text";
import { panelWindows, type PanelVeto, type ShapeLine } from "./panel-veto";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LocateIndex {
  set: Set<string>;
  list: string[];
  /** 第 22 步:英文索引才有(`"en"`);沒有 = 繁中 */
  lang?: "en";
}

/** tiers.json 最小形狀(main 端只 JSON.parse,不引入完整型別);`en` / `enVariants` 是英文客戶端用的(schema 2 才有 enVariants) */
export interface LocateTiersLike {
  entries: Array<{
    parts: Array<{
      text: { zh: string; zhVariants?: Array<{ text: string }>; en?: string; enVariants?: Array<{ text: string }> };
    }>;
  }>;
}

const idxLang = (idx: LocateIndex): OcrTextLang => idx.lang ?? "zh";

/**
 * 從 tiers.json 取模板 skeleton(排除規則與 `ocr-match.ts` `ocrIndex` 相同:有空字串模板的 entry 整條不收;
 * `text.zh` 與 `text.zhVariants` 的其他寫法都收 —— 定位只問「像不像詞綴」,反向寫法也算)
 */
export function buildLocateIndex(tiers: LocateTiersLike, lang: OcrTextLang = "zh"): LocateIndex {
  if (lang === "en") return buildLocateIndexEn(tiers);
  const set = new Set<string>();
  for (const entry of tiers.entries) {
    if (entry.parts.some((p) => !p.text.zh.trim())) continue;
    for (const part of entry.parts) {
      set.add(templateSkeleton(part.text.zh).skeleton);
      for (const v of part.text.zhVariants ?? []) if (v.text.trim()) set.add(templateSkeleton(v.text).skeleton);
    }
  }
  return { set, list: [...set] };
}

/** 英文索引(第 22 步):`text.en` + `text.enVariants`;排除規則同繁中(有空字串英文模板的 entry 整條不收) */
function buildLocateIndexEn(tiers: LocateTiersLike): LocateIndex {
  const set = new Set<string>();
  for (const entry of tiers.entries) {
    if (entry.parts.some((p) => !(p.text.en ?? "").trim())) continue;
    for (const part of entry.parts) {
      set.add(templateSkeleton(part.text.en ?? "", "en").skeleton);
      for (const v of part.text.enVariants ?? []) if (v.text.trim()) set.add(templateSkeleton(v.text, "en").skeleton);
    }
  }
  return { set, list: [...set], lang: "en" };
}

/** 這行文字像不像某個詞綴模板(精確或模糊);語言跟著索引 */
export function lineLooksLikeMod(text: string, idx: LocateIndex): boolean {
  const en = idx.lang === "en";
  const norm = en ? normalizeOcrTextEn(text) : normalizeOcrText(text);
  if (en ? !LATIN_WORD.test(norm) : !CJK.test(norm)) return false;
  const { skeleton } = ocrSkeleton(norm);
  if (idx.set.has(skeleton)) return true;
  const c = fuzzyCache(idx);
  const cached = c.results.get(skeleton);
  if (cached !== undefined) return cached;
  // 同 `skeletonSimilarity(skeleton, t) >= FUZZY_MIN_SIM - EPS` 全掃 idx.list(結果只是「有沒有」,順序不影響),
  // 只算長度上可能達門檻的候選(`fuzzyLengthPossible`)
  const S = codePoints(skeleton);
  const minSim = en ? c.cands.rules.minSim : FUZZY_MIN_SIM;
  let found = false;
  for (const i of c.cands.candidates(S.length)) {
    const T = c.cands.cps[i];
    if (1 - levenshteinCp(S, T) / Math.max(S.length, T.length, 1) >= minSim - EPS) {
      found = true;
      break;
    }
  }
  c.results.set(skeleton, found);
  return found;
}

/**
 * 效能修正第 8 步:每個索引一份「依長度分桶的候選 + 模糊結果 LRU(鍵 = 正規化後的 skeleton)」。
 * 掛在索引物件上(WeakMap,以物件身分判斷失效),換索引自然失效。
 * 前提:索引建好之後不可變(`list` 不得替換 / 增刪;要改就建新索引物件)。
 */
interface LocateFuzzyCache {
  cands: FuzzyCandidates<string>;
  results: Lru<string, boolean>;
}
const locateFuzzy = new WeakMap<LocateIndex, LocateFuzzyCache>();

function fuzzyCache(idx: LocateIndex): LocateFuzzyCache {
  let c = locateFuzzy.get(idx);
  if (!c) {
    c = { cands: new FuzzyCandidates(idx.list, (t) => t, fuzzyRules(idxLang(idx))), results: new Lru() };
    locateFuzzy.set(idx, c);
  }
  return c;
}

const cy = (l: Rect) => l.y + l.h / 2;
const cx = (l: Rect) => l.x + l.w / 2;

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

/** 命中的行 + 折行配對(`pairs`:前半 → 後半) */
function modHits(lines: OcrTextLine[], idx: LocateIndex): { hits: OcrTextLine[]; pairs: Map<OcrTextLine, OcrTextLine> } {
  const en = idx.lang === "en";
  const sorted = (en ? lines.filter((l) => hasLangText(l.text, "en")) : lines.filter((l) => CJK.test(l.text))).sort(
    (a, b) => cy(a) - cy(b) || a.x - b.x,
  );
  const hMed = median(sorted.map((l) => l.h)) || 1;
  const out: OcrTextLine[] = [];
  const pairs = new Map<OcrTextLine, OcrTextLine>();
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (lineLooksLikeMod(a.text, idx)) {
      out.push(a);
      continue;
    }
    const b = sorted[i + 1];
    if (
      b &&
      cy(b) - cy(a) <= GROUP_GAP_RATIO * hMed &&
      Math.abs(cx(b) - cx(a)) <= ALIGN_RATIO * hMed &&
      !lineLooksLikeMod(b.text, idx) &&
      // 英文:兩行之間補一個空白(數字旁 O/l 的規則看得到字界;正規化後空白本來就會刪掉)
      lineLooksLikeMod(en ? `${a.text} ${b.text}` : a.text + b.text, idx)
    ) {
      out.push(a, b);
      pairs.set(a, b);
      i++;
    }
  }
  return { hits: out, pairs };
}

/** 命中的行(折行:一行自己不像、接下一行才像 → 兩行一起算命中) */
export function modLines(lines: OcrTextLine[], idx: LocateIndex): OcrTextLine[] {
  return modHits(lines, idx).hits;
}

/**
 * 簇內的命中行 → 否決規則用的形狀行(折行兩半都在簇內 → 合併成一行,`merged`);
 * `origin` = 形狀行 → 原本的行(合併行對到兩行),視窗挑完後換回原本的行
 */
function shapeOf(
  cluster: OcrTextLine[],
  pairs: Map<OcrTextLine, OcrTextLine>,
): { shape: ShapeLine[]; origin: Map<ShapeLine, OcrTextLine[]> } {
  const inCluster = new Set(cluster);
  const tails = new Set([...pairs.entries()].filter(([a, b]) => inCluster.has(a) && inCluster.has(b)).map(([, b]) => b));
  const shape: ShapeLine[] = [];
  const origin = new Map<ShapeLine, OcrTextLine[]>();
  for (const l of cluster) {
    if (tails.has(l)) continue;
    const b = pairs.get(l);
    if (b && tails.has(b)) {
      const m: ShapeLine = { ...unionRect([l, b]), text: `${l.text} ${b.text}`, merged: true };
      shape.push(m);
      origin.set(m, [l, b]);
    } else {
      shape.push(l);
      origin.set(l, [l]);
    }
  }
  return { shape, origin };
}

export interface PanelHits {
  /** 被採用的命中行(可能來自 1 個以上的簇) */
  hits: OcrTextLine[];
  /** hits 的外框 */
  box: Rect;
  /** 命中行的中位行高 */
  lineH: number;
  /** 所有簇的命中數(除錯用) */
  clusters: number[];
}

/** `findPanelHits` 的診斷輸出:被否決的簇(log 用) */
export interface PanelHitsDiag {
  vetoes: Array<PanelVeto & { lines: number }>;
}

/**
 * 找面板上的詞綴行:命中行依 y 排序成簇(相鄰中心距 ≤ PANEL_GAP_RATIO × 行高、x 中心與簇對齊);
 * 每一簇過 `panelWindows`(明顯是浮窗 → 整簇不採用;4 組的簇只採用沒被否決的連續 3 組視窗;否決原因記進 `diag.vetoes`);
 * 採用所有沒被否決、≥ 2 行的簇(面板至少 2 個選項;畫面上若還有別的詞綴簇一起框進來 —— 寧可框大也不框錯,
 * 真正挑面板是 renderer `matchReveal` 的事);沒有 ≥ 2 行的簇就採用沒被否決的全部命中行。沒有命中(或全被否決)回 null。
 */
export function findPanelHits(lines: OcrTextLine[], idx: LocateIndex, diag?: PanelHitsDiag): PanelHits | null {
  const { hits, pairs } = modHits(lines, idx);
  if (!hits.length) return null;
  const lineH = median(hits.map((l) => l.h)) || 1;
  const clusters: OcrTextLine[][] = [];
  for (const l of [...hits].sort((a, b) => cy(a) - cy(b))) {
    const c = clusters.find((g) => {
      const last = g[g.length - 1];
      return cy(l) - cy(last) <= PANEL_GAP_RATIO * lineH && Math.abs(cx(l) - median(g.map(cx))) <= ALIGN_RATIO * lineH;
    });
    if (c) c.push(l);
    else clusters.push([l]);
  }
  const hitSet = new Set(hits);
  const others = lines.filter((l) => !hitSet.has(l));
  const kept: OcrTextLine[][] = [];
  for (const g of clusters) {
    const { shape, origin } = shapeOf(g, pairs);
    const r = panelWindows(shape, others, idxLang(idx));
    if ("veto" in r) {
      diag?.vetoes.push({ ...r.veto, lines: g.length });
      continue;
    }
    const use = new Set(r.hits.flatMap((l) => origin.get(l) ?? [l]));
    kept.push(g.filter((l) => use.has(l)));
  }
  if (!kept.length) return null;
  const multi = kept.filter((g) => g.length >= 2);
  const used = multi.length ? multi.flat() : kept.flat();
  return { hits: used, box: unionRect(used), lineH, clusters: clusters.map((g) => g.length) };
}

/** 外擴後至少要有這麼高(行高倍數):命中行太少(×1 只認出 1–2 行)時,垂直方向仍要蓋得住 3 組 × 最多 3 行 + 組距 */
export const MIN_PANEL_LINES = 14;
/** 水平每邊外擴 ≥ 框寬 × 0.75(= 1.5 × 半寬)且 ≥ 8 × 行高(最長的詞綴行可能比命中的行寬很多) */
export const EXPAND_X_RATIO = 0.75;
export const EXPAND_X_LINES = 8;
/** 垂直每邊外擴 ≥ 3 × 行高 */
export const EXPAND_Y_LINES = 3;

/** 命中框四邊外擴,夾在 bounds 內(整數像素) */
export function expandBox(box: Rect, lineH: number, bounds: Rect): Rect {
  const dx = Math.max(EXPAND_X_RATIO * box.w, EXPAND_X_LINES * lineH);
  const dy = Math.max(EXPAND_Y_LINES * lineH, (MIN_PANEL_LINES * lineH - box.h) / 2);
  const x0 = Math.max(bounds.x, Math.floor(box.x - dx));
  const y0 = Math.max(bounds.y, Math.floor(box.y - dy));
  const x1 = Math.min(bounds.x + bounds.w, Math.ceil(box.x + box.w + dx));
  const y1 = Math.min(bounds.y + bounds.h, Math.ceil(box.y + box.h + dy));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** 第 1 段:整張 ×1 的行 → 第 2 段的裁切框;一行都不像詞綴回 null(呼叫端退回整張 ×3) */
export function locatePanel(
  lines: OcrTextLine[],
  idx: LocateIndex,
  bounds: Rect,
): (PanelHits & { crop: Rect }) | null {
  const found = findPanelHits(lines, idx);
  if (!found) return null;
  const crop = expandBox(found.box, found.lineH, bounds);
  if (crop.w <= 0 || crop.h <= 0) return null;
  return { ...found, crop };
}

export type RegionCheck =
  | { ok: true; hits: number }
  | { ok: false; hits: number; reason: "too-few-hits" | "touches-edge" };

/**
 * 某個裁切範圍(快取區或第 2 段)的辨識結果是否「完整框住面板」:
 * ≥ 2 行像詞綴,且命中框離範圍的每個邊至少 1 個行高(該邊本來就是 bounds 邊界時不算 —— 再外擴也沒有東西)。
 * 貼邊 = 面板可能有一部分在範圍外(遊戲 UI 位置變了、面板變高),呼叫端應改走下一條路。
 */
export function checkRegion(lines: OcrTextLine[], idx: LocateIndex, region: Rect, bounds: Rect): RegionCheck {
  const found = findPanelHits(lines, idx);
  const hits = found?.hits.length ?? 0;
  if (!found || hits < 2) return { ok: false, hits, reason: "too-few-hits" };
  const m = found.lineH;
  const b = found.box;
  const near = (d: number, atBounds: boolean) => !atBounds && d < m;
  if (
    near(b.x - region.x, region.x <= bounds.x) ||
    near(b.y - region.y, region.y <= bounds.y) ||
    near(region.x + region.w - (b.x + b.w), region.x + region.w >= bounds.x + bounds.w) ||
    near(region.y + region.h - (b.y + b.h), region.y + region.h >= bounds.y + bounds.h)
  ) {
    return { ok: false, hits, reason: "touches-edge" };
  }
  return { ok: true, hits };
}
