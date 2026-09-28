import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseClipboard } from "@/parser";
import type { ParsedItem } from "@/parser/ParsedItem";

export const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

/** `UPDATE_FIXTURES=1 npx vitest run` 時改寫快照,而不是比對。 */
export const UPDATE_MODE = process.env.UPDATE_FIXTURES === "1";

export interface Fixture {
  name: string;
  language: string;
  text: string;
  expectedPath: string;
}

export type FixtureOutcome =
  | { kind: "parsed"; item: ParsedItem; snapshot: unknown }
  | { kind: "error"; error: string };

/**
 * **本 fork 維護的語系** —— 繁中是這個 fork 存在的理由,解析它的物品文字是我們的
 * 責任,所以少了樣本就是缺口,必須讓測試紅掉。
 */
export const MAINTAINED_LANGUAGES = ["cmn-Hant"] as const;

/**
 * **上游維護的語系**(Kvan7/Exiled-Exchange-2 的 `renderer/public/data/` 全部語系)。
 * 我們只是沿用,替它們建回歸樣本不是這個 fork 的工作,少了也不算缺口;
 * 但「有樣本就照樣測」是刻意的:哪天補了英文樣本,它就自動納入回歸網。
 */
export const UPSTREAM_LANGUAGES = [
  "en",
  "ru",
  "ko",
  "ja",
  "de",
  "es",
  "pt",
  "fr",
] as const;

export function hasFixtures(language: string): boolean {
  const dir = path.join(FIXTURES_DIR, language);
  return (
    fsSync.existsSync(dir) &&
    fsSync.readdirSync(dir).some((f) => f.endsWith(".txt"))
  );
}

/**
 * 宣告清單裡、磁碟上真的有樣本的語系。
 *
 * ⚠ 判準是**宣告的清單**,不是「掃 fixtures 底下所有子目錄」——子目錄不一定是語系。
 * ⚠ 回空陣列時呼叫端必須自己擋掉,否則後面每一項斷言都會空轉通過。
 */
export function fixtureLanguages(): string[] {
  return [...MAINTAINED_LANGUAGES, ...UPSTREAM_LANGUAGES].filter(hasFixtures);
}

export async function listFixtures(language: string): Promise<Fixture[]> {
  const dir = path.join(FIXTURES_DIR, language);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const out: Fixture[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".txt")) continue;
    const name = entry.slice(0, -".txt".length);
    out.push({
      name,
      language,
      text: await fs.readFile(path.join(dir, entry), "utf8"),
      expectedPath: path.join(dir, `${name}.expected.json`),
    });
  }
  return out;
}

export function runFixture(fixture: Fixture): FixtureOutcome {
  const result = parseClipboard(fixture.text);
  if (result.isErr()) {
    return { kind: "error", error: result.error };
  }
  const item = result.value;
  return { kind: "parsed", item, snapshot: snapshotItem(item) };
}

/**
 * 把 ParsedItem 縮成**可讀、可 review 的**快照。
 *
 * 整份 ParsedItem 直接序列化會夾帶 `info`(含 icon 網址與整張 augment 表)、
 * `rawText`、與 `newMods` 重複的 `statsByType`,幾百行雜訊會把真正的行為差異埋掉。
 * 這裡只保留「解析器決定了什麼」:身分(refName/namespace)、屬性欄、需求、插槽、
 * 每條詞綴的型別/名稱/階層/對到哪個 stat 與 trade id/roll、以及 unknownModifiers。
 */
export function snapshotItem(item: ParsedItem): unknown {
  const anyItem = item as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(anyItem).sort()) {
    const value = anyItem[key];
    if (value === undefined) continue;
    switch (key) {
      case "rawText":
      case "statsByType":
        continue;
      case "info":
        out.info = briefBaseType(value);
        continue;
      case "infoVariants":
        out.infoVariants = Array.isArray(value)
          ? value.map(briefBaseType)
          : value;
        continue;
      case "augmentSockets": {
        const s = value as Record<string, unknown>;
        out.augmentSockets = stableSnapshot({
          ...s,
          augments: Array.isArray(s.augments)
            ? s.augments.map((a) => {
                // 沒有鑲嵌符文的插槽在陣列裡是 null,原樣保留
                if (a == null) return a;
                const aug = a as Record<string, unknown>;
                return {
                  existing: aug.existing,
                  name: aug.name,
                  refName: aug.refName,
                  displayString: aug.displayString,
                };
              })
            : s.augments,
        });
        continue;
      }
      case "newMods":
        out.newMods = (value as ParsedItem["newMods"]).map((mod) => ({
          info: stableSnapshot(mod.info),
          stats: mod.stats.map((s) =>
            stableSnapshot({
              ref: s.stat.ref,
              tradeIds: s.stat.trade.ids,
              translation: s.translation.string,
              roll: s.roll,
            }),
          ),
        }));
        continue;
      default:
        out[key] = stableSnapshot(value);
    }
  }
  return out;
}

function briefBaseType(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const info = value as Record<string, unknown>;
  return stableSnapshot({
    name: info.name,
    refName: info.refName,
    namespace: info.namespace,
    unique: info.unique,
  });
}

/**
 * 鍵順序固定的純資料。不排序鍵的話,parser 裡挪動一行賦值就會產生整份 diff。
 * `undefined` 一併移除,因為 JSON 沒有這個值。
 */
export function stableSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSnapshot);
  }
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      if (src[key] === undefined) continue;
      out[key] = stableSnapshot(src[key]);
    }
    return out;
  }
  return value;
}

export async function readExpected(
  fixture: Fixture,
): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(fixture.expectedPath, "utf8"));
  } catch {
    return undefined;
  }
}

export async function writeExpected(
  fixture: Fixture,
  snapshot: unknown,
): Promise<void> {
  await fs.writeFile(
    fixture.expectedPath,
    JSON.stringify(snapshot, null, 2) + "\n",
    "utf8",
  );
}

export interface SnapshotDiff {
  field: string;
  expected: unknown;
  actual: unknown;
}

/** 逐欄比對,回報**路徑**而不是整份物件。 */
export function diffSnapshots(
  expected: unknown,
  actual: unknown,
  at = "",
): SnapshotDiff[] {
  if (Object.is(expected, actual)) return [];

  const bothObjects =
    expected !== null &&
    typeof expected === "object" &&
    actual !== null &&
    typeof actual === "object" &&
    Array.isArray(expected) === Array.isArray(actual);
  if (!bothObjects) {
    return [{ field: at || "(根)", expected, actual }];
  }

  const keys = new Set([
    ...Object.keys(expected as object),
    ...Object.keys(actual as object),
  ]);
  const out: SnapshotDiff[] = [];
  for (const key of [...keys].sort()) {
    const childPath = Array.isArray(expected)
      ? `${at}[${key}]`
      : at
        ? `${at}.${key}`
        : key;
    out.push(
      ...diffSnapshots(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        childPath,
      ),
    );
  }
  return out;
}

export function formatDiff(diffs: SnapshotDiff[]): string {
  const shown = diffs.slice(0, 12);
  const lines = shown.map(
    (d) =>
      `  ${d.field}\n` +
      `      期望: ${brief(d.expected)}\n` +
      `      實際: ${brief(d.actual)}`,
  );
  if (diffs.length > shown.length) {
    lines.push(`  …另有 ${diffs.length - shown.length} 處`);
  }
  return lines.join("\n");
}

function brief(value: unknown): string {
  if (value === undefined) return "(不存在)";
  const text = JSON.stringify(value);
  return text !== undefined && text.length > 120
    ? text.slice(0, 120) + "…"
    : String(text);
}
