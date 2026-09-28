import { CLIENT_STRINGS as _$ } from '@/assets/data'
import type { ParsedStat } from './stat-translations'
import { ModifierType } from './modifiers'

export const SCOURGE_LINE = ' (scourge)'
export const ENCHANT_LINE = ' (enchant)'
export const IMPLICIT_LINE = ' (implicit)'

export interface ParsedModifier {
  info: ModifierInfo
  stats: ParsedStat[]
}

export interface ModifierInfo {
  type: ModifierType
  generation?: 'suffix' | 'prefix' | 'corrupted' | 'eldritch' | 'foulborn' | 'vestigial'
  name?: string
  tier?: number
  rank?: number
  tags: string[]
  rollIncr?: number
}

/**
 * 標籤分隔符。上游只認 em-dash(U+2014),而上游 issue #1869 的繁中回報用的是
 * 半形 hyphen:
 *
 *     { 前綴 "運動員的"(階層：1)— 生命 }      本專案 corpus 的樣本(em-dash)
 *     { 前綴 "健康的" (階層：8)- 生命 }        issue #1869(半形 hyphen)
 *
 * ⚠ 無法確定那個 hyphen 是真的客戶端差異,還是回報者手打進 GitHub 時的產物 ——
 * 同一則回報裡的基底名「遠古堅甲」經四方查證(本機國際服 GGPK 遊戲檔、
 * GGPK_zh 字典、poedb、APT 出貨資料)確定是「遠古脛甲」的誤植,所以這份樣本
 * 的可信度是打折的。
 *
 * 因此採「嚴格優先、失敗才放寬」:先照上游的 em-dash 切,切完解析得動就用它;
 * 只有在**原本就會 throw** 的情況下才退回寬鬆分隔符。這樣現有行為一個位元都不會變,
 * 而原本會整件解析失敗的輸入多一次機會。
 *
 * 半形 hyphen 只在「右括號之後、且後面接空白」時才視為分隔符 —— 直接用
 * `[—-]` 全域切會切壞詞綴名或標籤裡合法出現的連字號。
 */
const MOD_INFO_SEPARATOR_STRICT = '\u2014'
const MOD_INFO_SEPARATOR_RELAXED = /\u2014|(?<=\))\s*-(?=\s)/

interface AnnotationWord {
  text: string
  type?: ModifierType
  generation?: ModifierInfo['generation']
}

let annotationCache: { key: object, words: AnnotationWord[] } | undefined

/**
 * 詞綴標註的角色表,最長優先。
 *
 * GGG 的標註是「wrapper × core」組出來的 —— GGPK clientstrings 的 `ModDescriptionLine*`
 * 是 `Master Crafted {0}`、`Fractured {0}`、`Prefix Modifier "{0}"` 這種模板。上游把每一種
 * **組合**寫成一個常數,再用全字串 `switch` 比對,所以是 O(wrapper × core) 而且每個新賽季
 * 都得改程式。後果現在就看得到:3.29 的 `殘存固定詞綴` 整條落到 Explicit,
 * 篩選器會把一條固定詞綴當成一般詞綴生。
 *
 * 改成 PobTools 的做法(`translate/translation_manager.cpp` 的 `rebuild_mod_annotation`):
 * **最長優先 + 找到就消耗**。「固定詞綴」因此偷不走「已汙染固定詞綴」,而已知的字
 * 可以任意組合、任意順序。
 *
 * 只有在載入的語系真的有那個字串時才進表 —— 見 `VESTIGIAL_IMPLICIT` 的選填理由。
 */
function annotationWords (): AnnotationWord[] {
  if (annotationCache?.key === _$) return annotationCache.words

  const words: AnnotationWord[] = []
  const add = (
    text: string | undefined,
    type?: ModifierType,
    generation?: ModifierInfo['generation']
  ) => { if (text) words.push({ text, type, generation }) }

  add(_$.CRAFTED_PREFIX, ModifierType.Crafted, 'prefix')
  add(_$.CRAFTED_SUFFIX, ModifierType.Crafted, 'suffix')
  add(_$.FRACTURED_PREFIX, ModifierType.Fractured, 'prefix')
  add(_$.FRACTURED_SUFFIX, ModifierType.Fractured, 'suffix')
  add(_$.CORRUPTED_IMPLICIT, ModifierType.Implicit, 'corrupted')
  // 標成 vestigial 而不是只給 Implicit:殘存詞綴是籠罩晶石**隨機**賦予的,不是
  // 這件傳奇本來就有的固定敘述,買家要能單獨篩它。分不出來的話,篩選器那層就只能
  // 把它當成普通固定詞綴,而普通固定詞綴沒有數值時會被 hide_const_roll 藏起來。
  add(_$.VESTIGIAL_IMPLICIT, ModifierType.Implicit, 'vestigial')
  add(_$.IMPLICIT_MODIFIER, ModifierType.Implicit)
  add(_$.PREFIX_MODIFIER, undefined, 'prefix')
  add(_$.SUFFIX_MODIFIER, undefined, 'suffix')
  add(_$.FOULBORN_MODIFIER, undefined, 'foulborn')

  words.sort((a, b) => b.text.length - a.text.length)
  annotationCache = { key: _$, words }
  return words
}

/**
 * 把標註的 type 段解成 `{ type, generation }`。
 *
 * ⚠ 與 PobTools 的一個**刻意差異**:整段沒被吃乾淨就回 `undefined`,呼叫端據此
 * 完全照上游行為走(Explicit、無 generation)。PobTools 只服務繁中而且手上有 GGPK
 * 全表,可以放心輸出局部旗標;APT 出四個語系,我們只有 `en` / `cmn-Hant` 的可信全表。
 * 允許局部匹配的話,`附魔固定詞綴`(Enchantment Modifier)會因為包含「固定詞綴」
 * 被判成 Implicit,但英文的 `Enchantment Modifier` 不含 `Implicit Modifier`
 * —— 同一件物品在兩個語系會解出不同結果,那比少認一個標註嚴重得多。
 *
 * 「認不得就照舊」也讓這次改動成為現行行為的嚴格超集:今天會匹配的字串,
 * 一定整段吃得乾淨,結果逐欄不變。
 */
function matchAnnotation (typeText: string): Pick<ModifierInfo, 'type' | 'generation'> | undefined {
  let rest = typeText
  let type: ModifierType | undefined
  let generation: ModifierInfo['generation']

  for (const word of annotationWords()) {
    const at = rest.indexOf(word.text)
    if (at === -1) continue
    rest = rest.slice(0, at) + rest.slice(at + word.text.length)
    if (word.type !== undefined && type === undefined) type = word.type
    if (word.generation !== undefined && generation === undefined) generation = word.generation
  }

  if (rest.trim().length > 0) return undefined
  return { type: type ?? ModifierType.Explicit, generation }
}

export function parseModInfoLine (line: string): ModifierInfo {
  try {
    return parseModInfoLineWith(line, MOD_INFO_SEPARATOR_STRICT)
  } catch (strictError) {
    try {
      return parseModInfoLineWith(line, MOD_INFO_SEPARATOR_RELAXED)
    } catch {
      // 兩種都不行就回報嚴格模式的錯誤 —— 那才是真正該修的訊息
      throw strictError
    }
  }
}

function parseModInfoLineWith (line: string, separator: string | RegExp): ModifierInfo {
  const [modText, xText2, xText3] = line
    .slice(1, -1)
    .split(separator as string)
    .map(_ => _.trim())

  let type = ModifierType.Explicit
  let generation: ModifierInfo['generation']
  let name: ModifierInfo['name']
  let tier: ModifierInfo['tier']
  let rank: ModifierInfo['rank']

  if (_$.EATER_IMPLICIT.test(modText) || _$.EXARCH_IMPLICIT.test(modText)) {
    const match = modText.match(_$.EATER_IMPLICIT) ?? modText.match(_$.EXARCH_IMPLICIT)!

    type = ModifierType.Implicit
    generation = 'eldritch'

    switch (match.groups!.rank) {
      case _$.ELDRITCH_MOD_R1: rank = 1; break
      case _$.ELDRITCH_MOD_R2: rank = 2; break
      case _$.ELDRITCH_MOD_R3: rank = 3; break
      case _$.ELDRITCH_MOD_R4: rank = 4; break
      case _$.ELDRITCH_MOD_R5: rank = 5; break
      case _$.ELDRITCH_MOD_R6: rank = 6; break
    }
  } else {
    const match = modText.match(_$.MODIFIER_LINE)
    if (!match) {
      throw new Error('Invalid regex for mod info line')
    }

    // 認不得就維持 Explicit / 無 generation —— 與上游的 switch 落空時一致。
    const role = matchAnnotation(match.groups!.type)
    if (role) {
      type = role.type!
      generation = role.generation
    }

    name = match.groups!.name ?? undefined
    tier = Number(match.groups!.tier) || undefined
    rank = Number(match.groups!.rank) || undefined
  }

  let tags: ModifierInfo['tags']
  let rollIncr: ModifierInfo['rollIncr']
  {
    const incrText = (xText3 !== undefined)
      ? xText3
      : (xText2 !== undefined && _$.MODIFIER_INCREASED.test(xText2))
          ? xText2
          : undefined

    const tagsText = (xText2 !== undefined && incrText !== xText2)
      ? xText2
      : undefined

    // 上游是 `split(', ')`(逗號 + 空格)—— 那是英文的寫法。
    // 繁中用不帶空格的逗號(`防禦,護甲`),照上游切會整串黏成一個 tag。
    // 兩種都吃,順帶容忍全形逗號與頓號。
    tags = tagsText ? tagsText.split(/\s*[,，、]\s*/).filter(t => t.length > 0) : []
    rollIncr = incrText ? Number(_$.MODIFIER_INCREASED.exec(incrText)![1]) : undefined
  }

  return { type, generation, name, tier, rank, tags, rollIncr }
}

export function isModInfoLine (line: string): boolean {
  return line.startsWith('{') && line.endsWith('}')
}

interface GroupedModLines {
  modLine: string
  statLines: string[]
}

export function * groupLinesByMod (lines: string[]): Generator<GroupedModLines, void> {
  if (!lines.length || !isModInfoLine(lines[0])) {
    return
  }

  let last: GroupedModLines | undefined
  for (const line of lines) {
    if (!isModInfoLine(line)) {
      last!.statLines.push(line)
    } else {
      if (last) { yield last }
      last = { modLine: line, statLines: [] }
    }
  }
  yield last!
}

export function parseModType (lines: string[]): { modType: ModifierType, lines: string[] } {
  let modType: ModifierType
  if (lines.some(line => line.endsWith(SCOURGE_LINE))) {
    modType = ModifierType.Scourge
    lines = removeLinesEnding(lines, SCOURGE_LINE)
  } else if (lines.some(line => line.endsWith(ENCHANT_LINE))) {
    modType = ModifierType.Enchant
    lines = removeLinesEnding(lines, ENCHANT_LINE)
  } else if (lines.some(line => line.endsWith(IMPLICIT_LINE))) {
    modType = ModifierType.Implicit
    lines = removeLinesEnding(lines, IMPLICIT_LINE)
  } else {
    throw new Error('Expected to be used only on lines that have modifier type')
  }

  return { modType, lines }
}

function removeLinesEnding (
  lines: readonly string[], ending: string
): string[] {
  return lines.map(line =>
    line.endsWith(ending)
      ? line.slice(0, -ending.length)
      : line
  )
}

// stat values internally stored as ints,
// this is the most common formatter
const DIV_BY_100 = 2

export function applyIncr (mod: ModifierInfo, parsed: ParsedStat): ParsedStat | null {
  const { rollIncr } = mod
  const { roll } = parsed

  if (!rollIncr || !roll || roll.unscalable) {
    return null
  }

  return {
    stat: parsed.stat,
    translation: parsed.translation,
    roll: {
      unscalable: roll.unscalable,
      dp: roll.dp,
      value: incrRoll(roll.value, rollIncr, (roll.dp) ? DIV_BY_100 : 0),
      min: incrRoll(roll.min, rollIncr, (roll.dp) ? DIV_BY_100 : 0),
      max: incrRoll(roll.max, rollIncr, (roll.dp) ? DIV_BY_100 : 0)
    }
  }
}

export function incrRoll (
  value: number,
  p: number,
  dp: number
): number {
  const res = value + (value * p / 100)
  const rounding = Math.pow(10, dp)
  return Math.trunc((res + Number.EPSILON) * rounding) / rounding
}
