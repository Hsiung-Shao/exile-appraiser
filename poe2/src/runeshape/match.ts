/**
 * exile-appraiser(WP-R2 §2):符文塑形面板的 OCR 列 → 物品 refName / poe.ninja 鍵(renderer 入口)。
 * 規則與實作在零依賴的 `match-core.ts`(說明見該檔與 docs/runeshape.md);這裡只包上**目前語系** `items.ndjson` 的索引
 * + 語言無關的配方結果(`RUNESHAPE_RECIPES`,`data/poe2/runeshape/recipes.json`;缺檔時只少了配方這一層)。
 */
import { ITEMS_ITERATOR, RUNESHAPE_RECIPES } from "@/assets/data";
import { buildRuneshapeIndex, matchRunesRowsWith, type RuneshapeIndex, type RuneshapeMatchRow, type RuneshapeOcrRow } from "./match-core";

export * from "./match-core";

let cached: { iter: typeof ITEMS_ITERATOR; recipes: typeof RUNESHAPE_RECIPES; index: RuneshapeIndex } | null = null;

/** 目前語系的索引(資料重載 / 換語系後 `ITEMS_ITERATOR` 換新、或配方資料換新 → 重建) */
function defaultIndex(): RuneshapeIndex {
  if (!cached || cached.iter !== ITEMS_ITERATOR || cached.recipes !== RUNESHAPE_RECIPES) {
    const all = [...ITEMS_ITERATOR('"namespace": "ITEM"'), ...ITEMS_ITERATOR('"namespace": "GEM"')];
    cached = { iter: ITEMS_ITERATOR, recipes: RUNESHAPE_RECIPES, index: buildRuneshapeIndex(all, RUNESHAPE_RECIPES?.recipes ?? []) };
  }
  return cached.index;
}

export function matchRunesRows(lines: RuneshapeOcrRow[], index: RuneshapeIndex = defaultIndex()): RuneshapeMatchRow[] {
  return matchRunesRowsWith(lines, index);
}
