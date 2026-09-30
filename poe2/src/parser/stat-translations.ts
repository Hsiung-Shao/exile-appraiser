import {
  CLIENT_STRINGS as _$,
  CLIENT_STRINGS_REF as _$REF,
  STAT_BY_MATCH_STR,
  StatBetter,
  TRADE_STAT_BY_MATCH_STR,
} from "@/assets/data";
import type { StatMatcher, Stat, BaseType } from "@/assets/data";
import { ModifierType } from "./modifiers";
import { ItemCategory } from "./meta";
import { STAT_VALUE_RE } from "./stat-value-re"; // exile-appraiser(WP-S):regex 字面搬到零依賴模組

// This file is a little messy and scary,
// but that's how stats translations are parsed :-D

const LOCALIZED_PAREN_LEFT = /^\s*(?:\(|（)/;
const LOCALIZED_PAREN_RIGHT = /(?:\)|）)\s*$/;

export interface ParsedStat {
  readonly stat: Stat;
  readonly translation: StatMatcher;
  roll?: {
    unscalable: boolean;
    legacy?: true;
    dp: boolean;
    value: number;
    min: number;
    max: number;
    option?: number;
  };
  fromAddedAugment?: BaseType;
}

interface StatString {
  string: string;
  unscalable: boolean;
}

export function* linesToStatStrings(
  lines: string[],
): Generator<StatString, string[], boolean> {
  const notParsedLines: string[] = [];

  let reminderString = false;

  outer: for (let start = 0; start < lines.length; start += 1) {
    if (lines[start].match(LOCALIZED_PAREN_LEFT)) {
      reminderString = true;
    }
    if (reminderString && lines[start].match(LOCALIZED_PAREN_RIGHT)) {
      reminderString = false;
      continue;
    }
    if (reminderString) {
      continue;
    }

    for (let end = start; end < lines.length; end += 1) {
      let str = lines.slice(start, end + 1).join("\n");

      const unscalable = str.endsWith(_$.UNSCALABLE_VALUE);
      if (unscalable) {
        str = str.slice(0, -_$.UNSCALABLE_VALUE.length);
      }

      const isParsed: boolean = yield { string: str, unscalable };
      if (isParsed) {
        start += end - start;
        continue outer;
      }
    }
    notParsedLines.push(lines[start]);
  }
  return notParsedLines.filter((line) => line.length);
}

const PLACEHOLDER_MAP = [
  // 0 # -> max 0 #
  [[]],
  // 1 # -> max 1 #
  [[0], []],
  // 2 # -> max 2 #
  [[0, 1], [0], [1], []],
  // 3 # -> max 2 #
  [[0, 1, 2], [1, 2], [0, 2], [0, 1], [2], [1], [0], []],
  // 4 # -> max 2 #
  [
    [0, 1, 2, 3],
    [1, 2, 3],
    [0, 2, 3],
    [0, 1, 3],
    [0, 1, 2],
    [2, 3],
    [1, 3],
    [1, 2],
    [0, 3],
    [0, 2],
    [0, 1],
    [3],
    [2],
    [1],
    [0],
    [],
  ],
];

/**
 * exile-appraiser(WP-S):數值(含進階格式的 `(lo-hi)`)的 regex,抽成 export 給
 * `desecration/ocr-match.ts` 重用;字面與旗標與原本內嵌的完全相同(`String.replace` 對 /g regex 每次從頭,行為不變)。
 * exile-appraiser(WP-S 兩段式):字面搬到零依賴的 `./stat-value-re`(main process 的面板定位也要 import),這裡 re-export。
 */
export { STAT_VALUE_RE };

function* _statPlaceholderGenerator(stat: string) {
  const matches: Array<{
    roll: number;
    rollStr: string;
    decimal: boolean;
    bounds?: { min: number; max: number };
  }> = [];
  const withPlaceholders = stat
    .replace(/\(\)/gm, "") // when GGG didn't provide advanced desc, like in "Passives in Radius of Wicked Ward() can be Allocated"
    .replace(
      STAT_VALUE_RE, // exile-appraiser(WP-S):原本的 regex 字面,抽成 export
      (_, roll: string, min?: string, max?: string) => {
        if (min != null && max == null) {
          // example: Sextant "# uses remaining", legacy rolls
          max = min;
        }

        const captured: (typeof matches)[number] = {
          roll: Number(roll),
          rollStr: roll,
          decimal:
            roll.includes(".") ||
            min?.includes(".") ||
            max?.includes(".") ||
            false,
          bounds: { min: Number(min), max: Number(max) },
        };
        matches.push(captured);

        if (
          Number.isNaN(captured.bounds!.min) ||
          Number.isNaN(captured.bounds!.max)
        ) {
          captured.bounds = undefined;
          return min != null ? `#(${min}-${max})` : "#";
        } else {
          return "#";
        }
      },
    );

  type Combination = {
    stat: string;
    values: Array<
      Pick<(typeof matches)[number], "roll" | "bounds" | "decimal">
    >;
  };

  /**
   * Every way of keeping some rolls literal and turning the rest into `#`.
   *
   * The sign is ambiguous: it can belong to the value or to the description,
   * and the data is not consistent about it, so each reading gets its own pass.
   *
   *  - "plain"    the sign belongs to the value (the common case).
   *  - "sign-in-template"  the description keeps it as a literal ("Skills have
   *    +# to Limit", 技能上限+#, 每10最大符文保護-#偏斜值). Re-emit it and hand
   *    over the magnitude; a "-" variant carries `negate` in the data, which
   *    puts the sign back on the roll.
   *  - "unsigned-literal"  the description spells the roll out but without its
   *    sign ("+100% of Armour also applies to Lightning Damage" is stored as
   *    "100% of Armour also applies to Lightning Damage").
   *
   * Without the last two passes those lines can never match and silently end
   * up in unknownModifiers.
   */
  type SignMode = "plain" | "sign-in-template" | "unsigned-literal";

  function* combinations(mode: SignMode): Generator<Combination> {
    if (matches.length >= PLACEHOLDER_MAP.length) return;

    for (const replacements of PLACEHOLDER_MAP[matches.length]) {
      let idx = -1;
      const replaced = withPlaceholders.replace(/#/gm, () => {
        idx += 1;
        const { rollStr } = matches[idx];
        if (replacements.includes(idx)) {
          return mode === "unsigned-literal"
            ? rollStr.replace(/^[+-]/, "")
            : rollStr;
        }
        const sign =
          mode === "sign-in-template" ? /^[+-]/.exec(rollStr)?.[0] : null;
        return sign ? `${sign}#` : "#";
      });

      const values = matches.filter((_, idx) => !replacements.includes(idx));
      yield {
        stat: replaced,
        values:
          mode === "sign-in-template"
            ? values.map((m) => ({
                roll: Math.abs(m.roll),
                decimal: m.decimal,
                bounds: m.bounds && {
                  min: Math.abs(m.bounds.min),
                  max: Math.abs(m.bounds.max),
                },
              }))
            : values,
      };
    }
  }

  yield* combinations("plain");

  // fallback to exact stat text, without any placeholders
  // N # -> max 0 #
  yield { stat, values: [] };

  if (matches.some((m) => /^[+-]/.test(m.rollStr))) {
    yield* combinations("sign-in-template");
    yield* combinations("unsigned-literal");
  }

  // Last resort: drop *textual* ranges from advanced descriptions. The
  // Traditional Chinese client prints Mageblood's legacies as
  // "水銀(紫晶-黃玉)之遺" and a jewel's ring size as
  // "只會影響中至大範圍內的天賦（極小-巨大範圍）" — the range names what the mod
  // could have rolled, while the dataset only knows the plain option text.
  // Both half- and full-width brackets appear; digits are excluded so numeric
  // rolls handled above are never touched.
  const withoutTextRanges = stat.replace(
    /[(（][^()（）\d]+-[^()（）\d]+[)）]/g,
    "",
  );
  if (withoutTextRanges !== stat) {
    yield { stat: withoutTextRanges, values: [] };
  }
}

export function tryParseTranslation(
  stat: StatString,
  modType: ModifierType,
  itemCategory: ItemCategory | undefined,
): ParsedStat | undefined {
  let backupParsedStat: ParsedStat | undefined;
  let backupParsedCombination;

  for (const combination of _statPlaceholderGenerator(stat.string)) {
    const found = findAndResolveTranslation({
      matchStr: combination.stat,
      modType: modType,
      itemCategory: itemCategory,
      roll:
        combination.values.length === 1
          ? combination.values[0].roll
          : undefined,
    });
    const realType =
      modType === ModifierType.AddedAugment ? ModifierType.Augment : modType;
    if (
      !found ||
      ((!found.stat.trade.ids || !(realType in found.stat.trade.ids)) &&
        !found.stat.ref.startsWith(_$REF.GRANTS_SKILL))
    ) {
      if (backupParsedStat) {
        continue;
      }

      backupParsedStat = trySecondaryParseTranslation(combination.stat);
      if (backupParsedStat) {
        backupParsedCombination = combination;
      }
      continue;
    }

    // Modifiers must be upgraded to the new values with a Divine Orb
    const roll = parseRoll(found, combination, stat);

    return {
      stat: found.stat,
      translation: found.matcher,
      roll,
    };
  }
  if (backupParsedStat) {
    backupParsedStat.roll = parseRoll(
      { stat: backupParsedStat.stat, matcher: backupParsedStat.translation },
      backupParsedCombination!,
      stat,
    );
    return backupParsedStat;
  }
}

function parseRoll(
  found: { matcher: StatMatcher; stat: Stat },
  combination: {
    stat: string;
    values: Array<
      Pick<
        {
          roll: number;
          rollStr: string;
          decimal: boolean;
          bounds?: { min: number; max: number };
        },
        "roll" | "bounds" | "decimal"
      >
    >;
  },
  stat: StatString,
): ParsedStat["roll"] {
  let legacyStatRolls = false;

  if (found.matcher.negate) {
    for (const stat of combination.values) {
      stat.roll *= -1;
      if (stat.bounds) {
        stat.bounds.min *= -1;
        stat.bounds.max *= -1;
      }
    }
  }

  if (found.stat.ref === "# uses remaining") {
    const uses = combination.values[0];
    uses.bounds = {
      min: 1,
      max: uses.bounds?.max ?? uses.roll,
    };
  }

  for (const stat of combination.values) {
    if (!stat.bounds) continue;

    if (stat.bounds.min > stat.bounds.max) {
      // some stats granted by legacy Modifiers (not legacy rolls)
      // can have same stat translations as granted by new Modifiers
      // but swapped translation strings for positive and negative rolls
      stat.bounds = {
        max: stat.bounds.min,
        min: stat.bounds.max,
      };
      // don't consider them as a legacy rolls
    }

    if (stat.roll > stat.bounds.max) {
      stat.bounds.max = stat.roll;
      legacyStatRolls = true;
    }
    if (stat.roll < stat.bounds.min) {
      stat.bounds.min = stat.roll;
      legacyStatRolls = true;
    }
  }

  if (!combination.values.length && found.matcher.value) {
    combination.values = [
      {
        roll: found.matcher.value,
        decimal: false,
        bounds: {
          min: found.matcher.value,
          max: found.matcher.value,
        },
      },
    ];
  }

  if (!combination.values.length) {
    return undefined;
  }

  const roll: {
    unscalable: boolean;
    legacy: true | undefined;
    dp: boolean;
    value: number;
    min: number;
    max: number;
    option?: number;
  } = {
    unscalable: stat.unscalable,
    legacy: legacyStatRolls || undefined,
    dp: found.stat.dp || combination.values.some((stat) => stat.decimal),
    value: getRollOrMinmaxAvg(combination.values.map((stat) => stat.roll)),
    min: getRollOrMinmaxAvg(
      combination.values.map((stat) => stat.bounds?.min ?? stat.roll),
    ),
    max: getRollOrMinmaxAvg(
      combination.values.map((stat) => stat.bounds?.max ?? stat.roll),
    ),
    option: found.matcher.value,
  };
  return roll;
}

export function getRollOrMinmaxAvg(values: number[]): number {
  if (values.length === 4) {
    return (values[0] + values[1] + values[2] + values[3]) / 4;
  }
  if (values.length === 2) {
    return (values[0] + values[1]) / 2;
  } else {
    return values[0];
  }
}

function trySecondaryParseTranslation(stat: string): ParsedStat | undefined {
  const tradeStat = TRADE_STAT_BY_MATCH_STR(stat);
  if (!tradeStat) return;

  // use naive stat
  const statLine: Stat = {
    ref: stat,
    better: StatBetter.PositiveRoll,
    matchers: [
      {
        string: stat,
      },
    ],
    trade: {
      ids: tradeStat,
    },
  };

  return { stat: statLine, translation: statLine.matchers[0] };
}

interface FindResolveParams {
  matchStr: string;
  modType: ModifierType;
  itemCategory: ItemCategory | undefined;
  roll: number | undefined;
}

function findAndResolveTranslation(
  params: FindResolveParams,
): { matcher: StatMatcher; stat: Stat } | undefined {
  const { matchStr } = params;
  const statOrGroup = STAT_BY_MATCH_STR(matchStr);

  return statOrGroup;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const __testExports = {
  tryParseTranslation,
};
