# poe.ninja PoE2 exchange 回應格式(WP-R2)

符文塑形自動查價(WP-R2)用 poe.ninja 的 PoE2 **exchange** 端點查符文、靈魂核心、未切割寶石、通貨的參考價。
本文件記錄 2026-09-30 實際錄製的回應(`core/test/recordings/ninja/poe2/`,聯盟 `Forbidden Rites`,七個類別同一次各請求一次、間隔 1.6 秒),
解析規則在 `core/src/ninja/client.ts`,測試在 `core/test/ninja.test.ts` 的「PoE2 exchange 錄製檔」。

## 端點

```
GET https://poe.ninja/poe2/api/economy/exchange/current/overview?league=<聯盟 id>&type=<類別>
```

- 聯盟 id 用交易站清單 `https://www.pathofexile.com/api/trade2/data/leagues` 的 `result[].id`(錄製時:`Forbidden Rites`、`HC Forbidden Rites`、
  `Runes of Aldur`、`HC Runes of Aldur`、`Standard`、`Hardcore`;目前聯盟是 `Forbidden Rites`)。`pickLeague` **不依位置**,取清單中
  第一個非永久、非 HC / SSF / Ruthless 的聯盟(這份清單 → `Forbidden Rites`),沒有才退 `Standard`;既有選擇仍在清單裡就沿用。
  舊規則(照上游 E 的 `TMP_CHALLENGE = 2` 取第 3 項)會挑到舊的 `Runes of Aldur`,poe.ninja 那邊列數少很多(Runes 84 列 vs 140 列)。網址裡空白編成 `%20`。
- 錄的類別(匯率相同:`rates = { exalted: 610.9, chaos: 9.61 }`):`Runes`(140 列)、`SoulCores`(52)、`UncutGems`(42)、`Currency`(51);
  符文塑形面板用到的 `Verisium`(24 列,合金 `Adaptive Alloy` 等、`Verisium`)、`Expedition`(18 列,`Thaumaturgic Flux (Level N)` 有 13~20)、
  `LineageSupportGems`(75 列,傳承輔助寶石;**沒有**符文技能寶石 `Conductive Runes` / `Concussive Runes` 等)。其餘 PoE2 類別見 `NINJA_CATEGORIES.poe2`。
  符文塑形面板的列怎麼對到這些鍵見 `docs/runeshape.md`。
- 不需要登入 / cookie;main 的 `http.ts` 已放行 `poe.ninja`。只有國際服(台服沒有 → UI 顯示「無價格來源」)。

## 回應結構

頂層只有三個鍵:`core`、`lines`、`items`。

```jsonc
{
  "core": {
    "items": [ /* divine、exalted、chaos 三個基準通貨,欄位同下方 items */ ],
    "rates": { "exalted": 610.9, "chaos": 9.61 },  // 1 primary 可換多少 X
    "primary": "divine",                           // lines 的 primaryValue 單位
    "secondary": "chaos"
  },
  "lines": [
    { "id": "aldurs-legacy", "primaryValue": 385.3, "volumePrimaryValue": 13228,
      "maxVolumeCurrency": "divine", "maxVolumeRate": 0.002596,
      "sparkline": { "totalChange": 15.12, "data": [17.25, 19.04, 19.00, 18.89, 17.68, 14.87, 15.12] } }
  ],
  "items": [
    { "id": "aldurs-legacy", "name": "Aldur's Legacy", "image": "/gen/image/…/GameWarpRuneUnique.png",
      "category": "Runes", "detailsId": "aldurs-legacy" }
  ]
}
```

| 欄位 | 說明 |
|---|---|
| `core.primary` | **PoE2 是 `divine`**(PoE1 是 `chaos`)。錄的七個類別都一樣 |
| `core.rates` | `{ exalted, chaos }`:1 divine = 610.9 exalted = 9.61 chaos(錄製當時)。沒有 `divine` 鍵(它自己是 primary) |
| `lines[].id` / `items[].id` | **字串 slug**(PoE2 四類全是字串;PoE1 有些類別是數字),兩者以 `id` 對接;錄製檔每個 line 都有對應 item |
| `lines[].primaryValue` | 單位 = primary(divine)。錄製檔沒有 null / 0(解析仍容忍,該列略過) |
| `items[].name` | **英文名 = items.ndjson 的 `refName`**(`Aldur's Legacy`、`Ancient Rune of Control`、`Exalted Orb`)→ 鍵 `currency|<name>` |
| `items[].category` | `Runes`、`Vaal`(靈魂核心類是 `Vaal`)、`UncutGems`、`Currency`… 與請求的 `type` 不一定相同 |
| `items[].detailsId` | ninja 詳細頁網址最後一段 |
| `volumePrimaryValue` / `maxVolume*` / `sparkline` | 每小時成交量(primary 單位)、成交量最大的對手通貨與其匯率、7 天走勢(每天相對 7 天前的漲跌 %,`totalChange` = 最後一天);第 24 步起快照存走勢 / 成交量(換成 chaos)/ `maxVolumeCurrency`,見下方「快照 schema」 |
| 沒有 `count` / `listingCount` | exchange 類沒有掛單數 → `count: 0`、不判低信心 |

### 未切割寶石

名稱帶等級,每個等級一列:`Uncut Skill Gem (Level 1)` … `(Level 20)`、`Uncut Spirit Gem (Level 4)` … `(Level 20)`、
`Uncut Support Gem (Level 1)` … `(Level 5)`(錄製當時)。id 形如 `uncut-skill-gem-20`、detailsId 形如 `uncut-skill-gem-level-20`。
items.ndjson 的 refName 同樣是 `Uncut Skill Gem (Level 20)`(繁中 `未切割的技能寶石（等級 20）`),所以鍵直接用 refName;
`priceOf(refName, level)` 在 refName 沒帶等級時補 ` (Level N)`。

## 換算(`chaosFactor`)

- 價格一律換成 chaos 存:`chaos = primaryValue × rates.chaos`(primary = divine 時 factor = `rates.chaos`)。
- `divineRate`(1 div = 幾 c)= `rates.chaos` = 9.61。
- **`exaltedRate`(1 ex = 幾 c,WP-R2 新增)= factor / `rates.exalted` = 9.61 / 610.9 ≈ 0.015731**。
  驗算:Currency 的 `exalted` 列 `primaryValue` 0.001637 div × 9.61 = 0.015732 c,與 core 匯率差 < 0.1%。
  core 沒有 `rates.exalted` 時(目前沒見過),PoE2 退回用 `currency|Exalted Orb` 那列;PoE1 一律沒有 exaltedRate。
- 顯示(`renderer/src/web/overlay/runeshape-view.ts`):崇高石 = chaos / exaltedRate,≥ 1 神聖石改顯示神聖石。

## 快照 schema

`core/src/ninja/cache.ts` 的 `NINJA_SNAPSHOT_SCHEMA` = **3**:

- schema 2(WP-R2):多存 `exaltedRate: number | null`;
- schema 3(2026-10-02 第 24 步,查價面板「通貨價格區」):每列多存 `s`(7 天走勢陣列,全是 null 時省略)、`sc`(`totalChange`)、
  `v`(`volumePrimaryValue` × factor = 每小時成交量,**chaos 單位**,留 3 位小數;只有 exchange 類)、`mv`(`maxVolumeCurrency`;只有 exchange 類)。
  item overview(傳奇等)的 `sparkLine` 也存進 `s` / `sc`,沒有成交量。`maxVolumeRate` 只在解析結果(`NinjaLine.maxVolumeRate`),不進快照。

舊 schema 的快取(`userData/cache/ninja/<game>_<league>.json`)一律丟棄重抓(測試含使用者機器上 WP-R2 之前的真實舊檔格式);
第 24 步之後第一次查價會重抓一次(15 分鐘 TTL、20 分鐘有人查價閘門照舊)。

## 查價面板「通貨價格區」怎麼用這些欄位(第 24 步)

- renderer `Prices.ts` `findPriceByQuery` 多回 `graph`(= `s`,APT 欄位名)、`graphChange`、`volumeChaos`、`maxVolumeCurrency`、`exchange`(鍵 `currency|` / `card|`)。
  通貨價格區(`PriceTrend.vue`)與 `StackValue.vue` **只對 `exchange` 為 true 的命中顯示**(傳奇 / 寶石等 item overview 不顯示)。
- PoE2 查價元件(EE2 移植)以 divine 計價:`renderer/src/web/background/poe2-price-source.ts` 把 chaos 換回 divine(`primaryValue = c / divineRate`、
  `volumePrimaryValue = v / divineRate`),經 `poe2/src/web/background/Prices.ts` `setPriceSource` 注入。
- 單位(core `ninja/units.ts`):PoE1 照 APT(chaos;> 0.94 div 換 div、0.94–1.06 顯示 1 div);PoE2 ≥ 1 div 神聖石,否則崇高石(與符文塑形徽章相同)。
- 錄製檔驗算:破裂石 `primaryValue` 8.25 div、`volumePrimaryValue` 9554 div/hr → 物品 9554 / 8.25 ≈ 1158 個/hr;PoE1 Divine Orb 371.7c、1450816 c/hr → 3904 div/hr、3903 個/hr。

## 錄製方式

`_meta.json` 記錄製時間與聯盟,以及每個檔的網址、狀態碼、位元組數、列數;檔案為原樣回應(未裁切)。重錄:以 Node `fetch` 依序請求各類別、每次間隔 ≥ 1.5 秒
(腳本不進 repo;自動驗證 / 測試只用錄製檔,不打 ninja,見 CLAUDE.md 規則 15)。
