// 第 40 步(2026-10-06):稀有度 | 汙染條件列 —— 一列兩組按鈕「普通 魔法 稀有 傳奇 | 未汙染 已汙染」。
//
// 第 35 步地圖 / 換界石數值區的稀有度單選列(`item_rarity_class`)擴充而來:稀有度改可多選、併入汙染二選一(可都不選),
// 並加到物品基底、商店 / 物品條件、物品詞綴數值、碑牌詞綴(使用者裁定;第一版的面板頂端全域按鈕已撤回)。
//
// 值存在 `AlgoValue.choice`:稀有度字母(n 普通 / m 魔法 / r 稀有 / u 傳奇,依此順序)+ 選填 `|u`(未汙染)或 `|c`(已汙染),
// 例如 `mr|u`、`|c`、`r`(最長 6 字,不受讀檔的 16 字截斷影響)。第 35 步存的單字 `normal` / `magic` / `rare` / `unique`
// 照讀 = 只選那一個 → 舊 state / 書籤 / 分享碼不用遷移,輸出逐字相同。
//
// 輸出兩個獨立 AND term(`AlgoEntry.terms`):
//   稀有度:選一個 = `rarityFragment`(第 35 步原樣,`稀有度[:：] *稀有`);選多個 = `稀有度[:：] *(魔法|稀有)`(固定順序);全選 = 不加。
//   汙染:已汙染 = `^已汙染$`(整行,與商店頁原本的片段相同);未汙染 = `!^已汙染$`(combine 對 `!` 開頭加引號)。
// R10(2026-10-09)起:稀有度改短寫「度: 稀」/「度: [魔稀]」、汙染在有詞綴語料時改最短安全前綴(見下方 conditionTermsFor);
// 合併時多列條件併成一個選取(combine.ts)。上面兩行是退回寫法。
// 標籤取自 clientstrings:`ItemDisplayStringRarity` + `ItemDisplayString{Normal,Magic,Rare,Unique}`(PoE2 普通 =「中」)、`ItemPopupCorrupted`。
import type { RegexGame, RegexLabels, RegexLang } from './data'
import { labelBase, rarityFragment, wholeLine } from './pages/frag'
import type { AlgoEntry, AlgoOption, AlgoPage, AlgoValue, CondGuard } from './pages/types'
import { SECTION_HOSTS } from './sections'

export const RARITY_LABEL_KEY = 'ItemDisplayStringRarity'
export const CORRUPTED_LABEL_KEY = 'ItemPopupCorrupted'
export const RARITY_OPTIONS: ReadonlyArray<{ id: string, letter: string, key: string }> = [
  { id: 'normal', letter: 'n', key: 'ItemDisplayStringNormal' },
  { id: 'magic', letter: 'm', key: 'ItemDisplayStringMagic' },
  { id: 'rare', letter: 'r', key: 'ItemDisplayStringRare' },
  { id: 'unique', letter: 'u', key: 'ItemDisplayStringUnique' }
]
/** 條件列用到的 clientstrings 鍵(測試檢查它們都在 labels 暫代檔裡;兩遊戲相同) */
export const RARITY_LABEL_KEYS: readonly string[] = [RARITY_LABEL_KEY, ...RARITY_OPTIONS.map(o => o.key), CORRUPTED_LABEL_KEY]

export type Corruption = '' | 'uncorrupted' | 'corrupted'

export interface RarityChoice {
  /** 選到的稀有度 id(依固定順序) */
  rarity: string[]
  corruption: Corruption
}

/** choice → 選取;壞值 / 沒給 = 什麼都沒選 */
export function parseRarityChoice (choice: string | undefined): RarityChoice {
  const c = (choice ?? '').trim()
  const legacy = RARITY_OPTIONS.find(o => o.id === c)
  if (legacy) return { rarity: [legacy.id], corruption: '' }
  // 只認完整格式(壞值不部分解析:「nope」不能變成「普通」)
  if (!/^[nmru]*(\|[uc])?$/.test(c)) return { rarity: [], corruption: '' }
  const [letters, corr = ''] = c.split('|')
  const rarity = RARITY_OPTIONS.filter(o => letters.includes(o.letter)).map(o => o.id)
  const corruption: Corruption = corr === 'u' ? 'uncorrupted' : corr === 'c' ? 'corrupted' : ''
  return { rarity, corruption }
}

/** 選取 → choice(稀有度依固定順序;沒有汙染條件就不帶 `|`) */
export function encodeRarityChoice (c: RarityChoice): string {
  const letters = RARITY_OPTIONS.filter(o => c.rarity.includes(o.id)).map(o => o.letter).join('')
  return c.corruption ? `${letters}|${c.corruption === 'uncorrupted' ? 'u' : 'c'}` : letters
}

/** 點一下稀有度按鈕(多選切換) */
export function toggleRarityIn (choice: string | undefined, id: string): string {
  const c = parseRarityChoice(choice)
  const rarity = c.rarity.includes(id) ? c.rarity.filter(x => x !== id) : [...c.rarity, id]
  return encodeRarityChoice({ rarity, corruption: c.corruption })
}

/** 點一下汙染按鈕(二選一,再點同一個 = 取消) */
export function toggleCorruptionIn (choice: string | undefined, corruption: 'uncorrupted' | 'corrupted'): string {
  const c = parseRarityChoice(choice)
  return encodeRarityChoice({ rarity: c.rarity, corruption: c.corruption === corruption ? '' : corruption })
}

interface ConditionLabels {
  label: { zh: string, en: string }
  rarity: AlgoOption[]
  corrupted: { zh: string, en: string }
}

function conditionLabels (labels: RegexLabels | null): ConditionLabels | null {
  if (!labels) return null
  const zh = labels.zh[RARITY_LABEL_KEY]
  const en = labels.en[RARITY_LABEL_KEY]
  const cz = labels.zh[CORRUPTED_LABEL_KEY]
  const ce = labels.en[CORRUPTED_LABEL_KEY]
  if (!zh || !en || !cz || !ce) return null
  const rarity: AlgoOption[] = []
  for (const o of RARITY_OPTIONS) {
    const oz = labels.zh[o.key]
    const oe = labels.en[o.key]
    if (oz && oe) rarity.push({ id: o.id, zh: oz, en: oe })
  }
  if (!rarity.length) return null
  return { label: { zh, en }, rarity, corrupted: { zh: cz, en: ce } }
}

// ---- R10(2026-10-09;PobTools regex_algo_pages.cpp ShortRarity / ShortCorrupted / ConditionTermsFor)----
// 遊戲兩代都印「稀有度: 稀有」/「Rarity: Rare」(半形冒號 + 一空白),所以稀有度 term 縮成「標籤末字: 值首字」
// (`度: 稀`、`y: r`;多選 = 固定順序的字元類 `度: [魔稀]`);命中參與語料的其他行就退回第 35 / 40 步的完整寫法。
// 汙染:只有詞綴類語料頁參與(語料 = 物品本身的行)時才縮成「已汙染」的最短安全前綴(中文 ≥ 2 字、英文 ≥ 4 字),
// 否則整行 `^已汙染$`。

/** 以碼位計(JS 字串索引是 UTF-16) */
const cps = (s: string): string[] => Array.from(s)
/** 只摺 ASCII A–Z(與 C++ LowerCp 相同) */
const lowerCp = (c: string): string => (c >= 'A' && c <= 'Z' ? c.toLowerCase() : c)
const SYNTAX = '\\^$.|?*+()[]{}-! "'
/** 片段裡可當字面字元的碼位(不是正則語法、不是空白 / 控制字元) */
const plainCp = (c: string): boolean => (c.codePointAt(0) ?? 0) > 0x20 && !SYNTAX.includes(c)

/** 短稀有度 term;四個值的首字不是四個相異的字面字元 = null */
function shortRarity (l: ConditionLabels, label: string, c: RarityChoice, lang: RegexLang): string | null {
  const base = cps(labelBase(label))
  if (!base.length || !plainCp(base[base.length - 1])) return null
  const firsts: string[] = []
  const picked: string[] = []
  for (const o of l.rarity) {
    const v = cps((lang === 'zh' ? o.zh : o.en).trim())
    if (!v.length || !plainCp(v[0])) return null
    const f = lowerCp(v[0])
    if (firsts.includes(f)) return null
    firsts.push(f)
    if (c.rarity.includes(o.id)) picked.push(f)
  }
  if (!picked.length) return null
  const vals = picked.join('')
  return `${lowerCp(base[base.length - 1])}: ${picked.length > 1 ? `[${vals}]` : vals}`
}

/** 「已汙染」/「Corrupted」不中語料其他行的最短前綴(至少中文 2 字 / 拉丁 4 字);沒有安全的 = null */
function shortCorrupted (label: string, g: CondGuard): string | null {
  const base = cps(labelBase(label))
  const ascii = base.every(ch => (ch.codePointAt(0) ?? 0) < 0x80)
  const minLen = ascii ? 4 : 2
  let cand = ''
  for (let k = 0; k + 1 < base.length; k++) {
    if (!plainCp(base[k])) return null
    cand += lowerCp(base[k])
    if (k + 1 < minLen) continue
    if (!g.hits(cand)) return cand
  }
  return null
}

/** 已合併的選取 → term 陣列([稀有度?, 汙染?];都沒有 = null)。`g` = 語料防護,null = 沒有語料頁參與 */
function conditionTermsFor (l: ConditionLabels, c: RarityChoice, lang: RegexLang, g: CondGuard | null): string[] | null {
  const out: string[] = []
  const picked = l.rarity.filter(o => c.rarity.includes(o.id))
  if (picked.length && picked.length < l.rarity.length) {
    const label = lang === 'zh' ? l.label.zh : l.label.en
    const vals = picked.map(o => lang === 'zh' ? o.zh : o.en)
    let f = shortRarity(l, label, c, lang)
    if (f !== null && g?.hits(f)) f = null
    if (f === null) f = vals.length === 1 ? rarityFragment(label, vals[0]) : `${labelBase(label)}[:：] *(${vals.map(x => x.trim()).join('|')})`
    if (f) out.push(f)
  }
  if (c.corruption) {
    const label = lang === 'zh' ? l.corrupted.zh : l.corrupted.en
    let f: string | null = null
    if (g?.itemText) f = shortCorrupted(label, g)
    if (f === null) f = wholeLine([label])
    if (f) out.push(c.corruption === 'uncorrupted' ? `!${f}` : f)
  }
  return out.length ? out : null
}

/** 單一列自己的 term(沒有語料):稀有度短寫、汙染整行。列的顯示與「有沒有說任何條件」用它 */
function conditionTerms (l: ConditionLabels, v: AlgoValue, lang: RegexLang): string[] | null {
  return conditionTermsFor(l, parseRarityChoice(v.choice), lang, null)
}

/**
 * 稀有度 | 汙染條件列。`id` = 存檔 / 書籤 / 分享碼的鍵(地圖 / 換界石數值區沿用 `item_rarity_class`、商店頁沿用 `corrupted`),
 * `def` = 勾選時的預設值(必須產得出 term)。標籤缺 = null(不猜譯名)。
 */
export function rarityConditionEntry (labels: RegexLabels | null, id: string, def: string, g = 0): AlgoEntry | null {
  const l = conditionLabels(labels)
  if (!l) return null
  const corruptedZh = labelBase(l.corrupted.zh)
  const corruptedEn = labelBase(l.corrupted.en)
  return {
    id,
    g,
    t17: false,
    affixZh: '',
    zh: [labelBase(l.label.zh)],
    en: [labelBase(l.label.en)],
    hiddenZh: [],
    hiddenEn: [],
    input: {
      kind: 'rarity',
      options: l.rarity,
      corruption: [
        // 「未汙染」是介面字(遊戲只有「已汙染」行):去掉「已」加「未」
        { id: 'uncorrupted', zh: `未${corruptedZh.replace(/^已/, '')}`, en: `Not ${corruptedEn}` },
        { id: 'corrupted', zh: corruptedZh, en: corruptedEn }
      ],
      def: { choice: def }
    },
    terms: (v, lang) => conditionTerms(l, v, lang),
    condTerms: (c, lang, g) => conditionTermsFor(l, c, lang, g),
    fragment: (v, lang) => conditionTerms(l, v, lang)?.join(' ') ?? null,
    // 汙染 term 整行比對「已汙染」:語料裡這一行本身(ambient / 隱藏行)就是要比對的對象
    ownLine: line => line === l.corrupted.zh || line === l.corrupted.en
  }
}

/** 各遊戲的條件區(只有一列條件列的嵌入式 section 頁)內部頁 id;宿主頁 id 查 sections.ts `SECTION_HOSTS` */
export const CONDITION_SECTIONS: Readonly<Record<RegexGame, readonly string[]>> = {
  poe1: ['vendor_bases_cond', 'item_mod_values_cond'],
  poe2: ['vendor_bases_cond', 'tablet_mods_cond', 'item_mod_values_poe2_cond']
}

/** 是不是條件區(只有稀有度 | 汙染一列;UI 用不同的標題與說明) */
export function isConditionSectionId (id: string): boolean {
  return CONDITION_SECTIONS.poe1.includes(id) || CONDITION_SECTIONS.poe2.includes(id)
}

/** 一個遊戲的條件區頁(宿主頁不存在也照建:合併時 `combineOrder` 只跟著存在的宿主走) */
export function conditionSections (game: RegexGame, labels: RegexLabels | null): AlgoPage[] {
  const e = rarityConditionEntry(labels, 'item_rarity_class', 'r')
  if (!e) return []
  return CONDITION_SECTIONS[game].map(id => ({
    game,
    id,
    kind: 'numeric',
    sectionOf: SECTION_HOSTS[id],
    title: '稀有度 / 汙染',
    titleEn: 'Rarity / corruption',
    note: '物品稀有度(可多選)與是否汙染,各自一個 term(同時成立);與這一頁的勾選合成同一條字串。',
    limit: 250,
    groups: ['條件'],
    groupsEn: ['Conditions'],
    entries: [e],
    ambientZh: [],
    ambientEn: [],
    namePrefixZh: [],
    nameSuffixZh: [],
    namePrefixEn: [],
    nameSuffixEn: []
  }))
}

/** 條件列的顯示文字:「魔法、稀有 · 未汙染」;什麼都沒選 = null */
export function rarityConditionText (e: AlgoEntry, v: AlgoValue, lang: RegexLang): string | null {
  if (e.input.kind !== 'rarity') return null
  const c = parseRarityChoice(v.choice)
  const name = (o: AlgoOption): string => lang === 'en' ? o.en : o.zh
  const parts: string[] = []
  const r = e.input.options.filter(o => c.rarity.includes(o.id))
  if (r.length) parts.push(r.map(name).join(lang === 'en' ? ', ' : '、'))
  const corr = e.input.corruption.find(o => o.id === c.corruption)
  if (corr) parts.push(name(corr))
  return parts.length ? parts.join(' · ') : null
}
