// @ts-check

import fnv1a from '@sindresorhus/fnv1a'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 本專案的資料在 repo 根 data/<game>(上游是 renderer/public/data);只處理我們出貨的兩個語系
//   node scripts/make-index-files.mjs              → data/poe1(apt-patched 的索引演算法)
//   node scripts/make-index-files.mjs --game poe2  → data/poe2(ee2-patched 的索引演算法,見 makePoe2IndexFiles)
const LANGUAGES = ['en', 'cmn-Hant']

/** @param {'poe1' | 'poe2'} game */
export function makeIndexFiles (game = 'poe1') {
  if (game === 'poe2') return makePoe2IndexFiles(path.resolve(__dirname, '../data/poe2'))
  return makePoe1IndexFiles(path.resolve(__dirname, '../data/poe1'))
}

/** @param {string} DATA_DIR */
function makePoe1IndexFiles (DATA_DIR) {

  for (const lang of LANGUAGES) {
    const lineStarts = {
      /** @type{Array<{ hash: number, start: number }>} */
      statsByRef: [],
      /** @type{Array<{ hash: number, start: number }>} */
      matchers: []
    }

    {
      const ndjson = fs.readFileSync(path.join(DATA_DIR, `${lang}/stats.ndjson`), { encoding: 'utf-8' })
      let start = 0
      while (start !== ndjson.length) {
        const end = ndjson.indexOf('\n', start)
        /** @type {import('./data/interfaces').StatOrGroup} */
        const statOrGroup = JSON.parse(ndjson.slice(start, end))
        const stats = ('stats' in statOrGroup) ? statOrGroup.stats : [statOrGroup]
        for (const stat of stats) {
          lineStarts.statsByRef.push({ start, hash: Number(fnv1a(stat.ref, { size: 32 })) })
          for (const matcher of stat.matchers) {
            if (matcher.advanced) {
              lineStarts.matchers.push({ start, hash: Number(fnv1a(matcher.advanced, { size: 32 })) })
            } else {
              lineStarts.matchers.push({ start, hash: Number(fnv1a(matcher.string, { size: 32 })) })
            }
          }
        }
        start = (end + 1)
      }
    }

    {
      const indexData = new Uint32Array(lineStarts.statsByRef.length * 2)
      lineStarts.statsByRef.sort((a, b) => a.hash - b.hash)
      for (let i = 0; i < lineStarts.statsByRef.length; i += 1) {
        indexData[i * 2 + 0] = lineStarts.statsByRef[i].hash
        indexData[i * 2 + 1] = lineStarts.statsByRef[i].start
      }
      fs.writeFileSync(
        path.join(DATA_DIR, lang, 'stats-ref.index.bin'),
        indexData
      )
    }

    {
      const indexData = new Uint32Array(lineStarts.matchers.length * 2)
      lineStarts.matchers.sort((a, b) => a.hash - b.hash)
      for (let i = 0; i < lineStarts.matchers.length; i += 1) {
        indexData[i * 2 + 0] = lineStarts.matchers[i].hash
        indexData[i * 2 + 1] = lineStarts.matchers[i].start
      }
      fs.writeFileSync(
        path.join(DATA_DIR, lang, 'stats-matcher.index.bin'),
        indexData
      )
    }
  }

  /**
   * 兩個索引的**去重鍵不一樣**,所以不能共用同一份 lineStarts。
   *
   * refName 索引:`namespace::refName`。一個 refName 一項,維持原樣。
   *
   * 名稱索引:`namespace::refName::name`。上游用的也是 `namespace::refName`,只寫每組
   * **第一列**的 `hashName` —— 於是同一個 refName 的第二個譯名在索引裡連鍵都沒有,
   * 依名字永遠查不到。這不是假設,GGPK `baseitemtypes` 本來就有這種列:
   *
   *     Talismans/Talisman4          Greatwolf Talisman  狼王魔符    ← 舊版
   *     Talismans/TalismanGreatwolf  Greatwolf Talisman  巨狼魔符    ← 現行,遊戲現在掉的是這個
   *
   * 兩個譯名在台服交易站都是有效的 type,只是分屬現行與 (舊版)。全資料集掃描:
   * `en` / `ru` / `ko` 各 0 組,`cmn-Hant` 5 組。
   *
   * ⚠ 這**不會**動到變體:`disc` 變體(傭兵契約書、占卜寶珠…)同 refName 且同 name,
   * 新鍵一樣收斂成一項,`commonFind` 依然靠相鄰列走訪。因此 `en`/`ru`/`ko` 的
   * `items-name.index.bin` 必須逐位元組不變,四個語系的 `items-ref.index.bin` 亦然。
   */
  for (const lang of LANGUAGES) {
    /** @type{Array<{ hash: number, start: number }>} */
    let nameStarts
    /** @type{Array<{ hash: number, start: number }>} */
    let refStarts
    {
      const ndjson = fs.readFileSync(path.join(DATA_DIR, `${lang}/items.ndjson`), { encoding: 'utf-8' })
      let start = 0
      /** @type{Map<string, { hash: number, start: number }>} */
      const byName = new Map()
      /** @type{Map<string, { hash: number, start: number }>} */
      const byRef = new Map()
      while (start !== ndjson.length) {
        const end = ndjson.indexOf('\n', start)
        /** @type {import('./data/interfaces').BaseType} */
        const item = JSON.parse(ndjson.slice(start, end))

        const nameKey = `${item.namespace}::${item.refName}::${item.name}`
        if (!byName.has(nameKey)) {
          byName.set(nameKey, {
            hash: Number(fnv1a(`${item.namespace}::${item.name}`, { size: 32 })),
            start: start
          })
        }
        const refKey = `${item.namespace}::${item.refName}`
        if (!byRef.has(refKey)) {
          byRef.set(refKey, {
            hash: Number(fnv1a(`${item.namespace}::${item.refName}`, { size: 32 })),
            start: start
          })
        }
        start = (end + 1)
      }
      nameStarts = Array.from(byName.values())
      refStarts = Array.from(byRef.values())
    }

    /** @type {Array<[string, Array<{ hash: number, start: number }>]>} */
    const outputs = [
      ['items-name.index.bin', nameStarts],
      ['items-ref.index.bin', refStarts]
    ]
    for (const [file, entries] of outputs) {
      const indexData = new Uint32Array(entries.length * 2)
      entries.sort((a, b) => a.hash - b.hash)
      for (let i = 0; i < entries.length; i += 1) {
        indexData[i * 2 + 0] = entries[i].hash
        indexData[i * 2 + 1] = entries[i].start
      }
      fs.writeFileSync(path.join(DATA_DIR, lang, file), indexData)
    }
  }
}

/**
 * PoE2:**逐字照 ee2-patched `renderer/src/assets/make-index-files.mjs`**(E 的 `*.index.bin` 是 gitignore 的,
 * 解析器與它的回歸網都是對這套演算法產生的索引驗過的),與 poe1 版有兩處刻意不同:
 * - stats:每個 matcher 的 `string` 一律進索引,`advanced` 另外再進一筆(poe1 版是二擇一;PoE2 stats 無群組列)。
 * - items:名稱索引與 refName 索引共用 `namespace::refName` 去重(上游原樣;poe1 版的同 refName 多譯名修正沒有搬過來,
 *   E 端也沒有這個修正,搬了會讓本 repo 的解析結果與 E 的回歸網分岔)。
 * 驗證方式:對 E 跑過 `npm run make-index-files` 的索引做 byte 比對(同一份 ndjson → 同一份 bin)。
 * @param {string} DATA_DIR
 */
function makePoe2IndexFiles (DATA_DIR) {
  /** @param {Array<{ hash: number, start: number }>} entries */
  const toIndex = (entries) => {
    const indexData = new Uint32Array(entries.length * 2)
    for (let i = 0; i < entries.length; i += 1) {
      indexData[i * 2 + 0] = entries[i].hash
      indexData[i * 2 + 1] = entries[i].start
    }
    return indexData
  }

  for (const lang of LANGUAGES) {
    /** @type{Array<{ hash: number, start: number }>} */
    const statsByRef = []
    /** @type{Array<{ hash: number, start: number }>} */
    const matchers = []
    const ndjson = fs.readFileSync(path.join(DATA_DIR, `${lang}/stats.ndjson`), { encoding: 'utf-8' })
    let start = 0
    while (start !== ndjson.length) {
      const end = ndjson.indexOf('\n', start)
      const stat = JSON.parse(ndjson.slice(start, end))
      statsByRef.push({ start, hash: Number(fnv1a(stat.ref, { size: 32 })) })
      for (const matcher of stat.matchers) {
        matchers.push({ start, hash: Number(fnv1a(matcher.string, { size: 32 })) })
        if (matcher.advanced) {
          matchers.push({ start, hash: Number(fnv1a(matcher.advanced, { size: 32 })) })
        }
      }
      start = end + 1
    }
    statsByRef.sort((a, b) => a.hash - b.hash)
    fs.writeFileSync(path.join(DATA_DIR, lang, 'stats-ref.index.bin'), toIndex(statsByRef))
    matchers.sort((a, b) => a.hash - b.hash)
    fs.writeFileSync(path.join(DATA_DIR, lang, 'stats-matcher.index.bin'), toIndex(matchers))
  }

  for (const lang of LANGUAGES) {
    const ndjson = fs.readFileSync(path.join(DATA_DIR, `${lang}/items.ndjson`), { encoding: 'utf-8' })
    /** @type{Map<string, { hashName: number, hashRefName: number, start: number }>} */
    const startsByName = new Map()
    let start = 0
    while (start !== ndjson.length) {
      const end = ndjson.indexOf('\n', start)
      const item = JSON.parse(ndjson.slice(start, end))
      const key = `${item.namespace}::${item.refName}`
      if (!startsByName.has(key)) {
        startsByName.set(key, {
          hashName: Number(fnv1a(`${item.namespace}::${item.name}`, { size: 32 })),
          hashRefName: Number(fnv1a(`${item.namespace}::${item.refName}`, { size: 32 })),
          start
        })
      }
      start = end + 1
    }
    const lineStarts = Array.from(startsByName.values())
    lineStarts.sort((a, b) => a.hashName - b.hashName)
    fs.writeFileSync(path.join(DATA_DIR, lang, 'items-name.index.bin'),
      toIndex(lineStarts.map(e => ({ hash: e.hashName, start: e.start }))))
    lineStarts.sort((a, b) => a.hashRefName - b.hashRefName)
    fs.writeFileSync(path.join(DATA_DIR, lang, 'items-ref.index.bin'),
      toIndex(lineStarts.map(e => ({ hash: e.hashRefName, start: e.start }))))
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf('--game')
  const game = i === -1 ? 'poe1' : process.argv[i + 1]
  if (game !== 'poe1' && game !== 'poe2') {
    console.error(`--game 只接受 poe1 / poe2(收到 ${game})`)
    process.exit(2)
  }
  makeIndexFiles(game)
  console.log(`索引已產生:data/${game}/{en,cmn-Hant}/*.index.bin`)
}
