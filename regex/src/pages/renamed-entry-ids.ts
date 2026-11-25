// 由 regex/scripts/gen-renamed-entry-ids.ts 產生(scripts/poe1-season/update.mjs --write 時自動執行),勿手改;只會加、不會刪。
// 併列後 id 整個換掉、`X|ref` 退路接不到的舊項目 id → 現行 id(PoE1 物品詞綴數值頁:規則 30 的「+ (Random Support Gem)」配對,
// 固定列用的是舊的固定輔助 stat id;2026-11-24 以併列前後兩版資料逐條算出)。註解 = 現行那條的英文 ref。
export const RENAMED_ENTRY_IDS: Readonly<Record<string, string>> = {
  stat_285773939: 'indexable_support_154', // Flamewood
  stat_3227145554: 'indexable_support_133', // Impending Doom
  stat_4096329121: 'indexable_support_168', // Living Lightning
  stat_254728692: 'indexable_support_33', // Pierce
  stat_2910545715: 'indexable_support_148' // Prismatic Burst
}
