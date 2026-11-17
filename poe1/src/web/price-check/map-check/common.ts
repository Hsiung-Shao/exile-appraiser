// exile-appraiser:移植自 Awakened PoE Trade `renderer/src/web/map-check/common.ts`(MIT,© Alexander Drozdov)。
// 耦合點:
// - 標記的鍵由比對字串(`matcher`)改成語言無關的 stat `ref`(3.30 起同一條詞綴有多種寫法、舊的標 superseded,用字串會對不到)。
// - `isOutdated` 改用 `STAT_BY_REF_V2`。
// - 上游 `WidgetItemCheck.vue` 的 `isMapLike` 與 `settings-maps.vue` 的 `findAllAreaMods`(改成一個 ref 一列)、搜尋篩選搬到這裡(純函式,可測)。
import { STAT_BY_REF_V2, STATS_ITERATOR } from '@/assets/data'
import { ItemCategory, ItemRarity, type ParsedItem } from '@/parser'

export interface MapCheckConfig {
  profile: number
  showNewStats: boolean
  selectedStats: MapCheckStat[]
}

export interface MapCheckStat {
  ref: string // exile-appraiser: 上游 matcher
  decision: string
}

export enum StatTag {
  Outdated = 1,
  HeistExclusive,
  UberMapExclusive
}

export interface StatMatcher {
  ref: string // exile-appraiser: 標記鍵
  matchStr: string // 顯示文字(目前客戶端語言)
  tag?: StatTag
}

export function decisionHasColor (decisionSet: string, profileName: number) {
  // Three profiles stored as "---"
  // -: undefined
  // d: deadly mod
  // w: warning
  // g: good mod
  // s: marked as seen
  const idx = profileName - 1
  return decisionSet[idx] !== '-' && decisionSet[idx] !== 's'
}

export function nextDecision (current: string): string {
  switch (current) {
    case 'd': return 'w'
    case 'w': return 'g'
    case 'g': return 's'
  }
  return 'd'
}

export function decisionCreate (value: string, profileName: number, updateSet = '---') {
  const idx = profileName - 1
  const split = updateSet.split('')
  split[idx] = value
  return split.join('')
}

export function isOutdated (profileName: number, stat: MapCheckStat): boolean {
  return decisionHasColor(stat.decision, profileName) &&
    STAT_BY_REF_V2(stat.ref) == null
}

// exile-appraiser: 上游 WidgetItemCheck.vue
export function isMapLike (item: ParsedItem): boolean {
  const { category, rarity, info: { refName } } = item
  return (
    (category === ItemCategory.Map && rarity !== ItemRarity.Unique) ||
    category === ItemCategory.HeistContract ||
    category === ItemCategory.HeistBlueprint ||
    category === ItemCategory.Invitation ||
    category === ItemCategory.Chart ||
    refName === 'Expedition Logbook')
}

function tagToShowOrder (tag?: StatTag): number {
  switch (tag) {
    case StatTag.UberMapExclusive: return 1
    case StatTag.HeistExclusive: return 2
  }
  return 0
}

// exile-appraiser: 上游 settings-maps.vue `findAllAreaMods`;一個 ref 一列,文字取第一個沒被取代的寫法
export function areaModRows (): StatMatcher[] {
  const out: StatMatcher[] = []
  const seen = new Set<string>()
  for (const stat of STATS_ITERATOR('AreaMods')) {
    if (!stat.fromAreaMods || seen.has(stat.ref)) continue
    seen.add(stat.ref)

    const tag = (stat.fromAreaMods === 'heist_exclusive') ? StatTag.HeistExclusive
      : (stat.fromAreaMods === 'ubermap_exclusive') ? StatTag.UberMapExclusive : undefined

    const matcher = stat.matchers.find(m => !m.superseded) ?? stat.matchers[0]
    out.push({ ref: stat.ref, matchStr: matcher.string, tag })
  }
  out.sort((a, b) =>
    (tagToShowOrder(a.tag) - tagToShowOrder(b.tag)) ||
    a.matchStr.localeCompare(b.matchStr))
  return out
}

// exile-appraiser: 上游 settings-maps.vue `filteredStats` 的篩選部分
export function filterAreaMods (rows: StatMatcher[], search: string, onlySelected: boolean, selected: ReadonlySet<string>): StatMatcher[] {
  const q = search.toLowerCase().split(' ')
  return rows.filter(stat => {
    const searchStr = stat.matchStr.toLowerCase()
    if (!q.every(part => searchStr.includes(part))) return false
    if (onlySelected) return selected.has(stat.ref)
    return true
  })
}
