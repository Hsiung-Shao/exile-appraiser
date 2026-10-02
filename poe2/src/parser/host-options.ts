/**
 * exile-appraiser: 上游 parser / filters 直接讀 Vue 設定 `AppConfig()`(`@/web/Config`)的四處,
 * 改成讀這個模組層的 provider;shell(renderer)用 `setHostOptionsProvider` 接上自己的設定,
 * CLI / 測試用預設值或 `setHostOptions` 覆寫。預設值等同上游的出廠設定。
 *
 * | 上游                                                          | 這裡                          |
 * |---------------------------------------------------------------|-------------------------------|
 * | `Parser.ts` 錯語系提示 `AppConfig().language`                  | `hostOptions().language`       |
 * | `magic-name.ts` `AppConfig().language === "cmn-Hant"`          | `hostOptions().language`       |
 * | `augment-builder.ts` `AppConfig("price-check").savedAugments`  | `hostOptions().savedAugments`  |
 * | `fill-augments.ts` `AppConfig("price-check").searchStatRange`  | `hostOptions().searchStatRange`|
 *
 * `language` 由 `poe2Adapter.loadData(source, lang)` 自動設成載入的資料語系(兩者本來就必須一致)。
 */
export interface HostOptions {
  /** 客戶端語言 = 載入的資料集語言(`en` / `cmn-Hant`)。 */
  language: string;
  /** 上游 PriceCheckWidget.savedAugments:依物品類別預填的符文 / 魂核 refName。 */
  savedAugments: { [key: string]: Array<string | null> };
  /** 上游 PriceCheckWidget.searchStatRange(詞綴數值容差 %)。 */
  searchStatRange: number;
  /**
   * 介面語言(`cmn-Hant` / `en`,renderer `AppConfig().uiLanguage`)。第 19 步:查價結果懸停浮窗的
   * 詞綴 / 物品名在這裡是 `cmn-Hant` 時換成繁中(`trade/display-zh.ts`);浮窗的 `item.*` 標籤本來就跟介面語言。
   */
  uiLanguage: string;
  /**
   * code review 第 B 批:上游 PriceCheckWidget.itemHoverTooltip(查價結果懸停浮窗 `off` / `keybind` / `always`)。
   * `off` 時浮窗不會顯示 → `display-zh.ts` 不載資料也不翻。
   */
  itemHoverTooltip: "off" | "keybind" | "always";
}

export function defaultHostOptions(): HostOptions {
  return { language: "en", savedAugments: {}, searchStatRange: 10, uiLanguage: "en", itemHoverTooltip: "keybind" };
}

let overrides: Partial<HostOptions> = {};
let provider: (() => Partial<HostOptions>) | undefined;

/** shell 用:每次讀取都呼叫 provider(跟著使用者設定走)。 */
export function setHostOptionsProvider(
  next: (() => Partial<HostOptions>) | undefined,
): void {
  provider = next;
}

/** CLI / 測試 / loadData 用:直接覆寫(與 provider 並存時 provider 優先)。 */
export function setHostOptions(next: Partial<HostOptions>): void {
  overrides = { ...overrides, ...next };
}

export function resetHostOptions(): void {
  overrides = {};
  provider = undefined;
}

export function hostOptions(): HostOptions {
  return { ...defaultHostOptions(), ...overrides, ...(provider?.() ?? {}) };
}
