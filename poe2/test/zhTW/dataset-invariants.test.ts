import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 資料集不變式。
 *
 * 為什麼需要它:`stat-coverage.test.ts` 是拿資料集自己的 matcher 餵回 parser,
 * 所以它只看得到「資料集有、但 parser 讀不到」。**資料集根本沒有**的詞綴它一條
 * 都抓不到 —— 而那正是繁中最常見的缺口:英文那邊有條目、繁中沒有,遊戲裡那一行
 * 就永遠進 `unknownModifiers`,面板少一條、查詢少一個條件,沒有任何錯誤訊息。
 *
 * 這支測試純讀 `public/data/*.ndjson`,不載入資料層、不打網路,所以跑得很快,
 * 可以當成每次改資料後的第一道關卡。
 *
 * ⚠ 判準是**棘輪**:缺口逐條列在 KNOWN_STAT_GAPS 並寫明原因。補好一條就要把它
 *   從清單移掉(清單裡卻已經補好的條目會讓測試紅),漏補一條則會多出未列項。
 */

// exile-appraiser: 資料在 repo 根 data/poe2(上游是 renderer/public/data)
const DATA = path.resolve(__dirname, "../../../data/poe2");

interface Stat {
  ref: string;
  id?: string;
  matchers: Array<{ string: string; advanced?: string }>;
  trade: { ids?: Record<string, string[]> };
}

/**
 * 語言無關的對接鍵:上游自己的 `ref`(全庫唯一,各語系共用同一個英文字串)。
 * ⚠ 不可以用 `id`:傳奇珠寶的種子詞綴八列共用同一個 id,只差在選項。
 */
const keyOf = (stat: Stat): string => stat.ref;

function readStats(lang: string): Stat[] {
  return fs
    .readFileSync(path.join(DATA, lang, "stats.ndjson"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Stat);
}

/**
 * 英文有、繁中還沒有的 stat。每一條都要寫**為什麼補不了** —— 沒有理由的條目
 * 等於沒被查證過。補法見 `tools-local/fill-zh-data.mjs`(GGPK → 繁中,只留本地)。
 */
const KNOWN_STAT_GAPS: Record<string, string> = {
  // GGG 自己把「武器本身的」與「全域的」兩條翻成同一句繁中,所以上游把兩條併成
  // 一條 —— **被併掉那條的交易 id 掛在留下來的條目上,查詢不會少送**,不是真缺口。
  // 硬加回來反而會讓 `STAT_BY_MATCH_STR` 只查得到其中一條,另一條永遠不可達。
  "#% chance to cause Bleeding on Hit":
    "繁中「擊中時有#%機率造成流血」與 base_chance_to_inflict_bleeding_% 逐字相同;四個群組的 id 都已掛在那條上",
  "Causes #% increased Stun Buildup":
    "繁中「增加#%暈眩累積」與 hit_damage_stun_multiplier_+% 逐字相同",
  "Grants # Rage on Hit":
    "繁中「擊中時獲得#層盛怒」與 base_gain_x_rage_on_hit 逐字相同;兩個群組的 id 都已掛在那條上",
  "Allies in your Presence Regenerate #% of your Maximum Life per second":
    "繁中「處於你的存在範圍中的友方每秒回復#%最大生命」與既有 matcher 逐字相同",

  // 三邊都查不到繁中譯文的那一條。⚠ 這裡的判準是「客戶端印什麼」,不是「有沒有中文」:
  //   國際服交易站寫英文、台服交易站寫「汙染的結果總會是改變」、GGPK 沒收錄,
  //   而使用者跑的是國際服客戶端 —— 遊戲裡到底印哪一個沒有證人可查。
  //   補錯的 matcher 比缺一條更糟(會永遠對不上),所以等一件實物文字。
  "Corrupting will always result in change":
    "國際服交易站寫英文、台服寫中文、GGPK 沒有;客戶端印哪個待實物佐證",
};

describe("資料集不變式", () => {
  const en = readStats("en");
  const zh = readStats("cmn-Hant");
  const zhByKey = new Map(zh.map((stat) => [keyOf(stat), stat]));

  const gaps = en.filter((stat) => !zhByKey.has(keyOf(stat)));
  const reasonFor = (stat: Stat): string | undefined =>
    KNOWN_STAT_GAPS[keyOf(stat)];

  it("英文有的 stat,繁中都有(已知缺口除外)", () => {
    const unexpected = gaps
      .filter((stat) => reasonFor(stat) === undefined)
      .map((stat) => `${keyOf(stat)}  —  ${stat.ref}`);
    expect(
      unexpected,
      unexpected.length === 0
        ? ""
        : `繁中少了以下 ${unexpected.length} 條(遊戲裡這些行會讀不出來):\n  ` +
            unexpected.join("\n  "),
    ).toEqual([]);
  });

  it("已知缺口清單沒有殘留已補好的條目", () => {
    const stillMissing = new Set(gaps.map(keyOf));
    const stale = Object.keys(KNOWN_STAT_GAPS).filter(
      (key) => !stillMissing.has(key),
    );
    expect(
      stale,
      stale.length === 0
        ? ""
        : `這些已經補好了,請從清單移除:${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("英文的交易 id,繁中一個都不能少", () => {
    // 交易 id 是語言無關的,同一條 stat 在哪個語系都該送同一批。少一個群組不會
    // 報錯,只會讓那個 modType 的詞綴靜默消失(`tryParseTranslation` 的
    // `realType in trade.ids` 守門)—— 面板少一行、查詢少一個條件。
    //
    // 反過來**允許繁中多出 id**:上游把譯文逐字相同的兩條合併,被併掉那條的 id
    // 就掛在留下來的條目上。
    const missing: string[] = [];
    for (const stat of en) {
      const other = zhByKey.get(keyOf(stat));
      if (!other) continue;
      for (const [group, ids] of Object.entries(stat.trade.ids ?? {})) {
        const have = other.trade.ids?.[group] ?? [];
        const lost = ids.filter((id) => !have.includes(id));
        if (lost.length)
          missing.push(`${keyOf(stat)}  ${group}  ${lost.join(", ")}`);
      }
    }
    expect(
      missing,
      missing.length === 0
        ? ""
        : `繁中少了以下交易 id(這些詞綴在遊戲裡會讀不出來):\n  ` +
            missing.join("\n  "),
    ).toEqual([]);
  });

  it("缺圖示的項目不得增加", () => {
    // 上游的 dataParser 找不到圖示時寫 `%NOT_FOUND%`,畫面上是一塊洋紅/黑格子。
    // 圖示網址尾端那段雜湊是伺服器簽的,自己拼一定 404,只能從真實掛單讀回來,
    // 所以這裡是**棘輪**:數字只准變小。補法見 scratchpad 的 fetch-base-icon.mjs。
    const BASELINE = 444;
    for (const lang of ["en", "cmn-Hant"]) {
      const items = fs
        .readFileSync(path.join(DATA, lang, "items.ndjson"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { icon?: string });
      const missing = items.filter((i) => i.icon === "%NOT_FOUND%").length;
      expect(
        missing,
        `${lang} 缺圖示 ${missing} 筆,基準是 ${BASELINE};` +
          (missing > BASELINE
            ? "變多了,是退步"
            : "補好了就把 BASELINE 一起改小"),
      ).toBe(BASELINE);
    }
  });

  for (const lang of ["en", "cmn-Hant"]) {
    it(`${lang}:每條 stat 都有 matcher`, () => {
      const empty = readStats(lang)
        .filter((stat) => !stat.matchers?.length)
        .map(keyOf);
      expect(empty).toEqual([]);
    });

    it(`${lang}:資料檔行尾一致`, () => {
      // `*.index.bin` 記的是**位元組位移**,行尾混用會讓索引整批對到錯的行。
      for (const file of ["stats.ndjson", "items.ndjson"]) {
        const raw = fs.readFileSync(path.join(DATA, lang, file));
        let crlf = 0;
        let lf = 0;
        for (let i = 1; i < raw.length; i += 1) {
          if (raw[i] === 0x0a) raw[i - 1] === 0x0d ? (crlf += 1) : (lf += 1);
        }
        expect(
          Math.min(crlf, lf),
          `${lang}/${file} 行尾混用:CRLF ${crlf} 行、LF ${lf} 行`,
        ).toBe(0);
      }
    });
  }
});
