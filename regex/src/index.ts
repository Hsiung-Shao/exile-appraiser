// @exile-appraiser/regex:Poe Regex(遊戲搜尋列字串產生器)核心,移植自 PobTools。純 TS,無 DOM / Node API。
// 讀檔請用 `@exile-appraiser/regex/node`(或呼叫端自行讀字串後丟 parseRegexCatalogue)。
export { Corpus, charCount, charOffsets, fold } from './gen'
export type { Ambient, Check, Entry, Mode, Options, Result } from './gen'
export { buildCorpus, entryLines, entryTitle, pageAmbient, parseRegexCatalogue } from './data'
export type { BuildCorpusOptions, RegexCatalogue, RegexEntry, RegexGame, RegexLang, RegexPage } from './data'
export {
  REGEX_STATE_SCHEMA, applyKeys, collectKeys, defaultRegexState, keyOf, migrateSections, parseRegexState, picksFor, regexStateSchemaOf, resolveKeys,
  serializeRegexState, zhLine
} from './state'
export type { ParsedRegexState, RegexBookmark, RegexPagePicks, RegexUiState } from './state'
export { Rng, samplePicks } from './rng'
export {
  condText, enLine, entryMatches, extraLines, hiddenPreview, lengthLevel, lineIn, otherLine, pageHasT17, sectionSummary, visibleRows
} from './view'
export type { LengthLevel, ListFilter, SectionSummaryItem, T17Filter } from './view'
export { SECTION_HOSTS, numericKeyOf, sectionHostOf, sectionIdOf } from './sections'
export { domainMax, naiveRangeRegex, normalizeRange, rangeRegex, readableRangeRegex } from './numeric'
export type { NumOptions, NumRange, ReadableOptions } from './numeric'
export { PAGE_KINDS, isCorpusPage, mergeLabels, normalizeLabel, parseLabels } from './data'
export type { PageKind, RegexLabels } from './data'
export {
  NUMERIC_LABEL_KEYS, VENDOR_LABEL_KEYS, algoPages, applyPageKeys, combineOrder, defaultValue, entryKey, hostIdOf, isAlgoPage,
  isSectionPage, isTierNameLine, labelBase, linkColors, linkedSockets, listedPages, mapTierFragment, numericPages, pageKeysOf,
  propertyFragment, rangeOp, rarityFragment, strictPropertyFragment, sanitizeValue, sectionPageOf, socketColorCount, valueUsable, vendorPages, wholeLine
} from './pages'
export type { AlgoEntry, AlgoInput, AlgoKind, AlgoOption, AlgoPage, AlgoValue, RangeOp } from './pages'
export {
  ITEM_MOD_CATEGORIES, ITEM_MOD_PAGE_IDS, MAX_ANCHOR_TEXT, buildItemModData, filterItemMods, isItemModPageId, itemModCategory,
  itemModFragment, itemModGroupCounts, itemModPage, parseStatsNdjson
} from './pages'
export type { ItemModCategory, ItemModData, ItemModEntryData, ItemModExcludeReason, ItemModFilter, ModAnchor } from './pages'
export { combine, escapeTerm } from './combine'
export type { CombineInput, CombineResult, CombineSel, Conflict, ConflictKind, PageContribution } from './combine'
export {
  SHARE_MAX_CODE_CHARS, SHARE_MAX_JSON_BYTES, SHARE_VERSION, base64url, decodeShare, encodeShare, fromBase64url, migrateShareSections, normalizeShareState, parseTemplates,
  resolveState
} from './share'
export type { RegexTemplate, ResolvedState, ShareState } from './share'
export { bookmarkApplyOf, bookmarkBodyOf, combineSels, resolvedValues, savedPicksOf, shareStateOf, valuesOfPage } from './embed'
export type { BookmarkApply, PicksMap, ValuesMap } from './embed'
export { bookmarkHotkeys, bookmarkQuery, findBookmark, quickBookmarks } from './quick'
export {
  CONDITION_SECTIONS, RARITY_LABEL_KEYS, conditionSections, encodeRarityChoice, isConditionSectionId, parseRarityChoice, rarityConditionEntry,
  rarityConditionText,
  toggleCorruptionIn, toggleRarityIn
} from './rarity'
export type { Corruption, RarityChoice } from './rarity'
export {
  FOLDER_NAME_MAX, addFolder, deleteFolder, folderCounts, folderList, groupBookmarks, isFolderCollapsed, moveBookmark, moveBookmarkBy,
  moveFolderBy, moveFolderTo, normalizeFolderName, normalizeFolders, renameFolder, setFolderCollapsed, sortBookmarks
} from './folders'
export type { BookmarkFolder, BookmarkGroup, FolderResult, GroupedBookmarks } from './folders'
export type { BookmarkHotkey, BookmarkQuery } from './quick'
