// @exile-appraiser/regex:Poe Regex(遊戲搜尋列字串產生器)核心,移植自 PobTools。純 TS,無 DOM / Node API。
// 讀檔請用 `@exile-appraiser/regex/node`(或呼叫端自行讀字串後丟 parseRegexCatalogue)。
export { Corpus, charCount, charOffsets, fold } from './gen'
export type { Ambient, Check, Entry, Mode, Options, Result } from './gen'
export { buildCorpus, entryLines, entryTitle, pageAmbient, parseRegexCatalogue } from './data'
export type { BuildCorpusOptions, RegexCatalogue, RegexEntry, RegexGame, RegexLang, RegexPage } from './data'
export {
  applyKeys, collectKeys, defaultRegexState, keyOf, parseRegexState, picksFor, resolveKeys, serializeRegexState, zhLine
} from './state'
export type { ParsedRegexState, RegexBookmark, RegexPagePicks, RegexUiState } from './state'
export { Rng, samplePicks } from './rng'
export { enLine, entryMatches, extraLines, hiddenPreview, lengthLevel, lineIn, otherLine, pageHasT17, visibleRows } from './view'
export type { LengthLevel, ListFilter, T17Filter } from './view'
export { domainMax, naiveRangeRegex, normalizeRange, rangeRegex } from './numeric'
export type { NumOptions, NumRange } from './numeric'
export { PAGE_KINDS, isCorpusPage, mergeLabels, normalizeLabel, parseLabels } from './data'
export type { PageKind, RegexLabels } from './data'
export {
  NUMERIC_LABEL_KEYS, VENDOR_LABEL_KEYS, algoPages, applyPageKeys, defaultValue, entryKey, isAlgoPage, labelBase,
  linkColors, linkedSockets, numericPages, pageKeysOf, propertyFragment, rangeOp, sanitizeValue, socketColorCount,
  valueUsable, vendorPages, wholeLine
} from './pages'
export type { AlgoEntry, AlgoInput, AlgoKind, AlgoOption, AlgoPage, AlgoValue, RangeOp } from './pages'
export { combine, escapeTerm } from './combine'
export type { CombineInput, CombineResult, CombineSel, Conflict, ConflictKind, PageContribution } from './combine'
export {
  SHARE_VERSION, base64url, decodeShare, encodeShare, fromBase64url, normalizeShareState, parseTemplates, resolveState
} from './share'
export type { RegexTemplate, ResolvedState, ShareState } from './share'
