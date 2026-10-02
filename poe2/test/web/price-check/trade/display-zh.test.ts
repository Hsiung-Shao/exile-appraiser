import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { init, loadForLang, LOADED_DATA } from "@/assets/data";
import { source } from "@/assets/data/source";
import { setHostOptions } from "@/parser/host-options";
import { resetTradeSessions } from "@/web/price-check/trade/common";
import {
  __testExports,
  requestResults,
  type DisplayItem,
  type DisplayItemLine,
} from "@/web/price-check/trade/pathofexile-trade";
import {
  __displayZhTest,
  buildDisplayZhData,
  displayZhFor,
  loadDisplayZhData,
  translateDisplayItem,
  translateModLine,
  ZH_MOD_TYPES,
  type DisplayZhData,
  type ZhLineReport,
} from "@/web/price-check/trade/display-zh";
import type { HttpResponse } from "@exile-appraiser/core/http";
import { setupTests } from "@specs/vitest.setup";

/**
 * exile-appraiser(第 19 步):懸停浮窗繁中(display-zh.ts)。
 * 錄製的 trade2 fetch 回應逐行快照;刻意破壞(數值個數不符、未知 / 錯置 stat id)一律保留英文;
 * tier / 顏色 / 行數不變;英文介面與台服不翻。
 */
const FIXTURES = [
  "../../../docs/fetchResponses.json",
  "../../../docs/fetchResponses2.json",
  "../../../runeshape/fixtures/trade/fetch-powered-by-verisium-l20.json",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 測試只讀取各種形狀的查價結果欄位,不值得為每種形狀寫型別
type AnyResult = any;

function allResults(): AnyResult[] {
  return FIXTURES.flatMap((f) => {
    const d = JSON.parse(fs.readFileSync(path.resolve(__dirname, f), "utf8"));
    return (Array.isArray(d) ? d : d.result) as AnyResult[];
  });
}

const blocks = (d: DisplayItem) =>
  [...ZH_MOD_TYPES, "veiled"].map(
    (t) => (d as unknown as Record<string, DisplayItemLine[] | undefined>)[`${t}Mods`],
  );

let data: DisplayZhData;
beforeAll(async () => {
  setupTests();
  await init("en");
  data = await loadDisplayZhData();
});

describe("懸停浮窗繁中(display-zh)", () => {
  it("錄製回應逐行結果(快照)與覆蓋率", () => {
    const rows: string[] = [];
    const reports: ZhLineReport[] = [];
    for (const r of allResults()) {
      const before = __testExports.parseFetchResult(r)!;
      const { display, lines } = translateDisplayItem(before, r.item, data);
      rows.push(`## ${r.id.slice(0, 8)} ${JSON.stringify(before.title)} → ${JSON.stringify(display.title)}`);
      for (const l of lines) {
        rows.push(`  [${l.reason}] ${l.type} ${l.tradeId ?? "-"} ${JSON.stringify(l.en)} → ${JSON.stringify(l.zh ?? null)}`);
      }
      reports.push(...lines);
    }
    expect(rows.join("\n")).toMatchSnapshot();

    const ok = reports.filter((l) => l.reason === "ok").length;
    const kept = reports
      .filter((l) => l.reason !== "ok")
      .map((l) => `${l.reason} ${l.tradeId ?? "-"} ${l.en}`);
    // 回報用:翻成功 / 總行數(veiled 不算);保留英文的行列在快照裡
    expect({ ok, total: reports.length, kept }).toMatchSnapshot();
  });

  it("tier、顏色、行數、veiled 完全不變;沒翻的行文字也不變", () => {
    for (const r of allResults()) {
      const before = __testExports.parseFetchResult(r)!;
      const { display, lines } = translateDisplayItem(before, r.item, data);
      const a = blocks(before);
      const b = blocks(display);
      a.forEach((block, i) => {
        expect(b[i]?.map((l) => [l.tier, l.color, l.value])).toEqual(
          block?.map((l) => [l.tier, l.color, l.value]),
        );
      });
      expect(display.veiledMods).toBe(before.veiledMods);
      for (const l of lines) {
        const shown = (display as unknown as Record<string, DisplayItemLine[]>)[`${l.type}Mods`][l.index];
        expect(shown.text).toBe(l.reason === "ok" ? l.zh : l.en);
      }
    }
  });

  it("輸入不被修改(cache 裡的原始資料保持英文)", () => {
    const r = allResults().find((x) => x.id.startsWith("00d17082"));
    const before = __testExports.parseFetchResult(r)!;
    const snapshot = JSON.stringify(before);
    translateDisplayItem(before, r.item, data);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("刻意破壞:數值個數不符、多餘文字、未知 id、錯置 id、沒有 id → 保留英文", () => {
    const cold = "explicit.stat_1037193709"; // Adds # to # Cold Damage
    expect(translateModLine("Adds 30 to 45 Cold Damage", cold, data)).toEqual({
      zh: "附加30至45冰冷傷害",
      reason: "ok",
    });
    expect(translateModLine("Adds 30 Cold Damage", cold, data).zh).toBeUndefined();
    expect(translateModLine("Adds 30 to 45 to 60 Cold Damage", cold, data).zh).toBeUndefined();
    expect(translateModLine("Adds 30 to 45 Cold Damage extra", cold, data).zh).toBeUndefined();
    expect(translateModLine("Adds 30 to 45 Cold Damage", "explicit.stat_1", data)).toEqual({
      zh: undefined,
      reason: "unknown-id",
    });
    // 錯置:拿力量的 id 套冰冷傷害的行 → 英文模板不匹配
    expect(translateModLine("Adds 30 to 45 Cold Damage", "explicit.stat_4080418644", data)).toEqual({
      zh: undefined,
      reason: "no-en-match",
    });
    expect(translateModLine("Adds 30 to 45 Cold Damage", undefined, data).reason).toBe("no-id");
  });

  it("錯置的 hashes(舊格式字串陣列)不會把別行的翻譯套上來", () => {
    const r = structuredClone(allResults().find((x) => x.id.startsWith("00d17082")));
    r.item.extended.hashes.explicit.reverse();
    const before = __testExports.parseFetchResult(r)!;
    const { display } = translateDisplayItem(before, r.item, data);
    // 4 行的 id 全部錯開 → 每行的英文都對不上拿到的條目模板 → 全部維持英文(不會套上別行的繁中)
    const texts = display.explicitMods!.map((l) => l.text);
    expect(texts).toEqual(before.explicitMods!.map((l) => l.text));
  });

  it("變體挑選:value 單數形、negate(reduced)、新格式 hash 前綴 stat.", () => {
    expect(translateModLine("Has 1 Charm Slot", "implicit.stat_1416292992", data).zh).toBe("有1個護符欄位");
    // value 1 的單數形但數值不是 1 → 不匹配
    expect(translateModLine("Has 2 Charm Slot", "implicit.stat_1416292992", data).zh).toBeUndefined();
    expect(translateModLine("Loads an additional bolt", "implicit.stat_1967051901", data).zh).toBe("裝填額外1發弩箭");
    expect(translateModLine("35% reduced Attribute Requirements", "stat.explicit.stat_3639275092", data).zh).toBe(
      "減少35%能力值需求",
    );
    expect(translateModLine("Adds 111 to 169 Fire Damage", "stat.fractured.stat_709508406", data).zh).toBe(
      "附加111至169火焰傷害",
    );
  });

  it("物品名:傳奇 name、typeLine = baseType 才翻;稀有隨機名、魔法 typeLine 保留英文", () => {
    const byId = (p: string) => allResults().find((x) => x.id.startsWith(p));
    const title = (p: string) => {
      const r = byId(p);
      return translateDisplayItem(__testExports.parseFetchResult(r)!, r.item, data).display.title;
    };
    expect(title("4ac2e3cc")).toEqual(["崇敬樹脂", "琥珀護身符"]); // Unique
    expect(title("00d17082")).toEqual(["Phoenix Brand", "崩毀重錘"]); // Rare
    expect(title("65c7c4e8")).toEqual(["Collector's Corsair Cap of Curvation"]); // Magic
  });
});

describe("何時翻(displayZhFor / requestResults)", () => {
  function fakeHttp(body: unknown) {
    return async (): Promise<HttpResponse> => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }
  const rec = () => {
    const r = allResults().find((x) => x.id.startsWith("00d17082"));
    return { result: [r] };
  };

  it("英文介面 / 台服 / 懸停浮窗關閉 → 不翻;國際服 + 繁中介面 → 翻", async () => {
    setHostOptions({ uiLanguage: "en" });
    expect(displayZhFor("intl")).toBeUndefined();
    setHostOptions({ uiLanguage: "cmn-Hant" });
    expect(displayZhFor("tw")).toBeUndefined();
    expect(displayZhFor("intl")).toBeTypeOf("function");
    setHostOptions({ itemHoverTooltip: "off" });
    expect(displayZhFor("intl")).toBeUndefined();
    setHostOptions({ itemHoverTooltip: "always" });
    expect(displayZhFor("intl")).toBeTypeOf("function");
    setHostOptions({ uiLanguage: "en", itemHoverTooltip: "keybind" });
  });

  const ctxOf = (http: ReturnType<typeof fakeHttp>) => ({
    http,
    realm: "intl" as const,
    latencySeconds: 0,
    accountName: "",
  });

  it("code review 第 B 批:懸停浮窗關閉 → 不載資料(不讀任何資料檔)也不翻", async () => {
    __displayZhTest.reset();
    const spy = vi.spyOn(source(), "text");
    try {
      setHostOptions({ uiLanguage: "cmn-Hant", itemHoverTooltip: "off" });
      expect(displayZhFor("intl")).toBeUndefined();
      resetTradeSessions();
      const id = rec().result[0].id;
      const [r] = await requestResults(ctxOf(fakeHttp(rec())), "q", [id]);
      expect(r.displayItem).toEqual(__testExports.parseFetchResult(rec().result[0]));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      setHostOptions({ uiLanguage: "en", itemHoverTooltip: "keybind" });
      await loadDisplayZhData();
    }
  });

  it("code review 第 B 批:第一次查價不等資料(回英文、背景載入);載好後下一次查價(含快取結果)是繁中", async () => {
    __displayZhTest.reset();
    setHostOptions({ uiLanguage: "cmn-Hant" });
    try {
      const id = rec().result[0].id;
      resetTradeSessions();
      const [first] = await requestResults(ctxOf(fakeHttp(rec())), "q", [id]);
      // 不阻塞:這次是英文
      expect(first.displayItem).toEqual(__testExports.parseFetchResult(rec().result[0]));
      // 背景載入完成(同一個 promise)
      await loadDisplayZhData();
      const [second] = await requestResults(ctxOf(fakeHttp(rec())), "q", [id]);
      expect(second.displayItem!.explicitMods!.map((l) => l.text)).toEqual([
        "附加30至45冰冷傷害",
        "+16點力量",
        "以5.01%物理傷害偷取魔力",
        "增加16%暈眩持續時間",
      ]);
    } finally {
      setHostOptions({ uiLanguage: "en" });
    }
  });

  it("code review 第 B 批:重用 @/assets/data 已載入的語系,只讀缺的檔;結果與三個檔直接讀相同(en / cmn-Hant 兩種客戶端)", async () => {
    const DATA = path.resolve(__dirname, "../../../../../data/poe2");
    const read = (rel: string) => fs.readFileSync(path.join(DATA, rel), "utf8");
    const expected = buildDisplayZhData(read("en/stats.ndjson"), read("cmn-Hant/stats.ndjson"), read("cmn-Hant/items.ndjson"));
    const reqs = async () => {
      __displayZhTest.reset();
      const spy = vi.spyOn(source(), "text");
      try {
        const d = await loadDisplayZhData();
        return { d, files: spy.mock.calls.map((c) => c[0]).sort() };
      } finally {
        spy.mockRestore();
      }
    };
    expect(LOADED_DATA?.lang).toBe("en");
    const en = await reqs();
    expect(en.files).toEqual(["cmn-Hant/items.ndjson", "cmn-Hant/stats.ndjson"]);
    expect(en.d).toEqual(expected);
    try {
      await loadForLang("cmn-Hant");
      expect(LOADED_DATA?.lang).toBe("cmn-Hant");
      const zh = await reqs();
      expect(zh.files).toEqual(["en/stats.ndjson"]);
      expect(zh.d).toEqual(expected);
    } finally {
      await loadForLang("en");
      __displayZhTest.reset();
      await loadDisplayZhData();
    }
  });

  it("requestResults 端到端:英文介面浮窗與原本逐位元相同;繁中介面只有 text 換掉", async () => {
    const ctx = (http: ReturnType<typeof fakeHttp>) => ({
      http,
      realm: "intl" as const,
      latencySeconds: 0,
      accountName: "",
    });
    const id = rec().result[0].id;

    resetTradeSessions();
    setHostOptions({ uiLanguage: "en" });
    const [en] = await requestResults(ctx(fakeHttp(rec())), "q", [id]);
    expect(en.displayItem).toEqual(__testExports.parseFetchResult(rec().result[0]));

    resetTradeSessions();
    setHostOptions({ uiLanguage: "cmn-Hant" });
    const [zh] = await requestResults(ctx(fakeHttp(rec())), "q", [id]);
    expect(zh.displayItem!.explicitMods!.map((l) => l.text)).toEqual([
      "附加30至45冰冷傷害",
      "+16點力量",
      "以5.01%物理傷害偷取魔力",
      "增加16%暈眩持續時間",
    ]);
    expect(zh.displayItem!.explicitMods!.map((l) => l.tier)).toEqual(
      en.displayItem!.explicitMods!.map((l) => l.tier),
    );
    setHostOptions({ uiLanguage: "en" });
  });
});
