/**
 * exile-appraiser(WP-S):靈魂之井「三選一揭露面板」的 OCR 行 → 褻瀆詞綴候選 + Tier。純函式,可在 renderer 與 vitest 跑。
 *
 * 管線(詳見 docs/reveal-ocr.md):
 * 1. `normalizeOcrText`:刪所有空白(WinRT 在 CJK 字間插空白)、全形 ASCII → 半形、數字旁的 O/o → 0、l/I/| → 1。
 * 2. skeleton:數值(`STAT_VALUE_RE`,與 parser 同一支 regex;前面的 `+`/`-` 一起吃掉)→ `#`。
 *    模板(`tiers.json` 的 `parts[].text.zh`)做同樣處理,並記住每個 `#` 是動態(原本就是 `#`)還是固定數字(`每100點最大生命`)。
 *    395 個模板 → 394 個 skeleton(去掉空字串模板;`diagnostics.numeric_skeleton_collisions` = 0,不同模板不會撞)。
 *    另收 `text.zhVariants`(同 ref 的其他寫法:`技能增加#%精魂保留效用`、`增加#%施放速度`、反向的 `減少#%…`);
 *    一個 skeleton 可能同時是 A 的 `text.zh` 與 B 的反向寫法(`增加#%攻擊速度`),refs 逐一記 `negate`,數值階段再分。
 * 3. `matchLine`:skeleton 精確相等 → 命中;否則 Levenshtein 相似度 ≥ 0.85 且長度差 ≤ 2 → 模糊命中(`fuzzy`,只留最高分)。
 * 4. 換行:某行自己對不上(或只模糊)、與下一行接起來能精確命中 → 合併成一行(面板太窄時長詞綴會折行)。
 * 5. `groupLines`:依 y 中心排序,相鄰兩行中心距 > 1.9 × 中位行高就切組(樣本:組內 1.54×、組間 ≥ 2.31×),x 中心要對齊(面板文字置中)。
 * 6. 每組:組內命中的行必須與某個 entry 的 parts 一一對應(數值落在各 `#` 的 ranges 內;OCR 漏數字時只靠文字);
 *    整組對不上時把組內行切成最少段、每段各自對上一個 entry(幾何切不開的等距單行詞綴、門檻失準時的後援)。
 * 7. 面板 = 連續、x 對齊、彼此相距不遠的 2–3 組(取有 entry 對上最多者);不足 2 組 → `no-panel`。
 *    夾在兩組命中之間、x 對齊、行高相近的未命中行自成一組 `partial`(`bridgeUnmatched`),面板不因中間那個選項沒認出而斷開。
 *    之後把對不上的 CJK 行貼到最近的組(灰色顯示原文,`partial`)。
 *    2026-10-01:每一段候選面板再過 `panel-veto.ts` 的否決規則(物品浮窗的詞綴標頭 / 屬性行、幾何組數 > 3)→ 否決的段不採用;
 *    全部被否決時 `no-panel` 帶 `veto`(log 用)。「確認」按鈕 / 「靈魂之井」標題只在挑段時加分。
 *    2026-10-02 code review 第 A 批:先 `rawRunVeto`(原始段明顯是浮窗:> 4 組、或連續 4+ 行各自一條詞綴),再挑分數最高的連續 3 組,
 *    **只對挑中的 3 組**套 `panelVeto`(真面板旁多一條像詞綴的雜行時不再整段否決)。
 * 8. profile:呼叫端給最近查價的 PoE2 物品 refName → `resolveProfiles`(base_profiles 精確 / 類別後援);
 *    沒有時取「每組都有候選的 profile」交集(三個選項屬於同一件物品),再沒有就全部 profile;Tier 取聯集 → `T3–T4`,`profileExact: false`(UI 加「?」)。
 * 9. 2026-10-02 第 22 步:英文客戶端(`opts.lang: "en"`)—— 模板改用 `text.en` + `text.enVariants`(schema 2),
 *    正規化 `normalizeOcrTextEn`(轉小寫、刪空白、small caps 常見誤讀)、文字行 = 含兩個連續拉丁字母、模糊門檻 `EN_FUZZY`(相似度 0.85、長度差由門檻推得),
 *    否決關鍵字換英文(`panel-veto.ts`)。分組 / 面板 / entry 對應 / 數值 / profile 的規則與繁中完全相同。省略 `lang` = 繁中(逐位元不變)。
 */
import { partRange, resolveProfiles, type DesecrationData } from "./infer";
import type { DesecrationEntry, DesecrationPart, DesecrationPool } from "./types";
// exile-appraiser(WP-S 兩段式):正規化 / skeleton / Levenshtein / 門檻搬到零依賴的 ocr-text.ts(main 的面板定位共用),這裡 re-export
import {
  ALIGN_RATIO,
  CJK,
  EPS,
  FUZZY_MAX_LEN_DIFF,
  FUZZY_MIN_SIM,
  FuzzyCandidates,
  GROUP_GAP_RATIO,
  LATIN_WORD,
  Lru,
  PANEL_GAP_RATIO,
  codePoints,
  fuzzyRules,
  hasLangText,
  levenshtein,
  levenshteinCp,
  normalizeOcrText,
  normalizeOcrTextEn,
  ocrSkeleton,
  templateSkeleton,
  type OcrTextLang,
  type OcrTextLine,
} from "./ocr-text";
import { panelAnchorScore, panelVeto, rawRunVeto, type PanelVeto, type ShapeLine } from "./panel-veto";

export {
  ALIGN_RATIO,
  FUZZY_MAX_LEN_DIFF,
  FUZZY_MIN_SIM,
  GROUP_GAP_RATIO,
  PANEL_GAP_RATIO,
  levenshtein,
  normalizeOcrText,
  normalizeOcrTextEn,
  ocrSkeleton,
  templateSkeleton,
  type OcrTextLang,
  type OcrTextLine,
};

export interface TemplateRef {
  entry: DesecrationEntry;
  partIdx: number;
  /** 這個寫法每個 `#` 的來源:`dyn` = 模板的 `#`;數字 = 模板寫死的數值(同一 skeleton 的不同寫法可能不同:`攻擊會額外連鎖#次` / `…1次`) */
  slots: Array<"dyn" | number>;
  /** 這個寫法顯示的極性與 part 的 `text.zh` 相反(`zhVariants[].negate`) */
  negate: boolean;
  /** 命中的是 `text.zhVariants`(英文:`text.enVariants`)的哪個寫法;undefined = `text.zh`(英文:`text.en`)本身 */
  variant?: string;
}

export interface TemplateInfo {
  skeleton: string;
  refs: TemplateRef[];
}

export interface TemplateHit {
  info: TemplateInfo;
  score: number;
  fuzzy: boolean;
}

export interface LineMatch {
  norm: string;
  skeleton: string;
  /** OCR 抽到的數值(絕對值,依出現順序) */
  values: number[];
  hits: TemplateHit[];
}

export interface RevealLine extends OcrTextLine {
  match: LineMatch | null;
  /** 由兩行折行合併而來 */
  merged?: boolean;
}

export interface RevealCandidate {
  /** 單一 Tier;profile 不明或多 profile 不一致時為 undefined,看 tierRange */
  tier?: number;
  tierRange: [number, number];
  pool: DesecrationPool;
  gods?: string[];
  /** 與組內命中行同序;每行一組 [lo, hi](多個 `#` 取平均,同 infer.ts `partRange`) */
  ranges: Array<[number, number] | null>;
  fuzzy: boolean;
  entryIds: string[];
}

export interface RevealGroup {
  lines: RevealLine[];
  rect: { x: number; y: number; w: number; h: number };
  candidates: RevealCandidate[];
  /** 組內有對不上的行(候選只根據命中的行) */
  partial: boolean;
}

export type RevealMatchResult =
  | {
      ok: true;
      groups: RevealGroup[];
      /** profile 來自呼叫端給的 refName 且精確命中 base_profiles */
      profileExact: boolean;
      profileSource: "refName" | "category" | "intersection" | "all";
    }
  | {
      ok: false;
      error: "no-panel";
      lines: RevealLine[];
      /** 有候選段、但被否決規則擋掉(物品浮窗等;`panel-veto.ts`)時的第一個原因 */
      veto?: PanelVeto;
    };

export interface RevealMatchOptions {
  /** 最近查價的 PoE2 物品(英文 refName / ItemCategory);沒有就推 profile */
  refName?: string;
  category?: string;
  /** 沒有 refName 時先取「每組都有候選的 profile」交集(預設 true);false = 直接用全部 profile 的聯集 */
  intersectProfiles?: boolean;
  /** 第 22 步:OCR 文字語言(英文客戶端 = `en`);省略 = 繁中 */
  lang?: OcrTextLang;
}

// ---------------------------------------------------------------- 索引

interface OcrIndex {
  data: DesecrationData;
  bySkeleton: Map<string, TemplateInfo>;
  list: TemplateInfo[];
  allProfiles: string[];
  /** 效能修正第 8 步:`list` 依碼點長度分桶(候選順序 = list 順序) */
  fuzzy: FuzzyCandidates<TemplateInfo>;
  /** 模糊命中結果 LRU(鍵 = skeleton;值 = hits,null = 沒命中);索引跟著 data 換,快取一起換 */
  fuzzyHits: Lru<string, TemplateHit[] | null>;
  /** 第 22 步:模板語言 */
  lang: OcrTextLang;
}

const indexCache = new WeakMap<DesecrationData, OcrIndex>();
/** 第 22 步:英文索引(同一份 data,另一份快取) */
const indexCacheEn = new WeakMap<DesecrationData, OcrIndex>();

export function ocrIndex(data: DesecrationData, lang: OcrTextLang = "zh"): OcrIndex {
  if (lang === "en") return ocrIndexEn(data);
  let idx = indexCache.get(data);
  if (idx) return idx;
  const bySkeleton = new Map<string, TemplateInfo>();
  for (const entry of data.tiers.entries) {
    // 有空字串模板的 entry(如 StunDamageIncrease*)對不上畫面文字,整條排除
    if (entry.parts.some((p) => !p.text.zh.trim())) continue;
    entry.parts.forEach((part, partIdx) => {
      const forms: Array<{ text: string; negate: boolean; variant?: string }> = [
        { text: part.text.zh, negate: false },
        ...(part.text.zhVariants ?? [])
          .filter((v) => v.text.trim())
          .map((v) => ({ text: v.text, negate: v.negate === true, variant: v.text })),
      ];
      for (const form of forms) {
        const { skeleton, slots } = templateSkeleton(form.text);
        let info = bySkeleton.get(skeleton);
        if (!info) bySkeleton.set(skeleton, (info = { skeleton, refs: [] }));
        const dup = info.refs.some(
          (r) =>
            r.entry === entry && r.partIdx === partIdx && r.negate === form.negate && r.slots.join() === slots.join(),
        );
        if (!dup) info.refs.push({ entry, partIdx, slots, negate: form.negate, variant: form.variant });
      }
    });
  }
  const list = [...bySkeleton.values()];
  idx = {
    data,
    bySkeleton,
    list,
    allProfiles: data.tiers.profiles.map((p) => p.id),
    fuzzy: new FuzzyCandidates(list, (info) => info.skeleton),
    fuzzyHits: new Lru(),
    lang: "zh",
  };
  indexCache.set(data, idx);
  return idx;
}

/**
 * 英文索引(第 22 步):與繁中相同的結構,模板改用 `text.en`(= stats ref,或 increased/reduced 翻轉後的寫法;ranges 以它為準)
 * 與 `text.enVariants`(同一 stat 的其他英文 matcher,`negate` 相對 `text.en`)。有空字串英文模板的 entry 整條排除。
 */
function ocrIndexEn(data: DesecrationData): OcrIndex {
  let idx = indexCacheEn.get(data);
  if (idx) return idx;
  const bySkeleton = new Map<string, TemplateInfo>();
  for (const entry of data.tiers.entries) {
    if (entry.parts.some((p) => !p.text.en.trim())) continue;
    entry.parts.forEach((part, partIdx) => {
      const forms: Array<{ text: string; negate: boolean; variant?: string }> = [
        { text: part.text.en, negate: false },
        ...(part.text.enVariants ?? [])
          .filter((v) => v.text.trim())
          .map((v) => ({ text: v.text, negate: v.negate === true, variant: v.text })),
      ];
      for (const form of forms) {
        const { skeleton, slots } = templateSkeleton(form.text, "en");
        let info = bySkeleton.get(skeleton);
        if (!info) bySkeleton.set(skeleton, (info = { skeleton, refs: [] }));
        const dup = info.refs.some(
          (r) =>
            r.entry === entry && r.partIdx === partIdx && r.negate === form.negate && r.slots.join() === slots.join(),
        );
        if (!dup) info.refs.push({ entry, partIdx, slots, negate: form.negate, variant: form.variant });
      }
    });
  }
  const list = [...bySkeleton.values()];
  idx = {
    data,
    bySkeleton,
    list,
    allProfiles: data.tiers.profiles.map((p) => p.id),
    fuzzy: new FuzzyCandidates(list, (info) => info.skeleton, fuzzyRules("en")),
    fuzzyHits: new Lru(),
    lang: "en",
  };
  indexCacheEn.set(data, idx);
  return idx;
}

export function matchLine(text: string, data: DesecrationData, lang: OcrTextLang = "zh"): LineMatch | null {
  const en = lang === "en";
  const norm = en ? normalizeOcrTextEn(text) : normalizeOcrText(text);
  if (en ? !LATIN_WORD.test(norm) : !CJK.test(norm)) return null;
  const idx = ocrIndex(data, lang);
  const { skeleton, values } = ocrSkeleton(norm);
  const exact = idx.bySkeleton.get(skeleton);
  if (exact) return { norm, skeleton, values, hits: [{ info: exact, score: 1, fuzzy: false }] };
  let fuzzyHits = idx.fuzzyHits.get(skeleton);
  if (fuzzyHits === undefined) {
    fuzzyHits = fuzzyMatch(idx, skeleton);
    idx.fuzzyHits.set(skeleton, fuzzyHits);
  }
  // 每次回傳新物件(快取裡的 hits 不外流,呼叫端改了也不影響下一次)
  return fuzzyHits ? { norm, skeleton, values, hits: fuzzyHits.map((h) => ({ ...h })) } : null;
}

/**
 * 模糊命中(只留最高分;差 ≤ EPS 視為同分,依 list 順序收)。與全掃 list 相同,只是跳過長度上不可能達門檻的候選
 * (`fuzzyLengthPossible`;被跳過的在全掃時也是「低於門檻 → continue」,不動 best / hits)。
 */
function fuzzyMatch(idx: OcrIndex, skeleton: string): TemplateHit[] | null {
  const S = codePoints(skeleton);
  const len = S.length;
  // 繁中 = FUZZY_MAX_LEN_DIFF / FUZZY_MIN_SIM(改版前的常數);英文 = EN_FUZZY
  const maxLenDiff = idx.lang === "en" ? idx.fuzzy.rules.maxLenDiff : FUZZY_MAX_LEN_DIFF;
  const minSim = idx.lang === "en" ? idx.fuzzy.rules.minSim : FUZZY_MIN_SIM;
  let best = 0;
  let hits: TemplateHit[] = [];
  for (const i of idx.fuzzy.candidates(len)) {
    const info = idx.list[i];
    const T = idx.fuzzy.cps[i];
    const l2 = T.length;
    if (Math.abs(l2 - len) > maxLenDiff) continue;
    const sim = 1 - levenshteinCp(S, T) / Math.max(len, l2);
    if (sim < minSim - EPS || sim < best - EPS) continue;
    if (sim > best + EPS) {
      best = sim;
      hits = [];
    }
    hits.push({ info, score: sim, fuzzy: true });
  }
  return hits.length ? hits : null;
}

/** 動態槽的數值(OCR 數值個數與模板槽數不同 → null = 只靠文字) */
function dynamicValues(match: LineMatch, ref: TemplateRef): number[] | null {
  if (match.values.length !== ref.slots.length) return null;
  return match.values.filter((_, i) => ref.slots[i] === "dyn");
}

/**
 * 數值落在各 `#` 的 ranges 內。ranges 已取絕對值,代表「以 part 的 `text.zh` 寫法顯示時的數字」;
 * 沒有 ranges 或數值不齊(OCR 漏字)→ 不以數值排除。
 *
 * `negate`(命中的寫法與 `text.zh` 極性相反):畫面上的 X 在 `text.zh` 的語意下是 −X,要 −X 落在 range 內才算。
 * 例:part `減少#%攻擊速度`(direction decrease,15–15),畫面 `增加5%攻擊速度` → −5 ∉ [15, 15] → 不是這條。
 * ranges 全是非負區間(產生器保證,極性翻轉的 part 也取絕對值),所以反向寫法只在 X = 0 且下限 0 時才可能;
 * 數值不齊時,只要有一個 `#` 的下限 > 0 就排除(這條詞綴擲出的值永遠以 `text.zh` 的極性顯示)。
 */
export function valuesFit(part: DesecrationPart, values: number[] | null, negate = false): boolean {
  if (!part.ranges) return true;
  const ranges = part.ranges.map((r) => [Math.min(Math.abs(r[0]), Math.abs(r[1])), Math.max(Math.abs(r[0]), Math.abs(r[1]))]);
  if (!values || ranges.length !== values.length) return negate ? ranges.every(([lo]) => lo <= EPS) : true;
  return ranges.every(([lo, hi], i) => {
    const v = negate ? -values[i] : values[i];
    return v >= lo - EPS && v <= hi + EPS;
  });
}

/** 這一行(命中 hit)能不能當作 entry 的第 partIdx 個 part:有一個指向它的寫法且數值相符 → 回傳是否模糊;不行回 null */
function fitPart(m: LineMatch, entry: DesecrationEntry, partIdx: number): { fuzzy: boolean } | null {
  const part = entry.parts[partIdx];
  for (const h of m.hits) {
    for (const r of h.info.refs) {
      if (r.entry !== entry || r.partIdx !== partIdx) continue;
      if (valuesFit(part, dynamicValues(m, r), r.negate)) return { fuzzy: h.fuzzy };
    }
  }
  return null;
}

// ---------------------------------------------------------------- 分組

const cy = (l: OcrTextLine) => l.y + l.h / 2;
const cx = (l: OcrTextLine) => l.x + l.w / 2;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function union(lines: OcrTextLine[]): { x: number; y: number; w: number; h: number } {
  const x0 = Math.min(...lines.map((l) => l.x));
  const y0 = Math.min(...lines.map((l) => l.y));
  const x1 = Math.max(...lines.map((l) => l.x + l.w));
  const y1 = Math.max(...lines.map((l) => l.y + l.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 逐行比對 + 折行合併;回傳依 y 排序、含 CJK 的行(未命中的 match = null) */
export function prepareLines(lines: OcrTextLine[], data: DesecrationData, lang: OcrTextLang = "zh"): RevealLine[] {
  const en = lang === "en";
  const sorted = (en ? lines.filter((l) => hasLangText(l.text, "en")) : lines.filter((l) => CJK.test(l.text)))
    .sort((a, b) => cy(a) - cy(b) || a.x - b.x)
    .map((l) => ({ ...l, match: matchLine(l.text, data, lang) }) as RevealLine);
  const hMed = median(sorted.map((l) => l.h)) || 1;
  const out: RevealLine[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const aExact = a.match != null && !a.match.hits[0].fuzzy;
    const bExact = b?.match != null && !b.match.hits[0].fuzzy;
    // 下一行自己精確命中就不合併;這一行精確命中時,只在下一行完全對不上時才試(`增加#%護甲值` + `和閃避` 這種前半也是合法模板的折行)
    const tryMerge = b != null && !bExact && !(aExact && b.match != null);
    if (tryMerge && cy(b) - cy(a) <= GROUP_GAP_RATIO * hMed && Math.abs(cx(b) - cx(a)) <= ALIGN_RATIO * hMed) {
      // 英文:兩行之間補一個空白(數字旁 O/l 的規則看得到字界;正規化後空白本來就會刪掉)
      const merged = en ? matchLine(`${a.text} ${b.text}`, data, lang) : matchLine(a.text + b.text, data);
      if (merged && !merged.hits[0].fuzzy) {
        out.push({ ...union([a, b]), text: `${a.text} ${b.text}`, match: merged, merged: true });
        i++;
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

/** 命中的行依行距切組(x 中心不對齊也切) */
export function groupLines(lines: RevealLine[]): RevealLine[][] {
  const hit = lines.filter((l) => l.match).sort((a, b) => cy(a) - cy(b));
  if (!hit.length) return [];
  const hMed = median(hit.map((l) => (l.merged ? l.h / 2 : l.h))) || 1;
  const groups: RevealLine[][] = [[hit[0]]];
  for (let i = 1; i < hit.length; i++) {
    const prev = hit[i - 1];
    const cur = hit[i];
    const g = groups[groups.length - 1];
    const gcx = median(g.map(cx));
    // 合併過的行本身跨兩行:用它的下緣附近當中心
    const prevCy = prev.merged ? prev.y + prev.h - hMed / 2 : cy(prev);
    const curCy = cur.merged ? cur.y + hMed / 2 : cy(cur);
    if (curCy - prevCy > GROUP_GAP_RATIO * hMed || Math.abs(cx(cur) - gcx) > ALIGN_RATIO * hMed) {
      groups.push([cur]);
    } else {
      g.push(cur);
    }
  }
  return groups;
}

/** 夾在兩組之間的未命中行:行高與命中行中位行高的比值上限(`max / min`;面板標題的字約 1.36×,不收) */
export const BRIDGE_HEIGHT_RATIO = 1.3;

interface Seg {
  lines: RevealLine[];
  covers: Cover[];
  partial: boolean;
  /** `bridgeUnmatched` 補進來的未命中組 */
  bridge?: boolean;
}

/**
 * 面板中間那個選項沒認出時(例:遊戲顯示 `技能增加10%精魂保留效用`、資料只有 `增加#%精魂保留效用`),上下兩組相距約兩倍組距,
 * 超過 PANEL_GAP 就被拆成兩個各 1 組的「面板」→ `no-panel`。
 * 這裡把**夾在相鄰兩組之間**、x 中心與兩組都對齊(ALIGN_RATIO)、行高與命中行相近(BRIDGE_HEIGHT_RATIO)、
 * 離兩組的每一行中心距都超過分組門檻(否則它是那組的折行 / 雜字,留給後面的「貼到最近的組」)的未命中行自成一組 `partial`,
 * `selectPanel` 以包含它後的組數判定(與兩側的間距仍要 ≤ PANEL_GAP,行距模式不對就接不起來)。
 * 只補「之間」:面板上方的標題(字大)、下方的「確認」按鈕、旁邊的小地圖 / 背包字都不會被併入。
 * 連續幾行都沒認出(一個選項的多行詞綴)且彼此中心距 ≤ 分組門檻 → 同一組。
 */
function bridgeUnmatched(segs: Seg[], lines: RevealLine[]): Seg[] {
  const hMed = median(segs.flatMap((s) => s.lines).map((l) => (l.merged ? l.h / 2 : l.h))) || 1;
  const free = lines.filter((l) => !l.match);
  if (!free.length) return segs;
  const out: Seg[] = [];
  const used = new Set<RevealLine>();
  segs.forEach((a, i) => {
    out.push(a);
    const b = segs[i + 1];
    if (!b) return;
    const ra = union(a.lines);
    const rb = union(b.lines);
    const acx = ra.x + ra.w / 2;
    const bcx = rb.x + rb.w / 2;
    if (Math.abs(acx - bcx) > ALIGN_RATIO * hMed) return;
    const near = [...a.lines, ...b.lines];
    const mids = free
      .filter((u) => {
        if (used.has(u)) return false;
        const c = cy(u);
        if (c <= ra.y + ra.h || c >= rb.y) return false;
        if (Math.abs(cx(u) - acx) > ALIGN_RATIO * hMed || Math.abs(cx(u) - bcx) > ALIGN_RATIO * hMed) return false;
        if (Math.max(u.h, hMed) / Math.max(EPS, Math.min(u.h, hMed)) > BRIDGE_HEIGHT_RATIO + EPS) return false;
        return near.every((l) => Math.abs(cy(l) - c) > GROUP_GAP_RATIO * hMed);
      })
      .sort((p, q) => cy(p) - cy(q));
    let cur: RevealLine[] = [];
    const flush = () => {
      if (cur.length) out.push({ lines: cur, covers: [], partial: true, bridge: true });
      cur = [];
    };
    for (const u of mids) {
      if (cur.length && cy(u) - cy(cur[cur.length - 1]) > GROUP_GAP_RATIO * hMed) flush();
      cur.push(u);
      used.add(u);
    }
    flush();
  });
  return out;
}

/**
 * 從候選組挑出面板:連續、x 對齊、相距 ≤ PANEL_GAP 的組;取分數(有 entry 對上的組、精確命中行)最高的一段,最多 3 組。
 * 一段超過 3 組時先拿掉 `bridge` 組(它只負責把兩側接起來;3 個選項都認得出時,中間的未命中行只是雜字)。
 * 否決(`panel-veto.ts`;`free` = 對不上模板的行;> 3 行的幾何組改算語意段數 `splitCount`)分兩層(2026-10-02 code review 第 A 批):
 *   1. 挑窗前:整段過 `rawRunVeto`(> 4 組、或一塊連續 4+ 行切成 > 3 段 = 明顯是浮窗)→ 整段不用;
 *   2. 挑窗後:只對挑中的連續 3 組(其中的真組;未命中行照常由 `free` 提供)套 `panelVeto` → 否決就整段不用。
 *   改版前是整段先套 `panelVeto` 再挑窗:真面板旁 6 × 行高內多一條像詞綴的行被串進同段(4 組)就整段否決。
 * 分數另加面板固定元素(「確認」/「靈魂之井」,`panelAnchorScore`;只加分,不是必要條件)。
 */
function selectPanel<T extends { lines: RevealLine[]; covers: unknown[]; bridge?: boolean }>(
  groups: T[],
  free: RevealLine[],
  lang: OcrTextLang = "zh",
): { panel: T[] | null; veto?: PanelVeto } {
  if (groups.length < 2) return { panel: null };
  // 行高只看命中的行(bridge 組是未命中行,不改變原本的門檻)
  const hMed =
    median(groups.filter((g) => !g.bridge).flatMap((g) => g.lines).map((l) => (l.merged ? l.h / 2 : l.h))) || 1;
  const runs: T[][] = [];
  let run: T[] = [groups[0]];
  for (let i = 1; i < groups.length; i++) {
    const ra = union(groups[i - 1].lines);
    const rb = union(groups[i].lines);
    const gap = rb.y - (ra.y + ra.h);
    const aligned = Math.abs(ra.x + ra.w / 2 - (rb.x + rb.w / 2)) <= ALIGN_RATIO * hMed;
    if (gap <= PANEL_GAP_RATIO * hMed && aligned) {
      run.push(groups[i]);
    } else {
      runs.push(run);
      run = [groups[i]];
    }
  }
  runs.push(run);
  const score = (gs: T[]) =>
    gs.reduce(
      (s, g) => s + (g.covers.length ? 10 : 0) + g.lines.reduce((t, l) => t + (l.match && !l.match.hits[0].fuzzy ? 2 : 1), 0),
      0,
    ) +
    5 * panelAnchorScore(gs.filter((g) => !g.bridge).flatMap((g) => g.lines), free, lang);
  // > 3 行的幾何組(門檻失準把相鄰選項併在一起)改算語意切了幾段
  const vetoOf = (gs: T[], check: typeof panelVeto) => {
    const segOf = new Map<RevealLine, number>();
    gs.forEach((g, i) => g.lines.forEach((l) => segOf.set(l, i)));
    return check(gs.flatMap((g) => g.lines), free, {
      splitCount: (hs: ShapeLine[]) => new Set(hs.map((l) => segOf.get(l as RevealLine))).size,
      lang,
    });
  };
  const better = (w: T[], than: T[] | null) =>
    !than || w.length > than.length || (w.length === than.length && score(w) > score(than));
  let best: T[] | null = null;
  let veto: PanelVeto | undefined;
  for (const run0 of runs) {
    const real = run0.filter((g) => !g.bridge);
    // 1. 挑窗前:原始段明顯是浮窗 → 整段不用
    if (real.length >= 2) {
      const v = vetoOf(real, rawRunVeto);
      if (v) {
        veto ??= v;
        continue;
      }
    }
    const r = run0.length > 3 && real.length >= 2 ? real : run0;
    if (r.length < 2) continue;
    // 超過 3 組:取分數最高的連續 3 組
    const n = Math.min(3, r.length);
    let runBest: T[] | null = null;
    for (let i = 0; i + n <= r.length; i++) {
      const w = r.slice(i, i + n);
      if (w.filter((g) => !g.bridge).length < 2) continue; // 至少 2 組是真的對上詞綴
      if (better(w, runBest)) runBest = w;
    }
    if (!runBest) continue;
    // 2. 挑窗後:只對挑中的組套否決
    const v = vetoOf(runBest.filter((g) => !g.bridge), panelVeto);
    if (v) {
      veto ??= v;
      continue;
    }
    if (better(runBest, best)) best = runBest;
  }
  return best ? { panel: best } : { panel: null, veto };
}

// ---------------------------------------------------------------- entry 對應

interface Cover {
  entry: DesecrationEntry;
  /** 與 lines 同序 */
  parts: DesecrationPart[];
  fuzzy: boolean;
}

/** lines 與某 entry 的 parts 一一對應的所有 entry */
function coverEntries(lines: RevealLine[]): Cover[] {
  if (!lines.length || lines.some((l) => !l.match)) return [];
  const first = lines[0].match!;
  const seen = new Set<DesecrationEntry>();
  const out: Cover[] = [];
  for (const hit of first.hits) {
    for (const { entry } of hit.info.refs) {
      if (seen.has(entry) || entry.parts.length !== lines.length) continue;
      seen.add(entry);
      const used = new Array<boolean>(entry.parts.length).fill(false);
      const assigned: DesecrationPart[] = [];
      let fuzzy = false;
      const dfs = (i: number): boolean => {
        if (i === lines.length) return true;
        const m = lines[i].match!;
        for (let j = 0; j < entry.parts.length; j++) {
          if (used[j]) continue;
          const part = entry.parts[j];
          const h = fitPart(m, entry, j);
          if (!h) continue;
          used[j] = true;
          assigned[i] = part;
          const wasFuzzy = fuzzy;
          fuzzy = fuzzy || h.fuzzy;
          if (dfs(i + 1)) return true;
          fuzzy = wasFuzzy;
          used[j] = false;
        }
        return false;
      };
      if (dfs(0)) out.push({ entry, parts: [...assigned], fuzzy });
    }
  }
  return out;
}

/** 把命中的行切成最少的連續段,每段都有 entry 對得上;整段對不上回 null */
function segment(lines: RevealLine[]): Array<{ lines: RevealLine[]; covers: Cover[] }> | null {
  const n = lines.length;
  const best: Array<Array<{ lines: RevealLine[]; covers: Cover[] }> | null> = new Array(n + 1).fill(null);
  best[0] = [];
  for (let i = 1; i <= n; i++) {
    for (let k = Math.max(0, i - 3); k < i; k++) {
      if (!best[k]) continue;
      const seg = lines.slice(k, i);
      const covers = coverEntries(seg);
      if (!covers.length) continue;
      const cand = [...best[k]!, { lines: seg, covers }];
      if (!best[i] || cand.length < best[i]!.length) best[i] = cand;
    }
  }
  return best[n];
}

function toCandidates(covers: Cover[], profiles: string[]): RevealCandidate[] {
  const out: RevealCandidate[] = [];
  const seen = new Set<string>();
  for (const c of covers) {
    const tiers = [...new Set(profiles.map((p) => c.entry.profile_tiers[p]).filter((t): t is number => t != null))].sort(
      (a, b) => a - b,
    );
    if (!tiers.length) continue; // 這些 profile 擲不出這條
    const cand: RevealCandidate = {
      tier: tiers.length === 1 ? tiers[0] : undefined,
      tierRange: [tiers[0], tiers[tiers.length - 1]],
      pool: c.entry.pool,
      gods: c.entry.gods,
      ranges: c.parts.map(partRange),
      fuzzy: c.fuzzy,
      entryIds: [c.entry.mod_id],
    };
    const key = `${cand.tierRange.join("-")}|${cand.pool}|${cand.gods?.join("+") ?? ""}|${JSON.stringify(cand.ranges)}`;
    if (seen.has(key)) {
      const prev = out.find(
        (x) =>
          `${x.tierRange.join("-")}|${x.pool}|${x.gods?.join("+") ?? ""}|${JSON.stringify(x.ranges)}` === key,
      )!;
      prev.entryIds.push(c.entry.mod_id);
      prev.fuzzy = prev.fuzzy && c.fuzzy;
      continue;
    }
    seen.add(key);
    out.push(cand);
  }
  return out.sort((a, b) => a.tierRange[0] - b.tierRange[0] || a.pool.localeCompare(b.pool));
}

// ---------------------------------------------------------------- 主入口

export function matchReveal(
  ocrLines: OcrTextLine[],
  data: DesecrationData,
  opts: RevealMatchOptions = {},
): RevealMatchResult {
  const lang = opts.lang ?? "zh";
  const idx = ocrIndex(data, lang);
  const lines = prepareLines(ocrLines, data, lang);

  // 幾何分組 → 每組再依語意切段(整組對得上就是一段;幾何切不開的等距單行詞綴在這裡拆開)
  const segs: Seg[] = [];
  for (const g of groupLines(lines)) {
    const parts = segment(g);
    if (parts && parts.length > 1) {
      for (const p of parts) segs.push({ lines: [...p.lines], covers: p.covers, partial: false });
    } else {
      segs.push({ lines: [...g], covers: parts?.[0]?.covers ?? [], partial: !parts });
    }
  }
  // 夾在兩組之間的未命中行自成一組 partial(中間那個選項沒認出也不拆散面板);物品浮窗等由否決規則擋掉
  const sel = selectPanel(bridgeUnmatched(segs, lines), lines.filter((l) => !l.match), lang);
  const panel = sel.panel;
  if (!panel) return sel.veto ? { ok: false, error: "no-panel", lines, veto: sel.veto } : { ok: false, error: "no-panel", lines };

  // 對不上的 CJK 行:貼近某組(中心距 ≤ 分組門檻、x 對齊)就放進該組顯示原文
  const hMed =
    median(panel.filter((g) => !g.bridge).flatMap((g) => g.lines).map((l) => (l.merged ? l.h / 2 : l.h))) || 1;
  const inPanel = new Set(panel.flatMap((g) => g.lines));
  for (const s of lines.filter((l) => !l.match && !inPanel.has(l))) {
    let best: (typeof panel)[number] | null = null;
    let bestD = Infinity;
    for (const g of panel) {
      const gcx = median(g.lines.map(cx));
      if (Math.abs(cx(s) - gcx) > ALIGN_RATIO * hMed) continue;
      for (const l of g.lines) {
        const d = Math.abs(cy(l) - cy(s));
        if (d <= GROUP_GAP_RATIO * hMed && d < bestD) {
          bestD = d;
          best = g;
        }
      }
    }
    if (best) {
      best.lines.push(s);
      best.partial = true;
    }
  }

  // profile
  let profiles: string[] | null = null;
  let profileExact = false;
  let profileSource: "refName" | "category" | "intersection" | "all" = "all";
  if (opts.refName || opts.category) {
    // resolveProfiles 只讀 info.refName 與 category
    const item = { info: { refName: opts.refName ?? "" }, category: opts.category };
    const r = resolveProfiles(item as unknown as Parameters<typeof resolveProfiles>[0], data);
    if (r.profiles.length) {
      profiles = r.profiles;
      profileExact = r.exact;
      profileSource = r.exact ? "refName" : "category";
    }
  }
  if (!profiles && opts.intersectProfiles === false) profiles = idx.allProfiles;
  if (!profiles) {
    // 三個選項屬於同一件物品:每組候選 entry 可擲出的 profile 取交集
    const perGroup = panel
      .filter((s) => s.covers.length)
      .map((s) => new Set(s.covers.flatMap((c) => Object.keys(c.entry.profile_tiers))));
    const inter = perGroup.length
      ? [...perGroup[0]].filter((p) => perGroup.every((set) => set.has(p)))
      : [];
    if (inter.length) {
      profiles = inter;
      profileSource = "intersection";
    } else {
      profiles = idx.allProfiles;
    }
  }

  const groups: RevealGroup[] = panel.map((s) => {
    const sorted = s.lines.sort((a, b) => cy(a) - cy(b));
    return {
      lines: sorted,
      rect: union(sorted),
      candidates: toCandidates(s.covers, profiles!),
      partial: s.partial,
    };
  });
  return { ok: true, groups, profileExact, profileSource };
}
