// PoE1 賽季資料更新的純函式(update.mjs 用;測試 poe1/test/season-update.test.ts)。
// 對接一律用語言無關鍵:GGPK stat 鍵、交易站 stat id、Metadata 路徑、stats 的 ref。
// matcher 只加不刪、不換順序;判不準的一律不改資料、放進 rejects 給報告。

/** GGPK / 交易站文字 → matcher 文字(數值寫 #,# 前的正負號去掉) */
export function toMatcherText (text) {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1')
    .replace(/\[([^\]]*)\]/g, '$1')
    .replace(/\{\d*(?::[^}]*)?\}/g, '#')
    .replace(/[+\-−]#/g, '#')
}

/** 寬鬆鍵(找對應、查碰撞用):不分大小寫、空白收斂 */
export function cmpKey (text) {
  return toMatcherText(text ?? '').replace(/[ \t]+/g, ' ').trim().toLowerCase()
}

/** 逐字鍵(判斷「有沒有改字 / 已經有了沒」用):解析器逐字比對 matcher,只差大小寫也算不同 */
const exactKey = (text) => toMatcherText(text ?? '').trim()
/** 交易站文字去掉 (Local) 尾綴(遊戲內文字沒有它) */
const noLocal = (text) => (text ?? '').replace(/\s+\(Local\)$/i, '')
const matcherExact = (stat) => new Set(stat.matchers.map(m => m.string.trim()))

/** 文字的方向:+1 增加 / 更多,-1 減少 / 更少,0 看不出來 */
function direction (text) {
  const up = /\b(increased|more)\b|增加|更多/i.test(text)
  const down = /\b(reduced|less)\b|減少|更少/i.test(text)
  return up === down ? 0 : (up ? 1 : -1)
}

/** 展開群組列,回傳每個一般 stat 物件 */
export function * eachStat (rows) {
  for (const row of rows) {
    if (row.stats) yield * row.stats
    else if (row.matchers) yield row
  }
}

const matcherKeys = (stat) => new Set(stat.matchers.map(m => cmpKey(m.string)))
const allIds = (stat) => Object.values(stat.trade?.ids ?? {}).flat()

/** cmpKey → 擁有這個 matcher 的 ref 集合 */
function refsByMatcher (rows) {
  /** @type {Map<string, Set<string>>} */
  const map = new Map()
  for (const stat of eachStat(rows)) {
    for (const k of matcherKeys(stat)) {
      if (!map.has(k)) map.set(k, new Set())
      map.get(k).add(stat.ref)
    }
  }
  return map
}

function groupBy (list, keyOf) {
  const map = new Map()
  for (const x of list) {
    const k = keyOf(x)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(x)
  }
  return map
}

/**
 * 規則 A:改字。en matcher 命中 GGPK 舊版某鍵的文字、同鍵新版文字不同 → 加上新版文字。
 * @returns {{ adds: any[], rejects: any[] }}
 */
export function planStatText ({ enStats, zhStats, ggpkOld, ggpkNew }) {
  const newByKey = new Map(ggpkNew.map(r => [r.key, r]))
  const newEn = new Set(ggpkNew.map(r => exactKey(r.en)))
  const newZh = new Set(ggpkNew.map(r => exactKey(r.zh)))
  const oldByEn = groupBy(ggpkOld.filter(r => newByKey.has(r.key)), r => cmpKey(r.en))
  const enRefs = refsByMatcher(enStats)
  const zhRefs = refsByMatcher(zhStats)
  const zhByRef = groupBy([...eachStat(zhStats)], s => s.ref)
  const adds = []
  const rejects = []
  const seen = new Set()

  for (const stat of eachStat(enStats)) {
    const have = { en: matcherExact(stat), 'cmn-Hant': new Set((zhByRef.get(stat.ref) ?? []).flatMap(s => [...matcherExact(s)])) }
    for (const m of [...stat.matchers]) {
      const k = cmpKey(m.string)
      const olds = oldByEn.get(k)
      if (!olds) continue
      const allowed = enRefs.get(k) // 原本就共用這句舊文字的 ref,新文字可以繼續共用
      const flags = { ...(m.negate ? { negate: true } : {}), ...(m.value !== undefined ? { value: m.value } : {}) }
      /** @type {{ lang: 'en' | 'cmn-Hant', text: string, was: string | null }[]} */
      const cands = []
      for (const o of olds) {
        const n = newByKey.get(o.key)
        if (direction(o.en) * direction(n.en) === -1) { // 增加 ↔ 減少對調:整個鍵(兩語系)都不收
          rejects.push({ ref: stat.ref, lang: 'en', reason: 'direction', from: m.string, to: toMatcherText(n.en) })
          continue
        }
        if (exactKey(n.en) !== exactKey(o.en)) cands.push({ lang: 'en', text: n.en, was: o.en })
        if (n.zh && exactKey(n.zh) !== exactKey(o.zh) && cmpKey(n.zh) !== cmpKey(n.en)) cands.push({ lang: 'cmn-Hant', text: n.zh, was: o.zh })
      }
      // 同一句舊文字在新版分成多句(例:「附近」→ 3 公尺 / 6 公尺,原本就共用這個 stat)→ 全部加上
      for (const c of cands) {
        const nk = cmpKey(c.text)
        const id = `${c.lang}\n${stat.ref}\n${exactKey(c.text)}\n${JSON.stringify(flags)}`
        if (have[c.lang].has(exactKey(c.text)) || seen.has(id)) continue
        seen.add(id)
        const reject = (reason) => rejects.push({ ref: stat.ref, lang: c.lang, reason, from: m.string, to: toMatcherText(c.text) })
        if (c.was && direction(c.was) * direction(c.text) === -1) { reject('direction'); continue }
        const others = [...((c.lang === 'en' ? enRefs : zhRefs).get(nk) ?? [])].filter(r => !allowed.has(r))
        if (others.length) { reject('collision'); continue }
        // 舊句在新版每個鍵都改掉了、而且新版沒有任何一列(含搬到新鍵的)還是這句,才算被取代;套用時標 superseded
        const dead = olds.every(o => {
          const n = newByKey.get(o.key)
          return c.lang === 'en'
            ? exactKey(n.en) !== exactKey(o.en) && !newEn.has(exactKey(o.en))
            : Boolean(n.zh) && exactKey(n.zh) !== exactKey(o.zh) && !newZh.has(exactKey(o.zh))
        })
        adds.push({
          lang: c.lang,
          ref: stat.ref,
          matcher: { string: toMatcherText(c.text), ...flags },
          after: c.lang === 'en' ? m.string : undefined,
          ...(dead ? { supersedes: c.lang === 'en' ? m.string : toMatcherText(c.was ?? '') } : {})
        })
      }
    }
  }
  return { adds, rejects }
}

/**
 * 規則 B:專案引用的 id 在交易站的現行文字(同一個 id 可能有好幾句,例:地圖上的「Area contains …」與天賦樹的
 * 「Your Maps contain …」)**沒有任何一句**是它的 en matcher,而且 GGPK 新版確實有那句(= 遊戲內文字)→ 加上。
 * 已經對得上其中一句的 id 不動(另一句是別的情境的寫法)。減少型(需要 negate)的不猜,放進 rejects。
 * @param {{ enStats: any[], zhStats: any[], tradeStats: any[], ggpkNew: any[], ggpkOld?: any[] }} input
 */
export function planTradeText ({ enStats, zhStats, tradeStats, ggpkNew, ggpkOld = [] }) {
  // GGPK 裡只改大小寫的句子(舊, 新):給「前綴 + 子句」的組合句用 —— 整句不在 GGPK(例:頭目在場時 … #% faster),
  // 但子句在新版改了大小寫、交易站整句也跟著改,就補上交易站那句。
  // 不看鍵(子句可能換了鍵):舊版有、新版已沒有的句子,新版有一句只差大小寫的
  const newTexts = new Set(ggpkNew.map(r => exactKey(r.en)))
  const newByLower = groupBy([...newTexts], t => t.toLowerCase())
  const casePairs = [...new Set(ggpkOld.map(r => exactKey(r.en)))].filter(o => !newTexts.has(o))
    .flatMap(o => (newByLower.get(o.toLowerCase()) ?? []).map(n => [o, n]))
  /** @type {Map<string, Set<string>>} id → 逐字的現行文字 */
  const textsById = new Map()
  for (const e of tradeStats) {
    if (!textsById.has(e.id)) textsById.set(e.id, new Set())
    textsById.get(e.id).add(exactKey(noLocal(e.text)))
  }
  const ggpkByEn = groupBy(ggpkNew, r => exactKey(r.en))
  // 這條 stat 補上現行寫法時,其他「可當模板(非 negate、非固定值)且不是任何一個 id 現行文字」的舊寫法標成被取代
  const gone = (matchers, current) => [...new Set(matchers.filter(m => !m.negate && m.value === undefined && !current.has(m.string.trim())).map(m => m.string))]
  const enRefs = refsByMatcher(enStats)
  const zhRefs = refsByMatcher(zhStats)
  const zhByRef = groupBy([...eachStat(zhStats)], s => s.ref)
  const adds = []
  const rejects = []
  const seen = new Set()
  for (const stat of eachStat(enStats)) {
    const have = matcherExact(stat)
    const haveZh = new Set((zhByRef.get(stat.ref) ?? []).flatMap(s => [...matcherExact(s)]))
    const ids = allIds(stat).filter(id => !id.startsWith('pseudo.') && textsById.has(id))
    const current = new Set(ids.flatMap(id => [...textsById.get(id)]))
    const currentZh = new Set([...current].flatMap(t => (ggpkByEn.get(t) ?? []).map(r => exactKey(r.zh))))
    for (const id of ids) {
      const texts = [...textsById.get(id)]
      if (texts.some(t => have.has(t))) continue // 這個 id 已經有一句對得上
      for (const text of texts) {
        const rows = ggpkByEn.get(text)
        if (seen.has(stat.ref + '\n' + text)) continue
        seen.add(stat.ref + '\n' + text)
        if (!rows) {
          const m = stat.matchers.find(m => m.string.trim().toLowerCase() === text.toLowerCase())
          if (m && casePairs.some(([o, n]) => m.string.includes(o) && text.includes(n))) {
            const flags = { ...(m.negate ? { negate: true } : {}), ...(m.value !== undefined ? { value: m.value } : {}) }
            adds.push({ lang: 'en', ref: stat.ref, matcher: { string: text, ...flags }, after: m.string, supersedes: m.string })
          }
          continue
        }
        const reject = (reason, lang = 'en', to = text) => rejects.push({ ref: stat.ref, lang, reason, id, to })
        if (direction(text) === -1 && stat.matchers.some(m => !m.negate && direction(m.string) === 1)) { reject('direction'); continue }
        if ([...(enRefs.get(cmpKey(text)) ?? [])].some(r => r !== stat.ref)) { reject('collision'); continue }
        adds.push({ lang: 'en', ref: stat.ref, matcher: { string: text }, supersedes: gone(stat.matchers, current) })
        const zhs = [...new Set(rows.filter(r => r.zh && cmpKey(r.zh) !== cmpKey(text)).map(r => exactKey(r.zh)))]
        if (zhs.length !== 1) { if (zhs.length) reject('ambiguous', 'cmn-Hant', zhs.join(' / ')); continue }
        if (haveZh.has(zhs[0])) continue
        if ([...(zhRefs.get(cmpKey(zhs[0])) ?? [])].some(r => r !== stat.ref)) { reject('collision', 'cmn-Hant', zhs[0]); continue }
        adds.push({ lang: 'cmn-Hant', ref: stat.ref, matcher: { string: zhs[0] }, supersedes: gone((zhByRef.get(stat.ref) ?? []).flatMap(s => s.matchers), currentZh) })
      }
    }
  }
  return { adds, rejects }
}

/** 交易站 id 是否仍有效(`X|n` 形式:X 是選項型 stat 且有選項 n 也算) */
export function liveIdTest (tradeStats) {
  const ids = new Set(tradeStats.map(e => e.id))
  const options = new Map(tradeStats.filter(e => e.option?.options).map(e => [e.id, new Set(e.option.options.map(o => String(o.id)))]))
  return (id) => {
    if (ids.has(id)) return true
    const cut = id.indexOf('|')
    return cut !== -1 && options.get(id.slice(0, cut))?.has(id.slice(cut + 1)) === true
  }
}

/**
 * 規則 3:失效 id。同群組有文字相同且唯一的現行 id → 替換;否則移除。
 * @returns {{ replace: Record<string, string>, remove: string[], rejects: any[] }}
 */
export function planDeadIds ({ enStats, tradeStats }) {
  const live = liveIdTest(tradeStats)
  const byTypeText = groupBy(tradeStats, e => `${e.id.slice(0, e.id.indexOf('.'))}\n${cmpKey(e.text)}`)
  /** @type {Record<string, string>} */
  const replace = {}
  const remove = new Set()
  const rejects = []
  for (const stat of eachStat(enStats)) {
    const texts = new Set([cmpKey(stat.ref), ...matcherKeys(stat)])
    for (const id of allIds(stat)) {
      if (live(id) || id in replace || remove.has(id)) continue
      const type = id.slice(0, id.indexOf('.'))
      const cands = [...new Set([...texts].flatMap(t => byTypeText.get(`${type}\n${t}`) ?? []).map(e => e.id))]
      if (cands.length === 1) replace[id] = cands[0]
      else {
        remove.add(id)
        if (cands.length > 1) rejects.push({ id, ref: stat.ref, reason: 'ambiguous', candidates: cands })
      }
    }
  }
  return { replace, remove: [...remove], rejects }
}

/**
 * 規則 4:GGPK 新版新增、交易站有同文字 id、專案沒有 → 新增一列。
 * @returns {{ ref: string, better: number, en: any[], zh: any[], ids: Record<string, string[]> }[]}
 */
export function planNewStats ({ enStats, ggpkOld, ggpkNew, tradeStats }) {
  const oldKeys = new Set(ggpkOld.map(r => r.key))
  const tradeByText = groupBy(tradeStats.filter(e => !e.id.startsWith('pseudo.')), e => cmpKey(noLocal(e.text)))
  const known = new Set()
  const usedIds = new Set()
  for (const stat of eachStat(enStats)) {
    known.add(cmpKey(stat.ref))
    for (const k of matcherKeys(stat)) known.add(k)
    for (const id of allIds(stat)) usedIds.add(id)
  }
  const out = new Map()
  for (const row of ggpkNew) {
    const k = cmpKey(row.en)
    if (oldKeys.has(row.key) || known.has(k) || !/[a-z]/.test(k)) continue
    const entries = (tradeByText.get(k) ?? []).filter(e => !usedIds.has(e.id))
    if (!entries.length) continue
    if (!out.has(k)) {
      /** @type {Record<string, string[]>} */
      const ids = {}
      for (const e of entries) (ids[e.id.slice(0, e.id.indexOf('.'))] ??= []).push(e.id)
      // better 0 = 不比較大小(不知道這條是越高越好還是越低越好,不猜)
      out.set(k, { ref: entries[0].text.replace(/\s+\(Local\)$/i, ''), better: 0, en: [{ string: toMatcherText(row.en) }], zh: [], ids })
    }
    const zh = row.zh && cmpKey(row.zh) !== k ? toMatcherText(row.zh) : null
    if (zh && !out.get(k).zh.some(m => m.string === zh)) out.get(k).zh.push({ string: zh })
  }
  return [...out.values()]
}

/**
 * 規則 5:物品改名與新增(只收交易站 static 查得到的)。
 * @returns {{ renames: any[], adds: any[] }}
 */
export function planItems ({ enItems, baseOld, baseNew, tradeStatic }) {
  const have = new Set(enItems.map(i => i.refName))
  const staticByText = new Map()
  for (const e of tradeStatic) if (!staticByText.has(e.text)) staticByText.set(e.text, e)
  const oldByPath = new Map(baseOld.map(r => [r.path, r]))
  const renames = []
  const adds = []
  const done = new Set()
  for (const row of baseNew) {
    const st = staticByText.get(row.en)
    if (!st || have.has(row.en) || done.has(row.en)) continue
    const old = oldByPath.get(row.path)
    if (old && old.en !== row.en && have.has(old.en)) {
      renames.push({ from: old.en, to: row.en, zh: row.zh, tradeTag: st.id })
    } else if (!old) {
      adds.push({ refName: row.en, zh: row.zh, tradeTag: st.id, icon: 'https://web.poecdn.com' + st.image })
    } else continue
    done.add(row.en)
  }
  return { renames, adds }
}

/**
 * 規則 6:交易站新上架的傳奇(名稱專案完全沒有的才加;同名換底材的舊版變體不處理)。
 * 繁中名取 GGPK words(英文名對到恰好一個繁中名),底材必須已在資料裡;否則拒收。
 * @returns {{ adds: any[], rejects: any[] }}
 */
export function planUniques ({ enItems, tradeItems, words }) {
  const have = new Set(enItems.filter(i => i.namespace === 'UNIQUE').map(i => i.refName))
  const bases = new Set(enItems.filter(i => i.namespace === 'ITEM').map(i => i.refName))
  const zhOf = groupBy(words, w => w.en)
  const adds = []
  const rejects = []
  for (const e of tradeItems) {
    if (!e.flags?.unique || !e.name || have.has(e.name)) continue
    have.add(e.name)
    const zh = [...new Set((zhOf.get(e.name) ?? []).map(w => w.zh))]
    if (!bases.has(e.type)) rejects.push({ reason: '底材不在資料裡', id: e.name, to: e.type })
    else if (zh.length !== 1) rejects.push({ reason: 'GGPK 沒有唯一的繁中名', id: e.name, candidates: zh })
    else adds.push({ refName: e.name, zh: zh[0], base: e.type })
  }
  return { adds, rejects }
}

/** 逐列改寫 ndjson:只重寫有變動的列,保留原行尾 */
function rewriteLines (fileText, edit, appended = []) {
  const eol = fileText.includes('\r\n') ? '\r\n' : '\n'
  const lines = fileText.split(eol)
  const tail = lines[lines.length - 1] === '' ? [lines.pop()] : []
  const out = lines.map(line => {
    if (!line.trim()) return line
    const obj = JSON.parse(line)
    return edit(obj) ? JSON.stringify(obj) : line
  })
  return [...out, ...appended.map(o => JSON.stringify(o)), ...tail].join(eol)
}

/**
 * 套用詞綴計畫(adds / replace / remove / newStats)到一份 stats.ndjson 文字
 * @param {string} fileText
 * @param {'en' | 'cmn-Hant'} lang
 * @param {{ adds?: any[], replace?: Record<string, string>, remove?: string[], newStats?: any[] }} [plan]
 */
export function applyStatPlan (fileText, lang, { adds = [], replace = {}, remove = [], newStats = [] } = {}) {
  const addsByRef = groupBy(adds.filter(a => a.lang === lang), a => a.ref)
  const gone = new Set(remove)
  const existingRefs = new Set()
  const editStat = (stat) => {
    let changed = false
    existingRefs.add(stat.ref)
    for (const a of addsByRef.get(stat.ref) ?? []) {
      const keys = matcherKeys(stat)
      // 已經有了沒 = 逐字比(解析器逐字比對,只差大小寫的新寫法也要加)
      if (matcherExact(stat).has(a.matcher.string.trim()) || (a.after !== undefined && !keys.has(cmpKey(a.after)))) continue
      if (Array.isArray(a.supersedes)) { // 規則 B:列出的舊句(逐字)全部標記
        const old = new Set(a.supersedes.map(t => t.trim()))
        for (const m of stat.matchers) if (old.has(m.string.trim())) m.superseded = true
      } else if (a.supersedes !== undefined) {
        // 被取代的舊寫法留著(舊樣本仍可解析),只加標記;正則「物品詞綴數值」頁不拿它當模板。
        // 繁中資料若是台服用詞(對不上 GGPK 舊句):同旗標的舊 matcher 恰好一條時就是它。
        const sameFlags = stat.matchers.filter(m => Boolean(m.negate) === Boolean(a.matcher.negate) && m.value === a.matcher.value)
        const exact = sameFlags.filter(m => cmpKey(m.string) === cmpKey(a.supersedes))
        for (const m of exact.length ? exact : (sameFlags.length === 1 ? sameFlags : [])) m.superseded = true
      }
      stat.matchers.push(a.matcher)
      changed = true
    }
    for (const [type, ids] of Object.entries(stat.trade?.ids ?? {})) {
      const next = [...new Set(ids.filter(id => !gone.has(id)).map(id => replace[id] ?? id))]
      if (next.length === ids.length && next.every((id, i) => id === ids[i])) continue
      if (next.length) stat.trade.ids[type] = next
      else delete stat.trade.ids[type]
      changed = true
    }
    return changed
  }
  const text = rewriteLines(fileText, (row) => (row.stats ?? [row]).filter(s => s.matchers).map(editStat).some(Boolean))
  const fresh = newStats.filter(s => !existingRefs.has(s.ref)).map(s => ({
    ref: s.ref, better: s.better, matchers: lang === 'en' || !s.zh.length ? s.en : s.zh, trade: { ids: s.ids }
  }))
  return fresh.length ? rewriteLines(text, () => false, fresh) : text
}

/**
 * 套用物品計畫(renames / adds)到一份 items.ndjson 文字
 * @param {string} fileText
 * @param {'en' | 'cmn-Hant'} lang
 * @param {{ renames?: any[], adds?: any[], uniques?: any[] }} [plan]
 */
export function applyItemPlan (fileText, lang, { renames = [], adds = [], uniques = [] } = {}) {
  const byFrom = new Map(renames.map(r => [r.from, r]))
  const have = new Set()
  const nameOf = (en, zh) => (lang === 'en' ? en : (zh ?? en))
  const text = rewriteLines(fileText, (item) => {
    const r = byFrom.get(item.refName)
    if (r) {
      item.name = nameOf(r.to, r.zh)
      item.refName = r.to
      item.tradeTag = r.tradeTag
    }
    have.add(item.refName)
    return Boolean(r)
  })
  const fresh = adds.filter(a => !have.has(a.refName)).map(a => ({
    name: nameOf(a.refName, a.zh), refName: a.refName, namespace: 'ITEM', tradeTag: a.tradeTag, exchangeable: true, icon: a.icon
  }))
  for (const u of uniques) {
    if (!have.has(u.refName)) fresh.push({ name: nameOf(u.refName, u.zh), refName: u.refName, namespace: 'UNIQUE', unique: { base: u.base } })
  }
  return fresh.length ? rewriteLines(text, () => false, fresh) : text
}
