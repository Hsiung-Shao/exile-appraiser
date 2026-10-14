import { beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { init } from "@/assets/data";
import { __testExports } from "@/web/price-check/trade/pathofexile-trade";
import { setHostOptions } from "@/parser/host-options";
import {
  __displayZhTest,
  displayZhFor,
  scheduleDisplayZhPreload,
  loadDisplayZhData,
  translateDisplayItem,
  translateModLine,
  type DisplayZhData,
} from "@/web/price-check/trade/display-zh";
import { setupTests } from "@specs/vitest.setup";

/**
 * 2026-10-14 使用者實機(國際服 + 繁中介面,Viper Coat 領主鎖甲)浮窗仍有英文:
 * 符文詞綴(繁中同旗標兩種寫法)、物品類別行、需求行。
 * 樣本 = 錄製回應裡的身體護甲(fetchResponses2.json `95bcbe83`)補上 GGG trade2 格式的 runeMods / 需求。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 錄製回應的形狀
type AnyResult = any;

function bodyArmour(): AnyResult {
  const f = path.resolve(__dirname, "../../../docs/fetchResponses2.json");
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  const list = (Array.isArray(d) ? d : d.result) as AnyResult[];
  const r = structuredClone(list.find((x) => x.id.startsWith("95bcbe83")));
  r.item.runeMods = ["36% increased Armour, [Evasion] and [EnergyShield|Energy Shield]"];
  r.item.extended.hashes.rune = [["rune.stat_3523867985", null]];
  r.item.requirements = [
    { name: "Level", values: [["80", 0]], displayMode: 0, type: 62 },
    { name: "[Strength|Str]", values: [["67", 0]], displayMode: 1, type: 63 },
    { name: "[Dexterity|Dex]", values: [["67", 0]], displayMode: 1, type: 64 },
  ];
  return r;
}

function zhOf(r: AnyResult) {
  const before = __testExports.parseFetchResult(r)!;
  return { before, after: translateDisplayItem(before, r.item, data).display };
}

let data: DisplayZhData;
beforeAll(async () => {
  setupTests();
  await init("en");
  data = await loadDisplayZhData();
});

describe("懸停浮窗繁中:符文詞綴、類別行、需求行", () => {
  it("符文詞綴繁中有兩種寫法時以台服交易站文字挑出唯一", () => {
    expect(translateModLine("36% increased Armour, Evasion and Energy Shield", "rune.stat_3523867985", data)).toEqual({
      zh: "增加36%護甲值、閃避和能量護盾",
      reason: "ok",
    });
    const { after } = zhOf(bodyArmour());
    expect(after.runeMods!.map((l) => l.text)).toEqual(["增加36%護甲值、閃避和能量護盾"]);
  });

  it("減少寫法不被台服正向文字誤挑(仍保留英文)", () => {
    expect(translateModLine("10% reduced Armour, Evasion and Energy Shield", "rune.stat_3523867985", data).zh).toBeUndefined();
  });

  it("身體護甲類別行換成 GGPK 物品種類名「胸甲」", () => {
    const { before, after } = zhOf(bodyArmour());
    expect(before.nameBlock![0].text).toBe("Body Armour ");
    expect(after.nameBlock![0]).toEqual({ ...before.nameBlock![0], text: "胸甲 " });
    // 其他屬性行不動
    expect(after.nameBlock!.slice(1)).toEqual(before.nameBlock!.slice(1));
  });

  it("類別名以 GGPK Id / 英文名 / 英文複數去 s 對接(Charm → 護符、Waystone → 換界石)", () => {
    const cls = (name: string) => {
      const r = bodyArmour();
      r.item.properties[0].name = name;
      return zhOf(r).after.nameBlock![0].text;
    };
    expect(cls("Charm")).toBe("護符 ");
    expect(cls("Waystone")).toBe("換界石 ");
    expect(cls("[Mace|Two Hand Mace]")).toBe("雙手錘 ");
    expect(cls("Helmet")).toBe("頭部 ");
    expect(cls("Tablet")).toBe("碑牌 ");
    expect(cls("[Crossbow]")).toBe("十字弓 ");
    // GGPK 沒有同名種類(藥劑分生命 / 魔力)→ 維持英文
    expect(cls("[Flask]")).toBe("Flask ");
  });

  it("載入的物品種類資料來自 data/poe2/item-classes", () => {
    expect(data.itemClassZh?.get("Body Armour")).toEqual(new Set(["胸甲"]));
  });

  it("需求行換成「需求: 等級 80, 67 力量, 67 敏捷」", () => {
    const { before, after } = zhOf(bodyArmour());
    const req = after.itemProps![after.itemProps!.length - 1];
    expect(req.text).toBe("需求: 等級 ");
    expect(req.value).toBe("80, 67 力量, 67 敏捷");
    expect(req.color).toBe(before.itemProps![before.itemProps!.length - 1].color);
    // 物品等級行(i18n 鍵)不動
    expect(after.itemProps![0]).toEqual(before.itemProps![0]);
  });

  it("只有等級需求時也換;未知需求類型或未知類別維持英文", () => {
    const r = bodyArmour();
    r.item.requirements = [{ name: "Level", values: [["26", 0]], displayMode: 0, type: 62 }];
    let { after } = zhOf(r);
    expect(after.itemProps!.at(-1)).toMatchObject({ text: "需求: 等級 ", value: "26" });

    r.item.requirements.push({ name: "Mystery", values: [["5", 0]], displayMode: 1, type: 999 });
    r.item.properties[0].name = "[Quarterstaff]";
    ({ after } = zhOf(r));
    const before = __testExports.parseFetchResult(r)!;
    expect(after.itemProps).toEqual(before.itemProps);
    expect(after.nameBlock![0].text).toBe("Quarterstaff ");
  });

  it("啟動後閒置預載:國際服 + 繁中介面 + 浮窗非關閉時排程,第一次查價就有轉換函式", async () => {
    __displayZhTest.reset();
    const queued: Array<() => void> = [];
    const later = (fn: () => void) => void queued.push(fn);
    try {
      setHostOptions({ uiLanguage: "en" });
      expect(scheduleDisplayZhPreload("intl", later)).toBe(false);
      setHostOptions({ uiLanguage: "cmn-Hant" });
      expect(scheduleDisplayZhPreload("tw", later)).toBe(false);
      setHostOptions({ itemHoverTooltip: "off" });
      expect(scheduleDisplayZhPreload("intl", later)).toBe(false);
      expect(queued).toHaveLength(0);

      setHostOptions({ itemHoverTooltip: "keybind" });
      expect(scheduleDisplayZhPreload("intl", later)).toBe(true);
      // 排程當下不載(不拖慢啟動)
      expect(displayZhFor("intl")).toBeUndefined();
      expect(queued).toHaveLength(1);
      queued[0]();
      await loadDisplayZhData();
      // 已載好 → 再排程是 no-op;第一次查價同步拿到轉換函式
      expect(scheduleDisplayZhPreload("intl", later)).toBe(false);
      expect(displayZhFor("intl")).toBeTypeOf("function");
    } finally {
      setHostOptions({ uiLanguage: "en", itemHoverTooltip: "keybind" });
    }
  });

  it("輸入不被修改", () => {
    const r = bodyArmour();
    const before = __testExports.parseFetchResult(r)!;
    const snap = JSON.stringify(before);
    translateDisplayItem(before, r.item, data);
    expect(JSON.stringify(before)).toBe(snap);
  });
});
