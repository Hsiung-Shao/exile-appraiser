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
