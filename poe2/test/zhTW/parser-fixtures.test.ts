import { beforeAll, describe, expect, it } from "vitest";
import { setupTests } from "@specs/vitest.setup";
import type { Config } from "@/web/Config";
import { init, loadForLang } from "@/assets/data";
import {
  diffSnapshots,
  fixtureLanguages,
  formatDiff,
  hasFixtures,
  listFixtures,
  readExpected,
  runFixture,
  writeExpected,
  MAINTAINED_LANGUAGES,
  UPDATE_MODE,
  type Fixture,
  type FixtureOutcome,
} from "./helpers/fixture-harness";

/**
 * 繁中 fork 的解析器回歸網。
 *
 * 為什麼需要它:解析器每個賽季都得跟著 GGG 改措辭,而**改壞既有物品是靜默的**——
 * 認不出來的詞綴會被收進 `unknownModifiers` 而不是拋錯,所以型別檢查、lint、
 * 建置全部照樣綠。唯一擋得住退步的方式是拿真實剪貼簿文字跑一遍、與人工核可過的
 * 快照逐欄比對。
 *
 * 樣本:`specs/zhTW/fixtures/<語系>/<名稱>.txt`(遊戲內 Ctrl+Alt+C 的原文,不可手改)
 *       `…/<名稱>.expected.json`(快照)
 * 更新快照:`UPDATE_FIXTURES=1 npx vitest run specs/zhTW`
 * ⚠ **產生的快照必須人工 review 後才可 commit。** 盲目更新等於把回歸網拆掉。
 * ⚠ 跑之前要先 `npm run make-index-files`,否則所有物品都會是 item.unknown。
 *
 * ⚠ 多個語系的資料集**不能同時載入**(`assets/data/index.ts` 是模組層級全域變數),
 *   所以在 beforeAll 裡逐一切換、跑完一個語系才換下一個。
 */

const MISSING_MAINTAINED = MAINTAINED_LANGUAGES.filter((l) => !hasFixtures(l));
const COVERED = fixtureLanguages();

/**
 * 樣本解析不了、而且**不是 parser 修得動的** —— 上游出貨的資料集缺東西。
 * 樣本仍然留著:資料補上的那天這裡會變紅,提醒把條目移掉。
 */
const KNOWN_DATASET_GAPS: Record<string, string> = {};

/**
 * 樣本解析得了,但某幾行讀不出來(同樣是資料缺口)。少一行就少一個查詢條件。
 */
const KNOWN_UNKNOWN_LINES: Record<string, string[]> = {};

interface LanguageRun {
  fixtures: Fixture[];
  results: Array<{ fixture: Fixture; outcome: FixtureOutcome }>;
}

const runs = new Map<string, LanguageRun>();

beforeAll(async () => {
  const first = (COVERED[0] ?? "en") as Config["language"];
  setupTests({ language: first });
  await init(first);
  for (const language of COVERED) {
    await loadForLang(language);
    const fixtures = await listFixtures(language);
    runs.set(language, {
      fixtures,
      results: fixtures.map((fixture) => ({
        fixture,
        outcome: runFixture(fixture),
      })),
    });
  }
}, 180_000);

describe("corpus 覆蓋範圍", () => {
  it("本 fork 維護的語系都有樣本", () => {
    expect(
      MISSING_MAINTAINED,
      MISSING_MAINTAINED.length === 0
        ? ""
        : `這些是本 fork 維護的語系,少了 fixture 等於沒有回歸保護:${MISSING_MAINTAINED.join(", ")}`,
    ).toEqual([]);
  });
});

for (const language of COVERED) {
  describe(`parser fixtures:${language}`, () => {
    const run = (): LanguageRun => {
      const value = runs.get(language);
      if (value === undefined)
        throw new Error(`${language} 的 corpus 尚未載入`);
      return value;
    };

    it("這個語系的 corpus 非空", () => {
      expect(run().fixtures.length).toBeGreaterThan(0);
    });

    it("全部 fixture 都能解析(已知資料缺口除外)", () => {
      const failed = run()
        .results.filter((r) => r.outcome.kind !== "parsed")
        .map(
          (r) => `${r.fixture.name}: ${(r.outcome as { error: string }).error}`,
        );
      const unexpected = failed.filter(
        (line) => !(line.split(":")[0] in KNOWN_DATASET_GAPS),
      );

      expect(
        unexpected,
        unexpected.length === 0
          ? ""
          : `以下 ${unexpected.length} 件解析失敗:\n  ` +
              unexpected.join("\n  "),
      ).toEqual([]);
    });

    it("已知資料缺口清單沒有殘留已修好的條目", () => {
      // 補上資料之後忘了移除,會讓真的退步躲過回歸網
      const stillBroken = Object.keys(KNOWN_DATASET_GAPS).filter((name) =>
        run().results.some(
          (r) => r.fixture.name === name && r.outcome.kind !== "parsed",
        ),
      );
      const listed = Object.keys(KNOWN_DATASET_GAPS).filter((name) =>
        run().fixtures.some((f) => f.name === name),
      );
      expect(stillBroken).toEqual(listed);
    });

    it("快照與 *.expected.json 相符", async () => {
      const mismatches: string[] = [];

      for (const { fixture, outcome } of run().results) {
        if (outcome.kind !== "parsed") continue;

        if (UPDATE_MODE) {
          await writeExpected(fixture, outcome.snapshot);
          continue;
        }

        const expectedSnapshot = await readExpected(fixture);
        if (expectedSnapshot === undefined) {
          mismatches.push(
            `${fixture.name}: 缺少快照(用 UPDATE_FIXTURES=1 產生後人工 review)`,
          );
          continue;
        }

        const diffs = diffSnapshots(expectedSnapshot, outcome.snapshot);
        if (diffs.length > 0) {
          mismatches.push(
            `${fixture.name}:${diffs.length} 處欄位不符\n${formatDiff(diffs)}`,
          );
        }
      }

      if (UPDATE_MODE) return;
      expect(mismatches, mismatches.join("\n\n")).toEqual([]);
    });

    it("未知詞綴被收集而非導致解析失敗", () => {
      for (const { fixture, outcome } of run().results) {
        if (outcome.kind !== "parsed") continue;
        expect(
          Array.isArray(outcome.item.unknownModifiers),
          `${fixture.name} 的 unknownModifiers 不是陣列`,
        ).toBe(true);
      }
    });

    it("除了已知資料缺口,樣本不該有讀不出來的詞綴", () => {
      // 未知詞綴是靜默的:面板少一行、查詢少一個條件,不會有任何錯誤訊息
      const unexpected: string[] = [];
      for (const { fixture, outcome } of run().results) {
        if (outcome.kind !== "parsed") continue;
        const allowed = KNOWN_UNKNOWN_LINES[fixture.name] ?? [];
        for (const mod of outcome.item.unknownModifiers) {
          if (!allowed.includes(mod.text)) {
            unexpected.push(`${fixture.name}: ${mod.text}`);
          }
        }
      }
      expect(unexpected, unexpected.join("\n  ")).toEqual([]);
    });
  });
}
