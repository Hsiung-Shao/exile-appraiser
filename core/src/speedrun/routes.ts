// speedrun 計時器(2026-11-10):路線(分段清單 + 個人最佳 + 金段)與內建章節路線。
// 區域 id 取自使用者本機 Client.txt 實測(PoE1 / PoE2)與 PoE2 GGPK `worldareas`;
// PoE1 沒有本機 GGPK 表 → 城鎮選單只顯示「第 N 章城鎮」與 id,不自行翻譯地名。
// 零依賴:main(esbuild)以相對路徑 import。

export type SpeedrunGame = 'poe1' | 'poe2'
/** area null = 只能手動分段 */
export interface SplitDef { name: string, area: string | null }
export interface Route {
  splits: SplitDef[]
  /** 自動開始的區域(新角色的第一張圖) */
  startArea: string | null
  /** 個人最佳那次每段的「累計」毫秒(長度 = splits);null = 沒有 PB */
  pb: Array<number | null> | null
  /** 每段最佳「段時間」毫秒(長度 = splits) */
  golds: Array<number | null>
  attempts: number
  autoStart: boolean
  autoSplit: boolean
}

interface PresetSplit { area: string, zh: string, en: string }

const POE1_SPLITS: PresetSplit[] = [
  { area: '1_2_town', zh: '第 1 章', en: 'Act 1' },
  { area: '1_3_town', zh: '第 2 章', en: 'Act 2' },
  { area: '1_4_town', zh: '第 3 章', en: 'Act 3' },
  { area: '1_5_town', zh: '第 4 章', en: 'Act 4' },
  { area: '2_6_town', zh: '第 5 章', en: 'Act 5' },
  { area: '2_7_town', zh: '第 6 章', en: 'Act 6' },
  { area: '2_8_town', zh: '第 7 章', en: 'Act 7' },
  { area: '2_9_town', zh: '第 8 章', en: 'Act 8' },
  { area: '2_10_town', zh: '第 9 章', en: 'Act 9' },
  // 打完基塔弗回到的終局城鎮(使用者 log 實測)
  { area: '2_11_endgame_town', zh: '第 10 章', en: 'Act 10' }
]
// PoE2:進下一個城鎮 = 這段結束;間章順序依 GGPK 名稱推定(待使用者實機確認,清單可編輯)
const POE2_SPLITS: PresetSplit[] = [
  { area: 'G2_town', zh: '第 1 章', en: 'Act 1' },
  { area: 'G3_town', zh: '第 2 章', en: 'Act 2' },
  { area: 'G4_town', zh: '第 3 章', en: 'Act 3' },
  { area: 'P1_Town', zh: '第 4 章', en: 'Act 4' },
  { area: 'P2_Town', zh: '間章 1', en: 'Interlude 1' },
  { area: 'P3_Town', zh: '間章 2', en: 'Interlude 2' },
  { area: 'G_Endgame_Town', zh: '間章 3', en: 'Interlude 3' }
]
const START_AREA: Record<SpeedrunGame, string> = { poe1: '1_1_1', poe2: 'G1_1' }

/** 分段觸發區域下拉選單(城鎮) */
export const PRESET_TOWN_AREAS: Record<SpeedrunGame, Array<{ area: string, zh: string, en: string }>> = {
  poe1: [
    ...['1_1_town', '1_2_town', '1_3_town', '1_4_town', '1_5_town'].map((area, i) => ({ area, zh: `第 ${i + 1} 章城鎮`, en: `Act ${i + 1} town` })),
    ...['2_6_town', '2_7_town', '2_8_town', '2_9_town', '2_10_town'].map((area, i) => ({ area, zh: `第 ${i + 6} 章城鎮`, en: `Act ${i + 6} town` })),
    { area: '2_11_endgame_town', zh: '終局城鎮', en: 'Endgame town' }
  ],
  // 名稱取自 PoE2 GGPK worldareas(繁中 / 英文)
  poe2: [
    { area: 'G1_town', zh: '皆伐營地', en: 'Clearfell Encampment' },
    { area: 'G2_town', zh: '阿杜拉車隊', en: 'The Ardura Caravan' },
    { area: 'G3_town', zh: '高地神塔營地', en: 'Ziggurat Encampment' },
    { area: 'G4_town', zh: '金司馬區', en: 'Kingsmarch' },
    { area: 'P1_Town', zh: '庇護所', en: 'The Refuge' },
    { area: 'P2_Town', zh: '卡里市集', en: 'The Khari Bazaar' },
    { area: 'P3_Town', zh: '林間空地', en: 'The Glade' },
    { area: 'G_Endgame_Town', zh: '高地神塔庇護所', en: 'The Ziggurat Refuge' }
  ]
}

export function presetRoute (game: SpeedrunGame, lang: 'cmn-Hant' | 'en'): Route {
  const src = game === 'poe1' ? POE1_SPLITS : POE2_SPLITS
  return {
    splits: src.map(s => ({ name: lang === 'en' ? s.en : s.zh, area: s.area })),
    startArea: START_AREA[game],
    pb: null,
    golds: src.map(() => null),
    attempts: 0,
    autoStart: true,
    autoSplit: true
  }
}

const isTime = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)

/**
 * 設定檔讀進來的路線 → 合法路線。不是物件 / splits 不是陣列或有壞列 → 內建路線;
 * pb、golds 長度不符或有壞值 → 該欄清空(PB = null、金段全 null);其餘欄位壞值回內建預設。
 */
export function normRoute (v: unknown, game: SpeedrunGame, lang: 'cmn-Hant' | 'en'): Route {
  const def = presetRoute(game, lang)
  if (!v || typeof v !== 'object') return def
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.splits) || !o.splits.length) return def
  const splits: SplitDef[] = []
  for (const s of o.splits as unknown[]) {
    const r = s as Record<string, unknown> | null
    if (!r || typeof r !== 'object' || typeof r.name !== 'string' || !(r.area === null || typeof r.area === 'string')) return def
    splits.push({ name: r.name, area: r.area === '' ? null : r.area })
  }
  const n = splits.length
  const pb = Array.isArray(o.pb) && o.pb.length === n && o.pb.every(isTime) ? [...o.pb] as Array<number | null> : null
  const golds = Array.isArray(o.golds) && o.golds.length === n && o.golds.every(isTime) ? [...o.golds] as Array<number | null> : splits.map(() => null)
  return {
    splits,
    startArea: o.startArea === null || typeof o.startArea === 'string' ? (o.startArea || null) : def.startArea,
    pb,
    golds,
    attempts: typeof o.attempts === 'number' && Number.isInteger(o.attempts) && o.attempts >= 0 ? o.attempts : 0,
    autoStart: typeof o.autoStart === 'boolean' ? o.autoStart : def.autoStart,
    autoSplit: typeof o.autoSplit === 'boolean' ? o.autoSplit : def.autoSplit
  }
}

/** 換分段清單:段數或任一段 area 改變 → PB / 金段作廢(比較會錯位);只改名保留 */
export function replaceSplits (route: Route, splits: SplitDef[]): Route {
  const same = splits.length === route.splits.length && splits.every((s, i) => s.area === route.splits[i].area)
  return {
    ...route,
    splits: splits.map(s => ({ ...s })),
    pb: same && route.pb ? [...route.pb] : null,
    golds: same ? [...route.golds] : splits.map(() => null)
  }
}
