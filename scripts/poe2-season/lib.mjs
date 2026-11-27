// PoE2 賽季資料更新的純函式(update.mjs 用;測試 poe2/test/season-update.test.ts)。
// 2026-11-18 起 data/poe2 由本專案維護(底 = ee2-patched fc7de73);PoE1 的對應腳本在 scripts/poe1-season。
// 這一版沒有新的 PoE2 GGPK 快照可比(使用者 2026-11-18:PoE2 目前沒有更新,以現有資料調整),
// 規則只依實機樣本(GitHub issue 的剪貼簿)與資料本身的佐證;matcher 只加不刪,判不準的不改。
// 另有與 PoE1 共用的 planGeneric(2026-11-25),本機有兩個 PoE2 GGPK 版本時才生效。

import { planDeadIds, planFillIds, planStatText } from '../poe1-season/lib.mjs'

/**
 * PoE2 資料檔的序列化格式 = Python `json.dumps(obj, ensure_ascii=False)`(ee2-patched 的產生器):
 * 分隔是「, 」與「: 」、中文不跳脫。只重寫有變動的列,其餘逐字保留。
 * shortcut: Python 的整數值浮點(items 的 `"values": [4.0]`)JSON.parse 後分不出來,會寫成 4;
 * stats 沒有這種值(測試逐列驗過),所以只拿來重寫 stats。要改 items 時先處理這點。
 */
export function pyDumps (v) {
  if (Array.isArray(v)) return `[${v.map(pyDumps).join(', ')}]`
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${pyDumps(x)}`).join(', ')}}`
  return JSON.stringify(v)
}

/**
 * 規則 P1:數字移到前面。PoE2 的「全部X技能等級」實機已是「+3全部法術技能等級」(GitHub issue #24 #25:法術、冰冷法術),
 * 資料是「全部法術技能等級#」→ 同一族(句型「全部…技能等級#」)補「#全部…技能等級」。
 * 本機 PoE2 GGPK 只有 0.5.5e(還是舊寫法),其餘同族是推論同樣改了;新句標 superseded(篩選列與正則頁不變,舊寫法照常解析)。
 * 「命定: 全部…技能等級#」沒有樣本、前綴放哪看不出來,不動。
 * @returns {{ adds: any[] }}
 */
export function planLeadingNumber ({ zhStats }) {
  const adds = []
  for (const stat of zhStats) {
    for (const m of stat.matchers ?? []) {
      const hit = /^全部(.+)技能等級#$/.exec(m.string)
      if (!hit || m.negate || m.value !== undefined) continue
      const string = `#全部${hit[1]}技能等級`
      if (stat.matchers.some(x => x.string === string)) continue
      adds.push({ lang: 'cmn-Hant', ref: stat.ref, matcher: { string, superseded: true } })
    }
  }
  return { adds }
}

/**
 * 同一條詞綴的另一種繁中寫法,逐條列出依據。`current: true` = 新句是現行寫法、`old` 那句標 superseded。
 * - 賦予技能: 舉盾(GitHub issue #3 史瓦林):同一技能帶等級的寫法資料裡已是「賦予技能: 等級 # 舉盾」,不帶等級的還是舊譯名「展開護盾」
 */
export const EXTRA_ZH_MATCHERS = [
  { ref: 'Grants Skill: Raise Shield', zh: '賦予技能: 舉盾', current: true, old: '賦予技能: 展開護盾', evidence: 'GitHub issue #3 + 資料「賦予技能: 等級 # 舉盾」' }
]

/** 規則 P2:`EXTRA_ZH_MATCHERS` → 繁中多一個 matcher @returns {{ adds: any[] }} */
export function planExtraZh ({ zhStats }) {
  const adds = []
  for (const x of EXTRA_ZH_MATCHERS) {
    const have = zhStats.filter(s => s.ref === x.ref)
    if (!have.length || have.every(s => s.matchers.some(m => m.string === x.zh))) continue
    adds.push(x.current
      ? { lang: 'cmn-Hant', ref: x.ref, matcher: { string: x.zh }, supersedes: x.old }
      : { lang: 'cmn-Hant', ref: x.ref, matcher: { string: x.zh, superseded: true } })
  }
  return { adds }
}

/**
 * 套用詞綴計畫到一份 stats.ndjson 文字:只改有變動的列(PoE2 格式重新序列化),保留行尾。
 * @param {string} fileText
 * @param {'en' | 'cmn-Hant'} lang
 * @param {{ adds?: any[] }} [plan]
 */
export function applyStatPlan (fileText, lang, { adds = [] } = {}) {
  const mine = adds.filter(a => a.lang === lang)
  const eol = fileText.includes('\r\n') ? '\r\n' : '\n'
  return fileText.split(eol).map(line => {
    if (!line.trim()) return line
    const stat = JSON.parse(line)
    let changed = false
    for (const a of mine.filter(a => a.ref === stat.ref)) {
      if (stat.matchers.some(m => m.string === a.matcher.string)) continue
      if (a.supersedes) for (const m of stat.matchers) if (m.string === a.supersedes) m.superseded = true
      stat.matchers.push(a.matcher)
      changed = true
    }
    return changed ? pyDumps(stat) : line
  }).join(eol)
}

/**
 * 規則 P3:同名同底材的傳奇有兩種英文拼法(Brynabas / Byrnabas、Splinter of Loratta / Lorrata,上游留下的舊拼法列),
 * 一列在國際服交易站 items、另一列不在 → 刪掉不在的那列(名稱查詢收齊同名後會取到它,查不到掛單;2026-11-27 code review)。
 * 交易站沒有同名同底材的拼法時不刪(那是交易站缺的傳奇,不是舊拼法)。只刪整行,其他行逐字不變。
 * 要刪哪幾列以繁中檔算(英文檔兩種拼法的 name 不同),兩語刪同一批 `refName|底材`。
 * @param {string} fileText items.ndjson
 * @param {Set<string>} trade 交易站傳奇 `名稱|底材`
 * @param {Set<string>} [stale] 要刪的 `refName|底材`;省略 = 用這份檔自己的名稱算
 */
export function dropStaleUniqueSpellings (fileText, trade, stale = staleUniqueKeys(fileText, trade)) {
  const eol = fileText.includes('\r\n') ? '\r\n' : '\n'
  return fileText.split(eol).filter(l => {
    const r = l.trim() ? JSON.parse(l) : null
    return !(r?.unique && stale.has(`${r.refName}|${r.unique.base}`))
  }).join(eol)
}

/** @param {string} fileText @param {Set<string>} trade @returns {Set<string>} */
export function staleUniqueKeys (fileText, trade) {
  const rows = fileText.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l)).filter(r => r.unique)
  const key = (/** @type {any} */ r) => `${r.refName}|${r.unique.base}`
  const live = new Set(rows.filter(r => trade.has(key(r))).map(r => `${r.name}|${r.unique.base}`))
  return new Set(rows.filter(r => !trade.has(key(r)) && live.has(`${r.name}|${r.unique.base}`)).map(key))
}
