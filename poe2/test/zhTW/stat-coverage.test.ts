import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setupTests } from "@specs/vitest.setup";
import { init, loadForLang } from "@/assets/data";
import { tryParseTranslation } from "@/parser/stat-translations";
import { ModifierType } from "@/parser/modifiers";

/**
 * 詞綴表全量稽核。
 *
 * 為什麼需要它:一條詞綴對不上時 parser **不會報錯**,只是把它丟進
 * `unknownModifiers`,查價面板少一條、查詢少一個條件,使用者只看得到「查不到」。
 * 靠使用者一件一件回報找 bug 太慢,所以這裡反過來:拿資料集自己的 matcher 合成
 * 遊戲會印出的文字,逐條餵回 parser,對不回原本那條 stat 的就是缺陷。
 *
 * 這抓得到的是「資料集有、但 parser 讀不到」的詞綴(例如 matcher 把正負號寫成
 * 字面值 `技能上限+#`,而 parser 會把 `+1` 整個吃成 `#`)。抓不到「資料集根本
 * 沒有」的詞綴 —— 那要拿 GGPK 比對,不在這支測試的範圍。
 *
 * ⚠ 判準是**已知缺陷清單不得增加**,不是「必須為零」:殘留的都是上游限制,
 *   逐條寫在 KNOWN_UNREACHABLE 裡並註明原因。新增一條就是退步。
 */

/**
 * 全部出貨語系都跑。繁中是本 fork 的責任,英文是上游的來源語言 —— 這兩個必須
 * 零缺陷;其餘語系只記基準數字,只准變少不准變多(修不修是上游的事,但退步要看得見)。
 */
// exile-appraiser: 本 app 只出貨 cmn-Hant / en 兩個語系的資料(data/poe2/),另外 7 個語系不在 repo 裡。
// 兩個都屬 MUST_BE_CLEAN(零缺陷),所以覆蓋的判準沒有放鬆;上游「其他語系只准變少」那一條不適用,已移除。
const LANGUAGES = [
  "cmn-Hant",
  "en",
] as const;
const MUST_BE_CLEAN = ["cmn-Hant", "en"];
// exile-appraiser: 資料在 repo 根 data/poe2(上游是 renderer/public/data)
const DATA_ROOT = path.resolve(__dirname, "../../../data/poe2");

/** 合成用數字。避開 0/1,免得和 matcher 自帶的 `value` 選項值混淆。 */
const FILLERS = [13, 27, 41, 58];

interface RawMatcher {
  string: string;
  advanced?: string;
  negate?: boolean;
  value?: number;
}
interface RawStat {
  ref: string;
  matchers: RawMatcher[];
  trade: { ids?: Record<string, string[]> };
}

/**
 * parser 一次最多只處理 4 個數值(`PLACEHOLDER_MAP` 到 4 為止),再多就只剩
 * 「整句原文」那條退路。這是上游的既有上限,不是本語系的缺陷。
 */
const MAX_PLACEHOLDERS = 4;

// exile-appraiser: 上游 KNOWN_BROKEN_COUNT(ru/ko/ja/de/es/pt/fr 各 0)與「其他語系只准變少」測試已移除——
// 那 7 個語系的資料不隨本 app 出貨。

function loadStats(lang: string): RawStat[] {
  return fs
    .readFileSync(path.join(DATA_ROOT, lang, "stats.ndjson"), "utf8")
    .split("\n")
    .filter((line) => line.length)
    .map((line) => JSON.parse(line) as RawStat);
}

/** 把 matcher 還原成遊戲會印出的一行。 */
function synthesize(matcher: string): string {
  let idx = -1;
  return matcher.replace(/#/g, () => {
    idx += 1;
    return String(FILLERS[idx % FILLERS.length]);
  });
}

/** 這條 stat 是從物品文字讀來的,還是我們自己合成的偽屬性? */
function readFromItemText(stat: RawStat): ModifierType | undefined {
  const ids = stat.trade.ids ?? {};
  // 優先用 explicit,其次照常見程度;`pseudo` 不算——偽屬性由程式合成,
  // 不會出現在剪貼簿裡。
  for (const key of [
    "explicit",
    "implicit",
    "fractured",
    "crafted",
    "enchant",
    "rune",
    "desecrated",
    "sanctum",
    "skill",
  ]) {
    if (ids[key]?.length) return key as ModifierType;
  }
  return undefined;
}

interface Case {
  ref: string;
  modType: ModifierType;
  matcher: string;
  line: string;
}

interface Audit {
  checked: number;
  failures: Array<Case & { got: string }>;
  skippedTooManyValues: number;
}

const audits = new Map<string, Audit>();

function auditLoadedLanguage(lang: string): Audit {
  const stats = loadStats(lang);
  const audit: Audit = { checked: 0, failures: [], skippedTooManyValues: 0 };

  // 同一句話對到兩條 stat 時,parser 只可能回其中一條——那不是缺陷。
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const stat of stats) {
    for (const m of stat.matchers) {
      for (const text of [m.string, m.advanced].filter(Boolean) as string[]) {
        if (seen.has(text)) shared.add(text);
        seen.add(text);
      }
    }
  }

  for (const stat of stats) {
    const modType = readFromItemText(stat);
    if (!modType) continue;

    for (const m of stat.matchers) {
      for (const text of [m.string, m.advanced].filter(Boolean) as string[]) {
        if (shared.has(text)) continue;
        if ((text.match(/#/g)?.length ?? 0) > MAX_PLACEHOLDERS) {
          audit.skippedTooManyValues += 1;
          continue;
        }

        const line = synthesize(text);
        audit.checked += 1;
        const found = tryParseTranslation(
          { string: line, unscalable: false },
          modType,
          undefined,
        );
        if (found?.stat.ref !== stat.ref) {
          audit.failures.push({
            ref: stat.ref,
            modType,
            matcher: text,
            line,
            got: found ? found.stat.ref : "(解析不到)",
          });
        }
      }
    }
  }
  return audit;
}

function report(audit: Audit, limit = 30): string {
  const shown = audit.failures.slice(0, limit);
  return (
    `${audit.failures.length} 條詞綴 parser 讀不回來(列前 ${shown.length} 條):\n` +
    shown
      .map(
        (f) =>
          `  ${f.matcher}\n` +
          `      合成: ${f.line}\n` +
          `      期望: ${f.ref}\n` +
          `      實際: ${f.got}`,
      )
      .join("\n")
  );
}

beforeAll(async () => {
  // ⚠ 語系資料是模組層級全域,不能同時載入兩個,只能逐一切換。
  setupTests({ language: LANGUAGES[0] });
  await init(LANGUAGES[0]);
  for (const lang of LANGUAGES) {
    await loadForLang(lang);
    audits.set(lang, auditLoadedLanguage(lang));
  }
}, 300_000);

describe("詞綴表全量稽核", () => {
  it("稽核真的跑過夠多條目", () => {
    // 空轉通過比沒有測試更危險
    console.log(
      "詞綴稽核覆蓋:\n" +
        LANGUAGES.map((lang) => {
          const a = audits.get(lang)!;
          return `  ${lang.padEnd(9)} 檢查 ${String(a.checked).padStart(5)} 條 · 失敗 ${a.failures.length} · 數值過多略過 ${a.skippedTooManyValues}`;
        }).join("\n"),
    );
    for (const lang of LANGUAGES) {
      expect(audits.get(lang)!.checked, lang).toBeGreaterThan(2000);
    }
  });

  for (const lang of MUST_BE_CLEAN) {
    it(`${lang}:每一條 matcher 都能被 parser 讀回原本那條詞綴`, () => {
      const audit = audits.get(lang)!;
      expect(
        audit.failures.map((f) => f.matcher),
        audit.failures.length === 0 ? "" : report(audit),
      ).toEqual([]);
    });
  }

});
