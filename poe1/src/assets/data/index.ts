import fnv1a from '@sindresorhus/fnv1a'
import type { BaseType, DropEntry, Stat, StatOrGroup, StatMatcher, TranslationDict } from './interfaces'
import type { DataSource } from '@exile-appraiser/core/games/adapter'

export * from './interfaces'

// 相對上游的唯一結構改動:資料不再靠 `fetch(import.meta.env.BASE_URL + 'data/…')` 與動態 import,
// 而是由呼叫端注入 DataSource(瀏覽器版 browser-source.ts、Node 版 node-source.ts)。
// 其他函式(查表、索引、驗證)逐字保留。
let dataSource: DataSource | undefined

export function configureDataSource (source: DataSource): void {
  dataSource = source
}

function source (): DataSource {
  if (!dataSource) throw new Error('資料來源未設定:先呼叫 configureDataSource()')
  return dataSource
}

export let ITEM_DROP: DropEntry[]
export let CLIENT_STRINGS: TranslationDict
export let CLIENT_STRINGS_REF: TranslationDict

export let ITEM_BY_TRANSLATED: (ns: BaseType['namespace'], name: string) => BaseType[] | undefined = () => undefined
export let ITEM_BY_REF: (ns: BaseType['namespace'], name: string) => BaseType[] | undefined = () => undefined
export let ITEMS_ITERATOR: (includes: string, andIncludes?: string[]) => Generator<BaseType> = function * () {}

export let ALTQ_GEM_NAMES: () => Generator<string> = function * () {}
export let REPLICA_UNIQUE_NAMES: () => Generator<string> = function * () {}

export let STAT_BY_MATCH_STR: (name: string) => { matcher: StatMatcher, stat: Stat } | undefined = () => undefined
export let STAT_BY_MATCH_STR_V2: (name: string) => StatOrGroup | undefined = () => undefined
export let STAT_BY_REF_V2: (name: string) => StatOrGroup | undefined = () => undefined
export let STATS_ITERATOR: (includes: string, andIncludes?: string[]) => Generator<Stat> = function * () {}

function dataBinarySearch (data: Uint32Array, value: number, rowOffset: number, rowSize: number) {
  let left = 0
  let right = (data.length / rowSize) - 1
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const midValue = data[(mid * rowSize) + rowOffset]
    if (midValue < value) {
      left = mid + 1
    } else if (midValue > value) {
      right = mid - 1
    } else {
      return mid
    }
  }
  return -1
}

function ndjsonFindLines<T> (ndjson: string) {
  // it's preferable that passed `searchString` has good entropy
  return function * (searchString: string, andIncludes: string[] = []): Generator<T> {
    let start = 0
    while (start !== ndjson.length) {
      const matchPos = ndjson.indexOf(searchString, start)
      if (matchPos === -1) break
      // works for first line too (-1 + 1 = 0)
      start = ndjson.lastIndexOf('\n', matchPos) + 1
      const end = ndjson.indexOf('\n', matchPos)
      const jsonLine = ndjson.slice(start, end)
      if (andIncludes.every(str => jsonLine.includes(str))) {
        yield JSON.parse(jsonLine) as T
      }
      start = end + 1
    }
  }
}

function itemNamesFromLines (items: Generator<BaseType>) {
  let cached = ''
  return function * (): Generator<string> {
    if (!cached.length) {
      for (const item of items) {
        cached += (item.name + '\n')
      }
    }

    let start = 0
    while (start !== cached.length) {
      const end = cached.indexOf('\n', start)
      yield cached.slice(start, end)
      start = end + 1
    }
  }
}

async function loadItems (language: string) {
  const ndjson = await source().text(`${language}/items.ndjson`)
  const INDEX_WIDTH = 2
  const indexNames = new Uint32Array(await source().binary(`${language}/items-name.index.bin`))
  const indexRefNames = new Uint32Array(await source().binary(`${language}/items-ref.index.bin`))

  /**
   * 索引的去重鍵是 `namespace::refName`(見 make-index-files.mjs),但名稱索引存的是
   * `namespace::name` 的雜湊。當兩個不同的 refName 共用同一個顯示名時,索引裡就會有
   * **兩個雜湊相同、偏移不同**的項,而 `dataBinarySearch` 只會回其中任意一個。
   *
   * 上游只從那一個偏移往後走,收集**相鄰**的同名列。這對英文資料剛好成立
   * (12 組同名全部相鄰),但繁中有 4 組同名列相隔上百行:
   *
   *     UNIQUE::永恆鬥爭 → The Eternal Struggle(行 4569)/ Timeless Conflict(行 4694)
   *
   * 結果是其中一個永遠查不到。以 `永恆鬥爭` 為例,查到的是聖物版(base `Minor Idol`),
   * 護身符版拿不到,接著在 findInDatabase 被基底類型過濾成空陣列而崩潰。
   *
   * 改成:倒回第一個同雜湊的索引項,把**每一個**都走過。相鄰列仍由內層迴圈收集
   * (變體/傳奇的既有行為不變),`seen` 則避免同一列被兩個索引項重複收錄。
   */
  function commonFind (index: Uint32Array, prop: 'name' | 'refName') {
    const rowCount = index.length / INDEX_WIDTH
    return function (ns: BaseType['namespace'], name: string): BaseType[] | undefined {
      const hash = Number(fnv1a(`${ns}::${name}`, { size: 32 }))
      let row = dataBinarySearch(index, hash, 0, INDEX_WIDTH)
      if (row === -1) return undefined
      while (row > 0 && index[(row - 1) * INDEX_WIDTH] === hash) row -= 1

      // 由小到大走,輸出順序才與 ndjson 的順序一致,不依賴 sort 的穩定性。
      const offsets: number[] = []
      for (let r = row; r < rowCount && index[r * INDEX_WIDTH] === hash; r += 1) {
        offsets.push(index[r * INDEX_WIDTH + 1])
      }
      offsets.sort((a, b) => a - b)

      const out: BaseType[] = []
      const seen = new Set<number>()
      for (const offset of offsets) {
        let start = offset
        while (start !== ndjson.length) {
          if (seen.has(start)) break // 這一列已被前一個索引項走過
          seen.add(start)
          const end = ndjson.indexOf('\n', start)
          const record = JSON.parse(ndjson.slice(start, end)) as BaseType
          if (record.namespace === ns && record[prop] === name) {
            out.push(record)
            if (!record.disc && !record.unique) break
          } else { break }
          start = end + 1
        }
      }
      return out
    }
  }

  ITEM_BY_TRANSLATED = commonFind(indexNames, 'name')
  ITEM_BY_REF = commonFind(indexRefNames, 'refName')
  ITEMS_ITERATOR = ndjsonFindLines<BaseType>(ndjson)
  ALTQ_GEM_NAMES = itemNamesFromLines(ITEMS_ITERATOR('altQuality":["Anomalous'))
  REPLICA_UNIQUE_NAMES = itemNamesFromLines(ITEMS_ITERATOR('refName":"Replica'))
}

async function loadStats (language: string) {
  const ndjson = await source().text(`${language}/stats.ndjson`)
  const INDEX_WIDTH = 2
  const indexRef = new Uint32Array(await source().binary(`${language}/stats-ref.index.bin`))
  const indexMatcher = new Uint32Array(await source().binary(`${language}/stats-matcher.index.bin`))

  STAT_BY_REF_V2 = function (ref: string) {
    let start = dataBinarySearch(indexRef, Number(fnv1a(ref, { size: 32 })), 0, INDEX_WIDTH)
    if (start === -1) return undefined
    start = indexRef[start * INDEX_WIDTH + 1]
    const end = ndjson.indexOf('\n', start)
    return JSON.parse(ndjson.slice(start, end))
  }

  STAT_BY_MATCH_STR_V2 = function (matchStr: string) {
    let start = dataBinarySearch(indexMatcher, Number(fnv1a(matchStr, { size: 32 })), 0, INDEX_WIDTH)
    if (start === -1) return undefined
    start = indexMatcher[start * INDEX_WIDTH + 1]
    const end = ndjson.indexOf('\n', start)
    const statOrGroup = JSON.parse(ndjson.slice(start, end)) as StatOrGroup
    const stats = ('stats' in statOrGroup) ? statOrGroup.stats : [statOrGroup]
    if (!stats.some(stat =>
      stat.matchers.some(m => m.string === matchStr || m.advanced === matchStr))
    ) {
      // console.log('fnv1a32 collision')
      return undefined
    }
    return statOrGroup
  }

  STAT_BY_MATCH_STR = function (matchStr: string) {
    const statOrGroup = STAT_BY_MATCH_STR_V2(matchStr)
    if (!statOrGroup) return undefined

    let stat: Stat
    if ('stats' in statOrGroup) {
      const stats = statOrGroup.stats.filter(stat =>
        stat.matchers.some(m => m.string === matchStr || m.advanced === matchStr))
      if (stats.length !== 1) return undefined
      stat = stats[0]
    } else {
      stat = statOrGroup
    }
    const matcher = stat.matchers.find(m =>
      m.string === matchStr || m.advanced === matchStr)!
    return { stat, matcher }
  }

  const _STATS_ITERATOR = ndjsonFindLines<StatOrGroup>(ndjson)

  STATS_ITERATOR = function * (includes, andIncludes) {
    for (const statOrGroup of _STATS_ITERATOR(includes, andIncludes)) {
      if ('stats' in statOrGroup) {
        for (const stat of statOrGroup.stats) {
          yield stat
        }
      } else {
        yield statOrGroup
      }
    }
  }
}

export function pseudoStatByRef (ref: string): Stat | undefined {
  const statOrGroup = STAT_BY_REF_V2(ref)
  if (statOrGroup != null && 'stats' in statOrGroup) {
    return statOrGroup.stats.find(stat =>
      stat.ref === ref &&
      'pseudo' in stat.trade.ids)
  }
  return statOrGroup
}

// assertion, to avoid regressions in stats.ndjson
const DELAYED_STAT_VALIDATION = new Set<string>()
// type StatCheck =
//   | 'ref-match' // text will be used for comparison with other stat refs
//   | 'pseudo-find' // text will only be used in `pseudoStatByRef`
export function stat (text: string) {
  DELAYED_STAT_VALIDATION.add(text)
  return text
}

export async function init (lang: string) {
  CLIENT_STRINGS_REF = await source().module('en/client_strings.js') as TranslationDict
  // 上游在這裡載入 data/patrons.json(原作者的贊助者名單)。名單與顯示它的
  // 獎台/跑馬燈已一併移除,理由見 web/settings/SettingsWindow.vue 頂端。
  ITEM_DROP = JSON.parse(await source().text('item-drop.json'))

  await loadForLang(lang)

  for (const text of DELAYED_STAT_VALIDATION) {
    const statOrGroup = STAT_BY_REF_V2(text)
    if (!statOrGroup) {
      throw new Error(`Cannot find stat: ${text}`)
    }
    if (
      'stats' in statOrGroup &&
      // other languages are allowed to have unrelated stats grouped with our `ref`
      lang === 'en' &&
      statOrGroup.stats.some(stat => stat.ref !== text)
    ) {
      // TODO implement `StatCheck` if this causes error later.
      // This check cannot be delegated to ndjson creation time because only
      // a subset of groups need to adhere to it (that are seen in `stat()`).
      throw new Error(`Some stats have different ref text: ${text}`)
    }
  }
  DELAYED_STAT_VALIDATION.clear()
}

export async function loadForLang (lang: string) {
  CLIENT_STRINGS = await source().module(`${lang}/client_strings.js`) as TranslationDict
  await loadItems(lang)
  await loadStats(lang)
}
