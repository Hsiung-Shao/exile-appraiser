# 第三方授權聲明 / Third-party notices

本專案(ExileAppraiser / 流亡鑑價)以 MIT 授權釋出(見 `LICENSE`)。以下元件之程式碼或資料被逐檔複製、
修改後併入本專案;各自的授權全文放在 `LICENSES/`。

| 元件 | 用途 | 授權 | 來源 |
|---|---|---|---|
| Awakened PoE Trade(SnosMe)與其繁中 fork awakened-poe-trade-zh-TW(Hsiung-Shao) | PoE1 剪貼簿 parser、篩選器、交易查詢組裝、`data/poe1/*` 資料檔、Vue 篩選器元件 | MIT | https://github.com/SnosMe/awakened-poe-trade 、https://github.com/Hsiung-Shao/awakened-poe-trade-zh-TW |
| Exiled Exchange 2(Kvan7)與其繁中 fork Exiled-Exchange-2-zh-TW(Hsiung-Shao) | PoE2 剪貼簿 parser、篩選器、交易查詢組裝、`data/poe2/*` 資料檔(`trade/` 快照除外)、Vue 查價元件與 `renderer/public/images` 的 PoE2 圖示 | MIT | https://github.com/Kvan7/Exiled-Exchange-2 、https://github.com/Hsiung-Shao/Exiled-Exchange-2-zh-TW |
| PoENavi(Buri) | 設計參考:PoE1/PoE2 一體化查價流程、容差選單、限流與未解析詞綴呈現方式;另 `scripts/build-desecration-tiers.mjs` 逐段移植其 `scripts/build_poetore_poe2_desecration_tiers.py`(PoE2 褻瀆 Tier 資料表產生規則) | MIT | https://github.com/buri34/poenavi |
| Path of Building Community(PoE2 版) | `data/poe2/desecration/*` 由其 `Data/{ModItem,ModJewel,ModVeiled}.lua`、`Data/Bases/*.lua` 的詞綴 / 底材資料衍生 | MIT | https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2 |
| poe-disenchant-tool(deronek)與 @alserom 的 poe-dust gist | 拆粉排行:`data/dust/poe-dust.json`(由 `data/dust/poe-dust.js` 逐筆轉 JSON)的 goldCost / slots 與交叉比對用數值;數值最初由 @alserom 整理(https://gist.github.com/alserom/22bdd4106806cbd4f85a5cb8c4345c08) | MIT | https://github.com/deronek/poe-disenchant-tool |

Path of Exile、遊戲內名詞、物品與相關資料為 Grinding Gear Games 所有。本專案與 GGG 無關,亦未獲其背書。
