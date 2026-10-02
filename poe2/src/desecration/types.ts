/**
 * exile-appraiser(WP-R):`data/poe2/desecration/{tiers,base_profiles}.json` 的型別。
 * 產生器:`scripts/build-desecration-tiers.mjs`;說明:`docs/desecration-tiers.md`。
 */

/** normal = 一般詞綴池(褻瀆也可能擲出)、desecration_exclusive = 三神(烏拉曼/阿姆那姆/柯戈)專屬、_jewel = 深淵珠寶專屬 */
export type DesecrationPool =
  | "normal"
  | "desecration_exclusive"
  | "desecration_exclusive_jewel";

export interface DesecrationPart {
  stat_hash: string;
  stat_id: string;
  /** EE2 stats.ndjson 的 `ref`(英文模板,語言無關鍵) */
  ref: string;
  text: {
    en: string;
    zh: string;
    /**
     * exile-appraiser(WP-S):同一 ref 的其他繁中寫法(cmn-Hant stats.ndjson 的其餘 matcher,去重、不含等於 `zh` 的那個)。
     * `negate: true` = 這個寫法顯示的極性與 **`zh`** 相反(`增加` ↔ `減少` 等;不是相對英文 ref)。
     * 可能不含 `#`(`無物理傷害`、`擊中時必定造成流血`),比對時當精確文字。舊資料沒有這個欄位。
     */
    zhVariants?: Array<{ text: string; negate?: true }>;
    /**
     * exile-appraiser(第 22 步,schema 2):同一 stat 列(en stats.ndjson)的其他英文寫法(英文客戶端的揭露面板 OCR 用)。
     * `negate: true` = 極性與 **`en`** 相反(`#% reduced Attack Speed` ↔ `#% increased Attack Speed`)。schema 1 的資料沒有這個欄位。
     */
    enVariants?: Array<{ text: string; negate?: true }>;
  };
  /** 每個 `#` 一組 [lo, hi];PoB 文字對不上模板時為 null(產生器 diagnostics 會列出) */
  ranges: number[][] | null;
  source_text: string;
  /** PoB 文字與模板極性相反(increased ↔ reduced);ranges 已取絕對值 */
  direction?: "increase" | "decrease";
  matched_template?: string;
}

export interface DesecrationEntry {
  /** PoB mod id;合併的重複紀錄以 `;` 連接 */
  mod_id: string;
  pool: DesecrationPool;
  /** 三神專屬(desecration_exclusive)才有:`ulaman` / `amanamu` / `kurgal`(PoB modTags) */
  gods?: string[];
  type: string;
  group: string;
  required_level: number;
  /** profile id → Tier(1 = 最高) */
  profile_tiers: Record<string, number>;
  parts: DesecrationPart[];
}

export interface DesecrationProfile {
  id: string;
  category: string;
  tags: string[];
}

export interface DesecrationTiers {
  /** 2 = parts 多了 `text.enVariants`(第 22 步);其餘與 1 相同,兩版都照讀 */
  schema: 1 | 2;
  source: {
    pob2Version: string;
    files: Record<string, string>;
    statsCommit: string | null;
    [k: string]: unknown;
  };
  profiles: DesecrationProfile[];
  entries: DesecrationEntry[];
  diagnostics: Record<string, unknown>;
}

export interface BaseProfiles {
  schema: 1;
  pob2Version: string;
  /** 英文 refName(ITEM 底材名 / 單一底材的 UNIQUE 名)→ profile id */
  profiles: Record<string, string>;
}

/** 一個推定候選(tooltip 顯示用) */
export interface DesecrationCandidate {
  tier: number;
  pool: DesecrationPool;
  gods?: string[];
  modId: string;
  /** 與 mod.stats 同序;每個 stat 一組 [lo, hi](多個 `#` 取平均,與 parser 的 roll.value 同語意);未知為 null */
  ranges: Array<[number, number] | null>;
}
