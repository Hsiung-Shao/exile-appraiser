// 演算法頁:商店 / 物品條件(kind 'sockets')。連結數、鏈接顏色、插槽顏色數、物品等級、品質、已汙染、勢力基底、寶石等級。
//
// ⚠ 假設:繁中客戶端的插槽行顯示為 `R-G-B`(顏色字母與 `-` 不翻譯)。**尚未進遊戲實測**,這幾條標 `untested`,UI 顯示「待實測」。
// 標籤文字(物品等級、品質、插槽、已汙染、勢力、等級)取自 clientstrings(labels);項目名稱(連結數等)是介面字串,不是遊戲文字。
import type { RegexGame, RegexLabels } from '../data'
import { labelBase, linkColors, linkedSockets, propertyFragment, socketColorCount, wholeLine } from './frag'
import type { AlgoEntry, AlgoOption, AlgoPage } from './types'
import { RARITY_LABEL_KEYS, rarityConditionEntry } from '../rarity'

const INFLUENCES: Array<{ id: string, key: string }> = [
  { id: 'shaper', key: 'ItemPopupShaperItem' },
  { id: 'elder', key: 'ItemPopupElderItem' },
  { id: 'crusader', key: 'ItemPopupCrusaderItem' },
  { id: 'redeemer', key: 'ItemPopupRedeemerItem' },
  { id: 'hunter', key: 'ItemPopupHunterItem' },
  { id: 'warlord', key: 'ItemPopupWarlordItem' },
  { id: 'exarch', key: 'ItemPopupSearingExarchItem' },
  { id: 'eater', key: 'ItemPopupEaterofWorldsItem' }
]

export const VENDOR_LABEL_KEYS: Record<RegexGame, string[]> = {
  poe1: ['ItemLevelPopup', 'Quality', 'ItemDisplayStringSockets', 'Level', ...RARITY_LABEL_KEYS, ...INFLUENCES.map(i => i.key)],
  poe2: ['ItemLevelPopup', 'Quality', 'Level', ...RARITY_LABEL_KEYS]
}

const COLOR_OPTIONS: AlgoOption[] = [
  { id: 'r', zh: '紅 R', en: 'Red R' },
  { id: 'g', zh: '綠 G', en: 'Green G' },
  { id: 'b', zh: '藍 B', en: 'Blue B' },
  { id: 'w', zh: '白 W', en: 'White W' }
]

function base (id: string, g: number, zh: string, en: string): Omit<AlgoEntry, 'input' | 'fragment'> {
  return { id, g, t17: false, affixZh: '', zh: [zh], en: [en], hiddenZh: [], hiddenEn: [] }
}

export function vendorPages (game: RegexGame, labels: RegexLabels | null): AlgoPage[] {
  if (!labels) return []
  const L = (key: string): { zh: string, en: string } | null => {
    const zh = labels.zh[key]
    const en = labels.en[key]
    return zh && en ? { zh, en } : null
  }
  const entries: AlgoEntry[] = []
  const poe1 = game === 'poe1'

  const sockets = L('ItemDisplayStringSockets')
  if (poe1) {
    entries.push({
      ...base('links', 0, '連結數(≥)', 'Linked sockets (≥)'),
      untested: true,
      input: {
        kind: 'select',
        options: [
          { id: '6', zh: '6L', en: '6L' }, { id: '5', zh: '5L', en: '5L' },
          { id: '4', zh: '4L', en: '4L' }, { id: '3', zh: '3L', en: '3L' }
        ],
        def: { choice: '6' }
      },
      fragment: v => linkedSockets(Number(v.choice))
    })
    entries.push({
      ...base('link_colors', 0, '鏈接顏色(任意順序、相鄰)', 'Linked colours (any order, adjacent)'),
      untested: true,
      input: { kind: 'colors', maxTotal: 6, def: { choice: 'rgb' } },
      fragment: v => linkColors(v.choice ?? '')
    })
    if (sockets) {
      entries.push({
        ...base('socket_colors', 0, '插槽顏色數(≥)', 'Socket colour count (≥)'),
        untested: true,
        input: { kind: 'count', options: COLOR_OPTIONS, lo: 1, hi: 6, def: { choice: 'b', min: 3 } },
        fragment: (v, lang) => socketColorCount(lang === 'zh' ? sockets.zh : sockets.en, v.choice ?? '', v.min ?? 0)
      })
    }
  }

  const ilvl = L('ItemLevelPopup')
  if (ilvl) {
    entries.push({
      ...base('ilvl', 1, labelBase(ilvl.zh), labelBase(ilvl.en)),
      input: { kind: 'range', digits: 3, percent: false, ops: ['ge', 'le', 'range'], lo: 1, hi: 100, def: { min: 86 } },
      fragment: (v, lang) => propertyFragment(lang === 'zh' ? ilvl.zh : ilvl.en, v, 3, false)
    })
  }
  const quality = L('Quality')
  if (quality) {
    entries.push({
      ...base('quality', 1, labelBase(quality.zh), labelBase(quality.en)),
      input: { kind: 'range', digits: 2, percent: true, ops: ['ge', 'le', 'range'], lo: 0, hi: 30, def: { min: 20 } },
      fragment: (v, lang) => propertyFragment(lang === 'zh' ? quality.zh : quality.en, v, 2, true)
    })
  }
  const gemLevel = L('Level')
  if (gemLevel) {
    entries.push({
      ...base('gem_level', 1, `寶石${labelBase(gemLevel.zh)}(≥)`, `Gem ${labelBase(gemLevel.en)} (≥)`),
      input: { kind: 'range', digits: 2, percent: false, ops: ['ge'], lo: 1, hi: 21, def: { min: 20 } },
      // 行首錨定:「等級」也出現在「物品等級」「怪物等級」「需求等級」裡
      fragment: (v, lang) => propertyFragment(lang === 'zh' ? gemLevel.zh : gemLevel.en, { min: v.min }, 2, false, true)
    })
  }
  // 第 40 步:原本的「已汙染」勾選列換成稀有度 | 汙染條件列;id 仍是 `corrupted`、預設 `|c`(只有已汙染)
  // → 舊書籤 / 分享碼的「已汙染」輸出逐字相同(`^已汙染$`),現在另可選未汙染與稀有度
  const cond = rarityConditionEntry(labels, 'corrupted', '|c', 1)
  if (cond) entries.push(cond)
  if (poe1) {
    const infl = INFLUENCES.map(i => ({ id: i.id, t: L(i.key) })).filter((x): x is { id: string, t: { zh: string, en: string } } => x.t !== null)
    if (infl.length) {
      entries.push({
        ...base('influence', 2, '勢力基底', 'Influenced base'),
        input: {
          kind: 'select',
          options: [{ id: 'any', zh: '任一勢力', en: 'Any influence' }, ...infl.map(x => ({ id: x.id, zh: labelBase(x.t.zh), en: labelBase(x.t.en) }))],
          def: { choice: 'any' }
        },
        fragment: (v, lang) => {
          const pick = v.choice === 'any' || !v.choice ? infl : infl.filter(x => x.id === v.choice)
          return pick.length ? wholeLine(pick.map(x => lang === 'zh' ? x.t.zh : x.t.en)) : null
        }
      })
    }
  }
  if (!entries.length) return []
  return [{
    game,
    id: poe1 ? 'vendor_items' : 'vendor_items_poe2',
    kind: 'sockets',
    title: '商店 / 物品條件',
    titleEn: 'Vendor & item conditions',
    note: poe1
      ? '連結、插槽顏色、物品等級、品質、已汙染、勢力。每條各自一個 term(同時成立)。插槽相關假設繁中客戶端顯示 R-G-B 不翻譯,待實測。'
      : '物品等級、品質、已汙染、寶石等級。每條各自一個 term(同時成立)。',
    limit: 250,
    groups: poe1 ? ['插槽與連結', '物品屬性', '勢力'] : ['插槽與連結', '物品屬性'],
    groupsEn: poe1 ? ['Sockets & links', 'Item properties', 'Influence'] : ['Sockets & links', 'Item properties'],
    entries,
    ambientZh: [],
    ambientEn: [],
    namePrefixZh: [],
    nameSuffixZh: [],
    namePrefixEn: [],
    nameSuffixEn: []
  }]
}
