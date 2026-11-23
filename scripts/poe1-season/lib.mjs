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

/**
 * 句型判不準的詞綴,方向逐條指定(1 = 越高越好、-1 = 越低越好);新增時與每次更新都會套到資料列。
 * 「減少 …」而數值越大越好的 → 1;數值是負的或屬於壞處的 → -1(同類既有資料:Cold Exposure … 是 -1)。
 * @type {Record<string, number>}
 */
export const BETTER_OVERRIDES = {
  '#% reduced Area Damage taken from Hits': 1,
  '#% reduced Mana Cost of Attacks': 1,
  'Minions take #% reduced Reflected Damage': 1,
  '#% reduced Enemy Chance to Block Sword Attacks': 1,
  '#% chance to take 20% less Area Damage from Hits per 2% Overcapped Cold Resistance': 1,
  'Enemies within 6 metres of corpses you spawned Recently\nhave #% reduced Life Regeneration Rate': 1,
  'Fire Exposure you inflict applies an extra +#% to Fire Resistance': -1,
  '+# Physical Damage taken from Hits per Level': -1,
  'Enemies Taunted by your Warcries have #% increased Action Speed': -1,
  // 2026-11-15:「減少」而數值越大越不利的(其餘「減少 …」預設 1,見 betterOf)
  '#% reduced Spark Duration': -1,
  'Curses have #% reduced effect on Monsters': -1
}

/**
 * 新詞綴的 better:帶數值 → 1(查價用「至少這個值」);沒有數值 → 0(完全相同才算)。
 * 既有資料帶數值的詞綴 97% 是 1;標 0 會讓這條在物品上**預設勾選、只找數值一模一樣的掛單**(2026-11-14 范迪戈之革;
 * 2026-11-15 審查:「減少 …」原本標 0,32 條新增的「X 減少 #% 保留 / 承受傷害 / 消耗」會讓預設查詢多一條精確條件)。
 * 「減少 / 更少」的句子在物品上多半是好處(保留、承受傷害、消耗、敵人格擋)→ 也給 1;「失去 …」→ -1;
 * 判不準的逐條列在 BETTER_OVERRIDES。
 * shortcut: 少數「越低越好」的句子會被標成 1(使用者勾選時範圍方向相反,可自己改),遇到再加進 BETTER_OVERRIDES。
 */
export function betterOf (ref) {
  if (ref in BETTER_OVERRIDES) return BETTER_OVERRIDES[ref]
  if (!ref.includes('#') || /Grants Level \d+ #/.test(ref)) return 0
  return /\blose\b/i.test(ref) ? -1 : 1
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

/** 交易站 id 的類型(explicit / implicit / enchant …) */
const typeOf = (id) => id.slice(0, id.indexOf('.'))
const uniq = (list) => Array.from(new Set(list))
/** 數字換成 #:新句與既有 matcher 同形(「獲得 1 層盛怒」對「獲得 # 層盛怒」)會搶走既有詞綴的比對 */
const shape = (text) => text.replace(/\d+(?:\.\d+)?/g, '#')
/** 沒被取代的 matcher */
const liveOf = (stat) => stat.matchers.filter(m => !m.superseded)
const flagsOf = (m) => ({ ...(m.negate ? { negate: true } : {}), ...(m.value !== undefined ? { value: m.value } : {}) })
const statsByRef = (rows) => groupBy([...eachStat(rows)], s => s.ref)
/** 資料已引用的交易站 id */
function usedIds (rows, seed = /** @type {string[]} */ ([])) {
  const used = new Set(seed)
  for (const stat of eachStat(rows)) for (const id of allIds(stat)) used.add(id)
  return used
}
/** clientstrings 句型({1} = 等級、{0} = 名稱)→ matcher 文字 */
const fillTpl = (text, name) => text.replace('{1}', '#').replace('{0}', name)
/** 英文名 → 繁中名(去重);瓦爾版的英文顯示名有時與原版相同(Determination → 堅定 / 瓦爾．堅定),英文沒寫 Vaal 就不是瓦爾版 */
const zhNamesOf = (names, en) => uniq((names.get(en) ?? []).map(s => s.zh)).filter((z, _, a) => a.length === 1 || en.startsWith('Vaal ') || !z.startsWith('瓦爾．'))

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
  const zhByRef = statsByRef(zhStats)
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
      const flags = flagsOf(m)
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
  const casePairs = uniq(ggpkOld.map(r => exactKey(r.en))).filter(o => !newTexts.has(o))
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
  const zhByRef = statsByRef(zhStats)
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
            const flags = flagsOf(m)
            adds.push({ lang: 'en', ref: stat.ref, matcher: { string: text, ...flags }, after: m.string, supersedes: m.string })
          }
          continue
        }
        const reject = (reason, lang = 'en', to = text) => rejects.push({ ref: stat.ref, lang, reason, id, to })
        if (direction(text) === -1 && stat.matchers.some(m => !m.negate && direction(m.string) === 1)) { reject('direction'); continue }
        if ([...(enRefs.get(cmpKey(text)) ?? [])].some(r => r !== stat.ref)) { reject('collision'); continue }
        adds.push({ lang: 'en', ref: stat.ref, matcher: { string: text }, supersedes: gone(stat.matchers, current) })
        const zhs = uniq(rows.filter(r => r.zh && cmpKey(r.zh) !== cmpKey(text)).map(r => exactKey(r.zh)))
        if (zhs.length !== 1) { if (zhs.length) reject('ambiguous', 'cmn-Hant', zhs.join(' / ')); continue }
        if (haveZh.has(zhs[0])) continue
        if ([...(zhRefs.get(cmpKey(zhs[0])) ?? [])].some(r => r !== stat.ref)) { reject('collision', 'cmn-Hant', zhs[0]); continue }
        adds.push({ lang: 'cmn-Hant', ref: stat.ref, matcher: { string: zhs[0] }, supersedes: gone((zhByRef.get(stat.ref) ?? []).flatMap(s => s.matchers), currentZh) })
      }
    }
  }
  return { adds, rejects }
}

/**
 * 規則 27(類型掃描 2026-11-18 找到):交易站同一個 id 有好幾句(地圖物品上的「… in Area」與輿圖天賦的「… in your Maps」),
 * 資料只收了其中一句(規則 B 對「已經對得上一句」的 id 不動)→ 另一句出現在物品上時是未解析。
 * 另一句在 GGPK 新版找得到、資料任何一條詞綴都沒有 → 加上並標 superseded(同一個 id,查詢不變;現行寫法與正則頁不變)。
 * 旗標照已經對得上的那個 matcher;# 的個數不同(另一句把數字寫死或多一個數字)、方向相反、已是別條詞綴寫法的拒收。
 * 繁中取 GGPK 同一句英文唯一的繁中。沒有實機樣本。
 * @returns {{ adds: any[], rejects: any[] }}
 */
export function planOtherTradeTexts ({ enStats, zhStats, tradeStats, ggpkNew }) {
  const textsById = groupBy(tradeStats.filter(e => !e.id.startsWith('pseudo.')), e => e.id)
  const ggpkByEn = groupBy(ggpkNew.filter(r => r.zh), r => exactKey(r.en))
  const enRefs = refsByMatcher(enStats)
  const zhRefs = refsByMatcher(zhStats)
  const zhByRef = statsByRef(zhStats)
  const hashes = (t) => (t.match(/#/g) ?? []).length
  const adds = []
  const rejects = []
  const seen = new Set()
  for (const stat of eachStat(enStats)) {
    const have = matcherExact(stat)
    const haveZh = new Set((zhByRef.get(stat.ref) ?? []).flatMap(s => [...matcherExact(s)]))
    for (const id of allIds(stat)) {
      const texts = uniq((textsById.get(id) ?? []).map(e => exactKey(noLocal(e.text))))
      const base = stat.matchers.find(m => texts.includes(m.string.trim()))
      if (!base) continue // 一句都對不上的歸規則 B
      for (const text of texts) {
        if (have.has(text) || seen.has(stat.ref + '\n' + text) || !ggpkByEn.has(text)) continue
        seen.add(stat.ref + '\n' + text)
        const reject = (reason, lang = 'en', to = text) => rejects.push({ ref: stat.ref, lang, reason, id, to })
        if (hashes(text) !== hashes(base.string)) { reject('數字個數不同'); continue }
        if (direction(text) && direction(base.string) && direction(text) !== direction(base.string)) { reject('方向相反'); continue }
        if (enRefs.has(cmpKey(text))) { reject('已是別條詞綴的寫法'); continue }
        adds.push({ lang: 'en', ref: stat.ref, matcher: { string: text, ...flagsOf(base), superseded: true } })
        const zhs = uniq(ggpkByEn.get(text).map(r => exactKey(r.zh)).filter(z => cmpKey(z) !== cmpKey(text)))
        if (zhs.length !== 1) { if (zhs.length) reject('繁中不只一句', 'cmn-Hant', zhs.join(' / ')); continue }
        if (haveZh.has(zhs[0])) continue
        if (zhRefs.has(cmpKey(zhs[0]))) { reject('已是別條詞綴的寫法', 'cmn-Hant', zhs[0]); continue }
        adds.push({ lang: 'cmn-Hant', ref: stat.ref, matcher: { string: zhs[0], ...flagsOf(base), superseded: true } })
      }
    }
  }
  return { adds, rejects }
}

/**
 * 規則 8:「插槽中的寶石被等級 # 的 X 輔助」(ref 結尾 `(Random Support Gem)` 的列)。
 * 3.30 起遊戲把 {1} 填成寶石全名(施放迴響 → 施放迴響輔助;使用者 2026-11-14 實機剪貼簿),
 * 新句 = GGPK 的句型(`local_random_support_gem_level …`)+ baseitemtypes 的寶石名(以英文 `<X> Support` 對接)。
 * 舊句標 superseded(舊資料的寶石名與 GGPK 不同時,該列唯一的舊句就是它;留著兩種寫法正則物品詞綴數值頁會把它當多種寫法而排除)。英文沒有實機樣本,是由同一個句型推出來的。
 */
export function planSupportGemNames ({ enStats, zhStats, ggpkNew, baseNew }) {
  const tpl = ggpkNew.find(r => r.key.startsWith('local_random_support_gem_level local_random_support_gem_index|'))
  const gems = groupBy(baseNew.filter(r => r.path.startsWith('Metadata/Items/Gems/')), r => r.en)
  const adds = []
  const rejects = []
  if (!tpl) return { adds, rejects }
  const fill = (text, name) => toMatcherText(text.replace('{1}', name))
  const zhByRef = statsByRef(zhStats)
  const has = (stats, text) => stats.some(s => s.matchers.some(x => x.string === text))
  for (const stat of eachStat(enStats)) {
    const m = /^Socketed Gems are Supported by Level # (.+) \(Random Support Gem\)$/.exec(stat.ref)
    if (!m) continue
    const zh = uniq((gems.get(`${m[1]} Support`) ?? []).map(r => r.zh))
    if (zh.length !== 1) { rejects.push({ reason: 'GGPK 沒有唯一的輔助寶石名', ref: stat.ref, candidates: zh }); continue }
    const en = fill(tpl.en, `${m[1]} Support`)
    if (!has([stat], en)) adds.push({ lang: 'en', ref: stat.ref, matcher: { string: en }, supersedes: fill(tpl.en, m[1]) })
    if (!has(zhByRef.get(stat.ref) ?? [], fill(tpl.zh, zh[0]))) adds.push({ lang: 'cmn-Hant', ref: stat.ref, matcher: { string: fill(tpl.zh, zh[0]) }, supersedes: fill(tpl.zh, zh[0].replace(/輔助$/, '')) })
  }
  return { adds, rejects }
}

/**
 * 規則 13:「獲得等級 # 的 X 技能」3.30 起改由句型 clientstrings `ModGrantsEffectWithLevel`
 * (`Grants Level {1} {0}` /「賦予等級 {1} 的 {0}」)+ 技能顯示名組成(GitHub issue #10 #11 的實機文字:
 * 「賦予等級 20 的 嗜血」;名稱前的零寬空白由解析器去掉)。只處理單行的 `Grants Level # X[ Skill]`;
 * 技能繁中名取 GGPK activeskills,不唯一就拒收。舊句標 superseded。
 * @returns {{ adds: any[], rejects: any[] }}
 */
export function planGrantsSkill ({ enStats, zhStats, skills, template }) {
  const adds = []
  const rejects = []
  if (!template) return { adds, rejects }
  const zhOf = groupBy(skills, s => s.en)
  const zhByRef = statsByRef(zhStats)
  for (const stat of eachStat(enStats)) {
    const m = /^Grants Level # ([^\n]+?)(?: Skill)?$/.exec(stat.ref)
    if (!m) continue
    const en = fillTpl(template.en, m[1])
    const zhNames = zhNamesOf(zhOf, m[1])
    const zhStat = (zhByRef.get(stat.ref) ?? [])[0]
    if (zhNames.length !== 1 || !zhStat) { rejects.push({ reason: 'GGPK 沒有唯一的技能繁中名', ref: stat.ref, candidates: zhNames }); continue }
    const zh = fillTpl(template.zh, zhNames[0])
    if (liveOf(stat).length === 1 && !stat.matchers.some(x => x.string === en)) adds.push({ lang: 'en', ref: stat.ref, matcher: { string: en }, supersedes: liveOf(stat)[0].string })
    if (liveOf(zhStat).length === 1 && !zhStat.matchers.some(x => x.string === zh)) adds.push({ lang: 'cmn-Hant', ref: stat.ref, matcher: { string: zh }, supersedes: liveOf(zhStat)[0].string })
  }
  return { adds, rejects }
}

/**
 * 規則 14:專案裡完全沒有交易站 id 的詞綴(解析器會把它當未解析),交易站現在有同文字、還沒被別的詞綴用的 id → 補上。
 * 3.30「賦予技能」改發 `explicit.effect_*`(GitHub issue #10:劊子手．傑克的「賦予等級 20 的 嗜血」)。
 * 文字比對用 ref 與現行的英文 matcher(寬鬆鍵)。
 * @returns {Record<string, Record<string, string[]>>} ref → ids
 */
export function planFillIds ({ enStats, tradeStats }) {
  const used = usedIds(enStats)
  const byText = groupBy(tradeStats.filter(e => !e.id.startsWith('pseudo.')), e => cmpKey(noLocal(e.text)))
  /** @type {Record<string, Record<string, string[]>>} */
  const out = {}
  for (const stat of eachStat(enStats)) {
    if (stat.ref in out) continue
    // 已有 id 的詞綴只加 effect_ 新 id:3.30 物品的輔助寶石 / 賦予技能詞綴索引在新 id,舊 id 可能搜尋 0 筆,兩個都送(count 群組)
    const hasIds = allIds(stat).length > 0
    const keys = new Set([cmpKey(stat.ref), ...liveOf(stat).map(m => cmpKey(m.string))])
    /** @type {Record<string, string[]>} */
    const ids = {}
    for (const k of keys) {
      for (const e of byText.get(k) ?? []) {
        const type = typeOf(e.id)
        if (hasIds && !e.id.includes('.effect_')) continue
        if (!used.has(e.id) && !(ids[type] ?? []).includes(e.id)) (ids[type] ??= []).push(e.id)
      }
    }
    if (Object.keys(ids).length) {
      out[stat.ref] = ids
      for (const id of Object.values(ids).flat()) used.add(id) // 同一個 id 不給第二條詞綴
    }
  }
  return out
}

/**
 * 規則 15:交易站有 `effect_*` id、專案沒有任何詞綴引用它(逐條比對 2026-11-15:77 個)。
 * 3.30 這類詞綴由 clientstrings 句型 + 名稱組成:`ModGrantsEffect`(賦予 {0})、`ModGrantsEffectWithLevel`、
 * `ModGrantsSupportEffectWithLevel`;名稱取 GGPK(技能 = activeskills,輔助寶石 = baseitemtypes / gemeffects),不唯一就拒收。
 * 專案已有同一個技能的舊句(ref = 交易站文字[ + ` Skill`])→ 只加新寫法、舊句標 superseded,id 下一輪由規則 14 補;否則新增一列。
 * @returns {{ newStats: any[], adds: any[], rejects: any[] }}
 */
export function planEffectStats ({ enStats, zhStats, tradeStats, skills, supports, strings = {}, taken = /** @type {string[]} */ ([]) }) {
  // taken:同一輪規則 14 會掛到既有詞綴上的 id(不先扣掉會替同一個 id 另外新增一列)
  const used = usedIds(enStats, taken)
  const byRef = statsByRef(enStats)
  const zhByRef = statsByRef(zhStats)
  const kinds = [
    { re: /^Socketed Gems are Supported by Level # (.+ Support)$/, tpl: strings.ModGrantsSupportEffectWithLevel, names: groupBy(supports, s => s.en) },
    { re: /^Grants Level # (.+)$/, tpl: strings.ModGrantsEffectWithLevel, names: groupBy(skills, s => s.en) },
    { re: /^Grants (.+)$/, tpl: strings.ModGrantsEffect, names: groupBy(skills, s => s.en) }
  ]
  const newStats = new Map()
  const adds = []
  const rejects = []
  const ownerOf = new Map([...eachStat(enStats)].flatMap(s => allIds(s).map(id => [id, s])))
  for (const e of tradeStats) {
    if (!e.id.includes('.effect_')) continue
    if (!used.has(e.id) && newStats.has(e.text)) { (newStats.get(e.text).ids[typeOf(e.id)] ??= []).push(e.id); continue }
    const kind = kinds.find(k => k.tpl && k.re.test(e.text))
    const name = kind?.re.exec(e.text)?.[1]
    const zhNames = kind ? zhNamesOf(kind.names, name) : []
    if (used.has(e.id)) {
      // 規則 14 依同文(不分大小寫)把 effect id 掛到舊句(「Grants level # Affliction」)時,3.30 句型的寫法沒進資料
      // (GitHub issue #59:自私牧羊人「賦予等級 20 的 禁咒」)→ 補上、標 superseded(舊句仍是現行寫法)
      const owner = ownerOf.get(e.id)
      const ownerZh = owner && (zhByRef.get(owner.ref) ?? [])[0]
      if (!owner || !ownerZh || !kind || zhNames.length !== 1) continue
      const en = toMatcherText(fillTpl(kind.tpl.en, name))
      const zh = toMatcherText(fillTpl(kind.tpl.zh, zhNames[0]))
      if (!owner.matchers.some(m => m.string === en)) adds.push({ lang: 'en', ref: owner.ref, matcher: { string: en, superseded: true } })
      if (!ownerZh.matchers.some(m => m.string === zh)) adds.push({ lang: 'cmn-Hant', ref: owner.ref, matcher: { string: zh, superseded: true } })
      continue
    }
    if (!kind || zhNames.length !== 1) { rejects.push({ reason: 'GGPK 沒有唯一的技能 / 寶石繁中名', id: e.id, to: e.text, candidates: zhNames }); continue }
    const en = fillTpl(kind.tpl.en, name)
    const zh = fillTpl(kind.tpl.zh, zhNames[0])
    // 舊列 ref 沒有「 Support」的寫法只認還沒有任何 id 的(有 id 的那種與「(Random Support Gem)」列並存,新 id 由規則 14 掛到後者)
    const bare = (byRef.get(e.text.replace(/ Support$/, '')) ?? []).filter(x => !allIds(x).length)
    const old = (byRef.get(e.text) ?? byRef.get(`${e.text} Skill`) ?? bare)[0]
    const oldZh = old && (zhByRef.get(old.ref) ?? [])[0]
    if (old && oldZh) {
      if (liveOf(old).length === 1 && !old.matchers.some(m => m.string === en)) adds.push({ lang: 'en', ref: old.ref, matcher: { string: en }, supersedes: liveOf(old)[0].string })
      if (liveOf(oldZh).length === 1 && !oldZh.matchers.some(m => m.string === zh)) adds.push({ lang: 'cmn-Hant', ref: old.ref, matcher: { string: zh }, supersedes: liveOf(oldZh)[0].string })
      continue
    }
    newStats.set(e.text, { ref: e.text, better: betterOf(e.text), en: [{ string: en }], zh: [{ string: zh }], ids: { [typeOf(e.id)]: [e.id] } })
  }
  return { newStats: [...newStats.values()], adds, rejects }
}

/**
 * 規則 16:交易站有、專案沒有任何詞綴引用的 id(隨機 / 固定 / 破裂 / 工藝),而專案裡有文字相同的詞綴 → 把 id 掛上去
 * (逐條比對 `audit-trade-ids.mjs` 的「沒引用 A / B」:同一條詞綴少掛了某個類型的 id)。
 * 只收文字(ref 或現行英文 matcher,寬鬆鍵)相同且唯一的那一條;同文字不只一條、選項型 id(`X|n`)、
 * 在合併群組裡的詞綴(類型會影響群組內選哪一條;例外:trivial-merge 且群組內每條完全相同,見 `twinGroup`)、雜湊與該詞綴既有 id 不同的都拒收。
 * 例外(GitHub issue #38 巫會之后冠):3.30 臟器的固定詞綴用自己的 stat(GGPK stat 鍵含 `viscera`,一般臟器與后冠各一個),
 * (整個單字比對:`local_display_grants_skill_evisceration` 不算),句子與既有詞綴逐字相同、交易站另給固定詞綴 id → 雜湊不同也掛上;同一句有兩個 id 就兩個都掛(物品文字分不出是哪一個,查詢兩個都送)。
 * @returns {{ extra: Record<string, Record<string, string[]>>, rejects: any[] }}
 */
export const TYPE_ID_GROUPS = ['explicit', 'implicit', 'fractured', 'crafted']
/**
 * 交易站同一類型、文字逐字相同的另一個 id(雜湊不同),實測有物品的才列在這裡 → 掛在既有 id 後面,查詢兩個都送。
 * 依據:2026-11-20 在 Standard 逐一搜尋 86 個這種 id,只有這 18 個有結果(其餘 68 個 0 筆,不掛:多送一個條件沒有好處)。
 * 新賽季交易站多出同文 id 時,先實際搜尋有結果再加進來。
 */
export const LIVE_TWIN_IDS = new Set([
  'explicit.stat_389725673', 'explicit.stat_3665534869', 'explicit.stat_28550326', 'explicit.stat_3408601861', 'explicit.stat_1934713036',
  'explicit.stat_165218607', 'explicit.stat_156080652', 'explicit.stat_3848992177', 'explicit.stat_3904501306', 'explicit.stat_1029319062',
  'explicit.stat_2916634441', 'explicit.stat_1888494262', 'explicit.stat_335507772', 'explicit.stat_4082662318',
  'implicit.stat_2902845638', 'implicit.stat_335507772', 'enchant.stat_865263728', 'enchant.stat_945725535'
])
// trivial-merge 群組裡每條的 ref / matchers / 正負都相同 = 同一句的兩個 stat,解析時 id 會合併送出 → 依 ref 掛上不會掛錯條(GitHub issue #67);
// id 依 ref 兩語都掛 → 繁中那組也要相同(猛攻、焦灼地面兩組英文相同、繁中不同,繁中解析只選一條)
const twinGroup = (row) => row.resolve?.strat === 'trivial-merge' && row.stats.length > 1 &&
  new Set(row.stats.map(s => JSON.stringify([s.ref, s.matchers, !!s.trade?.inverted]))).size === 1
export function planTypeIds ({ enStats, zhStats = /** @type {any[] | undefined} */ (undefined), tradeStats, ggpkNew = /** @type {any[]} */ ([]), twins = LIVE_TWIN_IDS }) {
  const zhTwins = zhStats && new Set(zhStats.filter(r => r.stats && twinGroup(r)).map(r => r.stats[0].ref))
  const visceraTexts = new Set(ggpkNew.filter(r => r.key.split('|')[0].split(' ').some(id => /(^|_)viscera(_|$)/.test(id))).map(r => cmpKey(toMatcherText(r.en))))
  const used = new Set()
  const grouped = new Set()
  const hashOf = (id) => id.slice(id.indexOf('.') + 1)
  /** @type {Map<string, Set<string>>} */
  const hashes = new Map()
  /** @type {Map<string, Set<string>>} */
  const refsByText = new Map()
  /** @type {Map<string, Set<string>>} */
  const refsByOldText = new Map()
  for (const row of enStats) {
    for (const stat of row.stats ?? [row]) {
      if (!stat.matchers) continue
      if (row.stats && !(twinGroup(row) && (!zhTwins || zhTwins.has(stat.ref)))) grouped.add(stat.ref)
      for (const id of allIds(stat)) used.add(id)
      // twins 的雜湊不算這條詞綴的 stat:否則下一輪會把同雜湊、沒實測過的其他類型 id 也帶進來
      for (const id of allIds(stat)) if (!twins.has(id)) (hashes.get(stat.ref) ?? hashes.set(stat.ref, new Set()).get(stat.ref)).add(hashOf(id))
      for (const k of [cmpKey(stat.ref), ...liveOf(stat).map(m => cmpKey(m.string))]) {
        if (!refsByText.has(k)) refsByText.set(k, new Set())
        refsByText.get(k).add(stat.ref)
      }
      // twins 另外認被取代的舊寫法(交易站文字常停在舊句:「… Supported by Level # Predator」)
      for (const m of stat.matchers) if (m.superseded) (refsByOldText.get(cmpKey(m.string)) ?? refsByOldText.set(cmpKey(m.string), new Set()).get(cmpKey(m.string))).add(stat.ref)
    }
  }
  /** @type {Record<string, Record<string, string[]>>} */
  const extra = {}
  const rejects = []
  for (const e of tradeStats) {
    const type = typeOf(e.id)
    if (!(TYPE_ID_GROUPS.includes(type) || twins.has(e.id)) || used.has(e.id)) continue
    const key = cmpKey(noLocal(e.text))
    const refs = [...(refsByText.get(key) ?? (twins.has(e.id) ? refsByOldText.get(key) : undefined) ?? [])]
    if (!refs.length) {
      // 資料完全沒有這條詞綴(逐條比對的 C 類),不在這條規則的範圍;列名的 twins 對不到要報出來
      if (twins.has(e.id)) rejects.push({ reason: 'twins 找不到同文字的詞綴', id: e.id, to: e.text, candidates: [] })
      continue
    }
    const reject = (reason) => rejects.push({ reason, id: e.id, to: e.text, candidates: refs })
    if (refs.length > 1) reject('同文字的詞綴不只一條')
    else if (e.id.includes('|')) reject('選項型 id')
    else if (grouped.has(refs[0])) reject('在合併群組裡')
    // 交易站會把同一句話給兩個不同的 stat(例:地圖的「#% more Monster Life」);只收與該詞綴既有 id 同一個雜湊的(= 同一個 stat 少掛了某個類型),
    // 雜湊不同就不確定是不是同一條,任何類型都不掛(審查 2026-11-15:只擋同類型會讓破裂 / 固定掛到另一個 stat)
    else if (!twins.has(e.id) && !hashes.get(refs[0])?.has(hashOf(e.id)) && !(type === 'implicit' && visceraTexts.has(cmpKey(noLocal(e.text))))) reject('與既有 id 不是同一個 stat')
    else if (!((extra[refs[0]] ??= {})[type] ??= []).includes(e.id)) extra[refs[0]][type].push(e.id)
  }
  return { extra, rejects }
}

/**
 * 規則 18:3.30 傳奇珠寶「腐敗之種」塗抹後洗出的天賦(使用者 2026-11-15 實機:「1 個附加的天賦為謹慎反擊 (enchant)」)。
 * 交易站是選項型附魔 `enchant.stat_3599615742|<n>`「1 added passive skill is X」,472 個選項的編號與名稱和既有塗油詞綴
 * `enchant.stat_2954116742|<n>`「Allocates X」一一對應 → 以同編號且同名的「Allocates X」取繁中名(「配置 X」去掉前綴),
 * 句型照星團珠寶既有的「1 Added Passive Skill is X」/「1 個附加的天賦為 X」。對不上的不猜。
 * 專案已有同一句的詞綴(星團珠寶的同名天賦)→ 只把 id 掛上去。
 * @returns {{ newStats: any[], extra: Record<string, Record<string, string[]>>, rejects: any[] }}
 */
const GROWN_PASSIVE_ID = 'enchant.stat_3599615742|'
const ANOINT_ID = 'enchant.stat_2954116742|'
export function planGrownPassives ({ enStats, zhStats, tradeStats }) {
  const used = new Set()
  const byMatcher = new Map()
  const anoint = new Map()
  for (const stat of eachStat(enStats)) {
    for (const id of allIds(stat)) used.add(id)
    for (const m of stat.matchers) if (!byMatcher.has(m.string)) byMatcher.set(m.string, stat)
    for (const id of stat.trade?.ids?.enchant ?? []) if (id.startsWith(ANOINT_ID) && stat.ref.startsWith('Allocates ')) anoint.set(id.slice(ANOINT_ID.length), stat.ref)
  }
  const zhByRef = statsByRef(zhStats)
  const newStats = []
  /** @type {Record<string, Record<string, string[]>>} */
  const extra = {}
  const rejects = []
  // 兩個不同天賦的繁中名相同(復仇 = Vengeance / Retaliation、堅定不移 = Adamant / Unfaltering):繁中 matcher 一個字串只能指向一列,
  // 給了會把其中一個配成另一個天賦的 id → 這種的不給繁中寫法(繁中客戶端顯示未解析,看得出來)
  const zhNameOf = (ref) => (zhByRef.get(ref) ?? []).flatMap(s => s.matchers).map(m => /^配置 (.+)$/.exec(m.string)?.[1]).find(Boolean)
  const zhCount = new Map()
  for (const ref of new Set(anoint.values())) { const z = zhNameOf(ref); if (z) zhCount.set(z, (zhCount.get(z) ?? 0) + 1) }
  for (const e of tradeStats) {
    if (!e.id.startsWith(GROWN_PASSIVE_ID) || used.has(e.id)) continue
    const name = /^1 added passive skill is (.+)$/i.exec(e.text)?.[1]
    const ref = anoint.get(e.id.slice(GROWN_PASSIVE_ID.length))
    const zhName = ref && name && ref === `Allocates ${name}` ? zhNameOf(ref) : undefined
    if (!zhName) { rejects.push({ reason: '沒有同編號同名的塗油詞綴', id: e.id, to: e.text }); continue }
    const en = `1 Added Passive Skill is ${name}`
    const have = byMatcher.get(en)
    if (have) (extra[have.ref] ??= { enchant: [] }).enchant.push(e.id)
    else {
      const shared = (zhCount.get(zhName) ?? 0) > 1
      if (shared) rejects.push({ reason: '繁中名與另一個天賦相同', id: e.id, to: e.text, candidates: [zhName] })
      newStats.push({ ref: en, better: 1, en: [{ string: en }], zh: shared ? [] : [{ string: `1 個附加的天賦為${zhName}` }], ids: { enchant: [e.id] } })
    }
  }
  return { newStats, extra, rejects }
}

/**
 * 規則 25:天賦繁中改名(GGPK `passiveskills` 同一個 ident 新舊兩版英文名相同、繁中不同;3.30 Avatar of the Wilds 獸性化身 → 荒野化身,
 * GitHub issue #34)。名字在「配置 X」結尾的繁中寫法(塗油、禁忌珠寶)補新名,舊的標 superseded。
 * 依詞綴 ref 裡的英文天賦名對(`Allocates X` / 禁忌珠寶句);同一個天賦有兩種改名不猜。
 * 腐敗之種洗出的天賦(「1 Added Passive Skill is X」只有 enchant id 的列)也帶入新名(issue #39):直接換掉舊句;星團珠寶那幾列(帶 explicit id)是寫死名稱、不改。
 * @returns {{ adds: any[], rejects: any[] }}
 */
export function planPassiveRenames ({ zhStats, renames }) {
  const adds = []
  const rejects = []
  // 依詞綴 ref 的英文天賦名對:不同天賦可能共用舊繁中名,只看繁中名會換錯
  const byEn = new Map()
  for (const r of renames) {
    if (r.from === r.zh) continue
    const had = byEn.get(r.en)
    if (had === undefined) byEn.set(r.en, r)
    else if (had && (had.from !== r.from || had.zh !== r.zh)) { byEn.set(r.en, null); rejects.push({ reason: '同一個天賦有兩種改名', en: r.en }) }
  }
  for (const stat of eachStat(zhStats)) {
    // 只收「Allocates X」(塗油、禁忌珠寶:名稱由 passiveskills 動態帶入);星團「1 Added Passive Skill is X」是寫死名稱的句子,3.30 仍是舊名
    const en = /^Allocates (.+?)(?: if you have the matching modifier on Forbidden (?:Flame|Flesh))?$/.exec(stat.ref)?.[1]
    const r = en && byEn.get(en)
    if (!r) continue
    for (const m of stat.matchers) {
      if (m.superseded) continue
      const hit = /(配置 )(.+)$/.exec(m.string)
      if (!hit || hit[2] !== r.from) continue
      const string = m.string.slice(0, hit.index + hit[1].length) + r.zh
      if (stat.matchers.some(x => x.string === string)) continue
      const { superseded, ...rest } = m
      adds.push({ lang: 'cmn-Hant', ref: stat.ref, matcher: { ...rest, string }, supersedes: [m.string] })
    }
  }
  // 腐敗之種洗出的天賦(規則 18 的列:「1 Added Passive Skill is X」、只有 enchant id;GitHub issue #39)帶入的也是新名。
  // 這個物品 3.30 才有,舊名從沒出現過 → 直接換掉舊句(drops),不留 superseded:3.30 有互換 / 連鎖改名
  // (靈魂虛空 ↔ 精華抽取、怠工者 → 破壞者 → 摧毀者),留著會把新名配到另一個天賦。
  const GROWN_ZH = '附加的天賦為'
  const taken = new Set()
  /** @type {{ stat: any, m: any, r: any, string: string }[]} */
  let swaps = []
  for (const stat of eachStat(zhStats)) {
    for (const m of stat.matchers) taken.add(m.string)
    const r = stat.trade?.ids?.explicit ? undefined : byEn.get(/^1 Added Passive Skill is (.+)$/.exec(stat.ref)?.[1])
    for (const m of r ? stat.matchers : []) if (m.string.endsWith(GROWN_ZH + r.from)) swaps.push({ stat, m, r, string: m.string.slice(0, -r.from.length) + r.zh })
  }
  // 一個字串只能指向一列:新名不能是留下來的句子(同一輪被換掉的不算),也不能有兩列換成同一句;拒收一列可能連帶讓別列撞名 → 反覆到不變
  const all = swaps
  for (;;) {
    const gone = new Set(swaps.map(s => s.m.string))
    const dup = new Map()
    for (const s of swaps) dup.set(s.string, (dup.get(s.string) ?? 0) + 1)
    const ok = swaps.filter(s => dup.get(s.string) === 1 && (!taken.has(s.string) || gone.has(s.string)))
    if (ok.length === swaps.length) break
    swaps = ok
  }
  for (const s of all) {
    if (!swaps.includes(s)) rejects.push({ reason: '新名寫法已是另一條詞綴的句子', en: s.r.en, to: s.string })
    else adds.push({ lang: 'cmn-Hant', ref: s.stat.ref, matcher: { ...s.m, string: s.string }, drops: [s.m.string] })
  }
  return { adds, rejects }
}

/**
 * 規則 26:禁忌烈焰 / 禁忌血肉的新天賦(交易站「Allocates X if you have the matching modifier on Forbidden Flame|Flesh」有、
 * 資料沒有;3.30 Instruments of Justice,GitHub issue #32)。繁中句型取資料裡同一種禁忌珠寶既有寫法的「…配置 」前段,
 * 名字取 GGPK `passiveskills` 英文名唯一對到的繁中名;對不上的不猜。
 * @returns {{ newStats: any[], rejects: any[] }}
 */
const FORBIDDEN_RE = /^Allocates (.+) if you have the matching modifier on Forbidden (Flame|Flesh)$/
export function planForbiddenNotables ({ enStats, zhStats, tradeStats, passives }) {
  const used = new Set()
  for (const stat of eachStat(enStats)) for (const id of allIds(stat)) used.add(id)
  const prefix = new Map()
  for (const stat of eachStat(zhStats)) {
    const which = FORBIDDEN_RE.exec(stat.ref)?.[2]
    const head = which && stat.matchers.map(m => /^(.*配置 ).+$/.exec(m.string)?.[1]).find(Boolean)
    if (head && !prefix.has(which)) prefix.set(which, head)
  }
  const zhOf = new Map()
  for (const p of passives) zhOf.set(p.en, zhOf.has(p.en) && zhOf.get(p.en) !== p.zh ? null : p.zh)
  const newStats = []
  const rejects = []
  for (const e of tradeStats) {
    const hit = FORBIDDEN_RE.exec(e.text)
    if (!hit || used.has(e.id)) continue
    const zh = zhOf.get(hit[1])
    const head = prefix.get(hit[2])
    if (!zh || !head) { rejects.push({ reason: zh === null ? '天賦英文名對到兩個繁中名' : '找不到繁中天賦名或句型', id: e.id, to: e.text }); continue }
    newStats.push({ ref: e.text, better: 0, en: [{ string: e.text }], zh: [{ string: head + zh }], ids: { explicit: [e.id] } })
  }
  return { newStats, rejects }
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
  const byTypeText = groupBy(tradeStats, e => `${typeOf(e.id)}\n${cmpKey(e.text)}`)
  /** @type {Record<string, string>} */
  const replace = {}
  const remove = new Set()
  const rejects = []
  for (const stat of eachStat(enStats)) {
    const texts = new Set([cmpKey(stat.ref), ...matcherKeys(stat)])
    for (const id of allIds(stat)) {
      if (live(id) || id in replace || remove.has(id)) continue
      const type = typeOf(id)
      const cands = uniq([...texts].flatMap(t => byTypeText.get(`${type}\n${t}`) ?? []).map(e => e.id))
      if (cands.length === 1) replace[id] = cands[0]
      else {
        remove.add(id)
        if (cands.length > 1) rejects.push({ id, ref: stat.ref, reason: 'ambiguous', candidates: cands })
      }
    }
  }
  return { replace, remove: [...remove], rejects }
}

/** GGPK stat 鍵(`ids|cond|src_file|dup`)是不是地圖 / 輿圖詞綴:stat id 全部 `map_` 開頭,或出自地圖 / 輿圖描述檔 */
export const AREA_STAT_FILES = ['map_stat_descriptions.txt', 'atlas_stat_descriptions.txt', 'atlas_variant_stat_descriptions.txt', 'mirage_stat_descriptions.txt']
export function isAreaStatKey (key) {
  const parts = key.split('|')
  return parts[0].split(' ').every(id => id.startsWith('map_')) || parts.some(p => AREA_STAT_FILES.includes(p))
}

/** 不當成詞綴新增的句子:地圖的「怪物等級:83」是屬性行,收進來英文客戶端會多一條固定詞綴(繁中是全形冒號、對不上),兩語查詢不一致 */
const NEW_STAT_SKIP = new Set(['monster level: #'].map(t => cmpKey(t)))

/**
 * 規則 4:GGPK 新版新增、交易站有同文字 id、專案沒有 → 新增一列。
 * @returns {{ ref: string, better: number, en: any[], zh: any[], ids: Record<string, string[]> }[]}
 */
export function planNewStats ({ enStats, zhStats = /** @type {any[]} */ ([]), ggpkOld, ggpkNew, tradeStats }) {
  const oldKeys = new Set(ggpkOld.map(r => r.key))
  // 繁中新句與既有 matcher 同形(shape)→ 不加
  const zhShapes = new Set([...eachStat(zhStats)].flatMap(s => s.matchers.map(m => shape(m.string))))
  const enShapes = new Set([...eachStat(enStats)].flatMap(s => s.matchers.map(m => shape(m.string))))
  const tradeByText = groupBy(tradeStats.filter(e => !e.id.startsWith('pseudo.')), e => cmpKey(noLocal(e.text)))
  // 同一句話在一般描述檔也有(例:輿圖天賦與裝備都有「召喚物有 #% 機率造成雙倍傷害」)→ 交易站的 id 可能是裝備那條,不算地圖詞綴
  const generalTexts = new Set(ggpkNew.filter(r => !isAreaStatKey(r.key)).map(r => cmpKey(r.en)))
  const known = new Set()
  const usedIds = new Set()
  for (const stat of eachStat(enStats)) {
    known.add(cmpKey(stat.ref))
    for (const k of matcherKeys(stat)) known.add(k)
    for (const id of allIds(stat)) usedIds.add(id)
  }
  const out = new Map()
  const byZh = new Map()
  for (const row of ggpkNew) {
    const k = cmpKey(row.en)
    if (known.has(k) || !/[a-z]/.test(k) || NEW_STAT_SKIP.has(k)) continue
    const entries = (tradeByText.get(k) ?? []).filter(e => !usedIds.has(e.id))
    if (!entries.length) continue
    // 舊版就有的 stat:只收交易站只列為固定詞綴的(3.30 臟器的詞綴多半是舊 stat、這季才給 implicit id);
    // 其餘類型的舊缺口數量大、沒有樣本,不自動加
    // 例外:地圖 / 輿圖詞綴(使用者 2026-11-15 要求;3.30 地圖改版後稀有地圖上會出現)
    // 例外 2(2026-11-15,GitHub issue #16 鈷藍珠寶「增加 #% 殘酷的效果」):主描述檔 stat_descriptions.txt 的句子,
    // 交易站列為隨機 / 固定 / 破裂 / 工藝詞綴(= 會出現在物品上、可以查)也收
    const itemMod = row.key.split('|').includes('stat_descriptions.txt') && entries.some(e => /^(explicit|implicit|fractured|crafted)\.stat_/.test(e.id))
    if (oldKeys.has(row.key) && !entries.every(e => e.id.startsWith('implicit.')) && !(isAreaStatKey(row.key) && !generalTexts.has(k)) && !itemMod) continue
    if (row.zh && zhShapes.has(shape(toMatcherText(row.zh)))) continue
    if (enShapes.has(shape(toMatcherText(row.en)))) continue
    const zh = row.zh && cmpKey(row.zh) !== k ? toMatcherText(row.zh) : null
    if (!out.has(k)) {
      /** @type {Record<string, string[]>} */
      const ids = {}
      for (const e of entries) (ids[typeOf(e.id)] ??= []).push(e.id)
      // 繁中與另一條新詞綴是同一句(督軍印記:交易站有 Warlords's / Warlord's 兩種拼法、兩個 id)→ 併進那一列:
      // 繁中 matcher 一個字串只能指向一列,分成兩列的話繁中客戶端永遠只配到其中一個 id
      const twin = zh ? byZh.get(zh) : undefined
      if (twin) {
        twin.en.push({ string: toMatcherText(row.en) })
        for (const [type, list] of Object.entries(ids)) for (const id of list) if (!(twin.ids[type] ??= []).includes(id)) twin.ids[type].push(id)
        out.set(k, twin)
        continue
      }
      const ref = entries[0].text.replace(/\s+\(Local\)$/i, '')
      out.set(k, { ref, better: betterOf(ref), en: [{ string: toMatcherText(row.en) }], zh: [], ids })
      if (zh) byZh.set(zh, out.get(k))
    }
    if (zh && !out.get(k).zh.some(m => m.string === zh)) out.get(k).zh.push({ string: zh })
  }
  return uniq(out.values())
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
  const done = new Set()
  for (const e of tradeItems) {
    // 新名稱的每種底材各一列(解析器以底材比對,漏一種那種底材就 item.unknown)
    if (!e.flags?.unique || !e.name || have.has(e.name) || done.has(`${e.name}|${e.type}`)) continue
    done.add(`${e.name}|${e.type}`)
    const zh = uniq((zhOf.get(e.name) ?? []).map(w => w.zh))
    if (!bases.has(e.type)) rejects.push({ reason: '底材不在資料裡', id: e.name, to: e.type })
    else if (zh.length !== 1) rejects.push({ reason: 'GGPK 沒有唯一的繁中名', id: e.name, candidates: zh })
    else adds.push({ refName: e.name, zh: zh[0], base: e.type })
  }
  return { adds, rejects }
}

/** 交易站 items 群組 → 新底材那一列要帶的 craftable 類別(null = 不帶);沒列的群組不自動加(拒收) */
export const TRADE_BASE_GROUPS = { jewel: 'Jewel', viscera: null, enshrouded: null }
/** 整組都收的群組:不限 GGPK 這一版才新增(壟罩物品在上一個快照就有,但資料一直沒收;GitHub issue #41) */
const TRADE_WHOLE_GROUPS = new Set(['enshrouded'])

/**
 * 規則 7:GGPK 新版新增、且交易站 items 清單列為底材的物品(3.30:臟器、菌潮核心)。
 * 要先於規則 6 跑(新傳奇的底材可能是這裡加的)。
 * @returns {{ adds: any[], rejects: any[] }}
 */
export function planTradeBases ({ enItems, baseOld, baseNew, tradeItems }) {
  const have = new Set(enItems.map(i => i.refName))
  const oldPaths = new Set(baseOld.map(r => r.path))
  const fresh = groupBy(baseNew.filter(r => !oldPaths.has(r.path)), r => r.en)
  const whole = groupBy(baseNew, r => r.en)
  const adds = []
  const rejects = []
  for (const e of tradeItems) {
    const pool = TRADE_WHOLE_GROUPS.has(e.group) ? whole : fresh
    if (e.flags?.unique || have.has(e.type) || !pool.has(e.type)) continue
    have.add(e.type)
    const zh = uniq(pool.get(e.type).map(r => r.zh))
    if (!(e.group in TRADE_BASE_GROUPS)) rejects.push({ reason: '這個交易站群組沒有新增規則', id: e.type, to: e.group })
    else if (zh.length !== 1) rejects.push({ reason: 'GGPK 沒有唯一的繁中名', id: e.type, candidates: zh })
    else adds.push({ refName: e.type, zh: zh[0], category: TRADE_BASE_GROUPS[e.group] })
  }
  return { adds, rejects }
}

/**
 * 規則 23:新的傭兵流派(GitHub issue #26:3.30「淵井之軍」→ 解析器丟「Unknown Mercenary Build.」、整件解析失敗)。
 * 交易站 items 有 `disc: mercenary_warrant`、資料沒有這個 tradeType 的契約書類型,而 GGPK `mercenarybuilds` 有同 ident 的流派名
 * → 兩語各補一列流派(MERCENARY_BUILD)與一列契約書(ITEM,欄位照既有契約書列)。
 * 流派的技能清單(主要 / 次要 / 輔助)沒有資料來源 → 留空;篩選遇到清單外的技能用預設類型(mercenary.ts)。
 * 萬惡版(`…Noble`)要指到原版流派,原版還沒有就拒收。
 * @returns {{ adds: { refName: string, zh: string, tradeType: string }[], rejects: any[] }}
 */
export function planMercenaryBuilds ({ enItems, builds, tradeItems }) {
  const have = new Set(enItems.filter(i => i.refName === 'Mercenary Warrant').map(i => i.tradeType))
  const byIdent = new Map(builds.map(b => [b.ident, b]))
  const adds = []
  const rejects = []
  for (const e of tradeItems) {
    if (e.disc !== 'mercenary_warrant' || have.has(e.type)) continue
    const b = byIdent.get(e.type)
    // 萬惡版(…Noble)照既有資料的寫法指向原版流派(解析器依字串轉到原版);原版不在資料裡就拒收
    const baseType = e.type.endsWith('Noble') ? e.type.slice(0, -'Noble'.length) : undefined
    const base = baseType !== undefined ? byIdent.get(baseType) : undefined
    if (!b?.zh) rejects.push({ reason: 'GGPK 沒有這個流派', id: e.type, to: e.text })
    else if (baseType !== undefined && !(have.has(baseType) && base)) rejects.push({ reason: '萬惡版流派(原版不在資料裡)', id: e.type, to: e.text })
    else {
      have.add(e.type)
      adds.push({ refName: b.en, zh: b.zh, tradeType: e.type, ...(base ? { base: base.en } : {}) })
    }
  }
  return { adds, rejects }
}

/**
 * 規則 24:交易站傭兵群組(`mercenary.skill_*`)有、資料沒有的傭兵技能(使用者 2026-11-18 貼的淵井之軍契約書:
 * 3.30 的深淵噴濺、深淵噴濺．引爆、淵底之力…資料沒有 → 解析器整段丟掉,查價少了這些技能)。
 * 資料已有同名技能(ref = 交易站文字)→ 把 id 掛上去;全新的照 GGPK `mercenaryskills` 的繁中名新增一列(帶 `mercenary: {}`,
 * 可用輔助清單沒有資料來源 → 不給,篩選不會有 6 連結那組);名稱不唯一或 GGPK 沒有的拒收。輔助(`mercenary.support_*`)不處理。
 * @returns {{ newStats: any[], extra: Record<string, Record<string, string[]>>, rejects: any[] }}
 */
export function planMercenarySkills ({ enStats, tradeStats, skills }) {
  const used = usedIds(enStats)
  const refs = new Set([...eachStat(enStats)].map(s => s.ref))
  const zhOf = groupBy(skills, s => s.en)
  /** @type {Record<string, Record<string, string[]>>} */
  const extra = {}
  const fresh = new Map()
  const rejects = []
  for (const e of tradeStats) {
    if (!e.id.startsWith('mercenary.skill_') || used.has(e.id)) continue
    used.add(e.id)
    if (refs.has(e.text)) { ((extra[e.text] ??= {}).pseudo ??= []).push(e.id); continue }
    if (fresh.has(e.text)) { fresh.get(e.text).ids.pseudo.push(e.id); continue }
    const zh = uniq((zhOf.get(e.text) ?? []).map(s => s.zh))
    if (zh.length !== 1) { rejects.push({ reason: 'GGPK 傭兵技能表沒有唯一的繁中名', id: e.id, to: e.text, candidates: zh }); continue }
    fresh.set(e.text, { ref: e.text, better: 0, en: [{ string: e.text }], zh: [{ string: zh[0] }], ids: { pseudo: [e.id] }, mercenary: {} })
  }
  return { newStats: [...fresh.values()], extra, rejects }
}

/** 新的一般技能寶石的等級上限(人工確認;GitHub issue #19「連結：秘能」查價整件認不出來)@type {Record<string, number>} */
export const NEW_GEM_MAX_LEVEL = { 'Arcane Link': 20 }

/**
 * 規則 9:交易站 gem 群組新上架的變異寶石(帶 `disc`;瓦爾版「Vaal X (…)」不算)。
 * 繁中名取 GGPK gemeffects,等級上限與圖示照原版寶石那一列。
 * @param {{ enItems: any[], tradeItems: any[], gems: any[], skills?: any[] }} input
 * @returns {{ adds: any[], rejects: any[] }}
 */
export function planGems ({ enItems, tradeItems, gems, skills = [] }) {
  const byRef = new Map(enItems.filter(i => i.namespace === 'GEM').map(i => [i.refName, i]))
  const zhOf = groupBy(gems, g => g.en)
  const skillZh = groupBy(skills, g => g.en)
  const adds = []
  const rejects = []
  const seenNew = new Set() // 不放進 byRef:否則排在後面的變異版會把這筆交易站項目當成「原版那一列」
  for (const e of tradeItems) {
    // 新的一般技能寶石(沒有 disc):等級上限資料來源沒有,只收 NEW_GEM_MAX_LEVEL 列出的;繁中名取 GGPK activeskills
    if (e.group === 'gem' && !e.disc && !e.text && e.type && !e.type.startsWith('Vaal ') && !byRef.has(e.type)) {
      if (seenNew.has(e.type)) continue
      seenNew.add(e.type)
      const zh = uniq((skillZh.get(e.type) ?? []).map(g => g.zh))
      if (!(e.type in NEW_GEM_MAX_LEVEL)) rejects.push({ reason: '新的一般寶石:等級上限未確認(補進 NEW_GEM_MAX_LEVEL)', id: e.type })
      else if (zh.length !== 1) rejects.push({ reason: 'GGPK 沒有唯一的繁中名', id: e.type, candidates: zh })
      else adds.push({ refName: e.type, zh: zh[0], maxLevel: NEW_GEM_MAX_LEVEL[e.type] })
      continue
    }
    if (e.group !== 'gem' || !e.disc || !e.text || e.text.startsWith('Vaal ') || byRef.has(e.text)) continue
    byRef.set(e.text, e)
    const normal = byRef.get(e.type)
    const zh = uniq((zhOf.get(e.text) ?? []).map(g => g.zh))
    if (!normal) rejects.push({ reason: '原版寶石不在資料裡', id: e.text, to: e.type })
    else if (zh.length !== 1) rejects.push({ reason: 'GGPK 沒有唯一的繁中名', id: e.text, candidates: zh })
    else adds.push({ refName: e.text, zh: zh[0], disc: e.disc, normal: e.type, maxLevel: normal.gem?.maxLevel, icon: normal.icon })
  }
  return { adds, rejects }
}

/**
 * 規則 10:「X 的最大數量加倍 / 無法擁有 X 以外的召喚物」3.30 改成帶入名稱的句型,
 * 進階複製的範圍由「（幻化武器-神聖軍備）」變成「(...)」。同一句只多一個進階寫法,舊的標 superseded。
 * 繁中寫法來自實機樣本(黑暗君主);英文沒有樣本,照舊寫法的空白推出。
 * @returns {{ adds: any[] }}
 */
export function planMinionDoubled ({ enStats, zhStats, ggpkNew }) {
  const tpl = ggpkNew.find(r => r.key.startsWith('maximum_number_of_X_minion_type_doubled|') && r.en.includes('{0}'))
  const adds = []
  if (!tpl) return { adds }
  const plan = (stats, lang, text, mark) => {
    const [head, ...rest] = toMatcherText(text).split('#')
    for (const stat of eachStat(stats)) {
      for (const m of stat.matchers) {
        if (!m.advanced || m.superseded || !m.string.startsWith(head)) continue
        const name = m.string.slice(head.length).split(rest[0])[0]
        const advanced = toMatcherText(text).replaceAll('#', name + mark)
        if (m.string !== toMatcherText(text).replaceAll('#', name) || stat.matchers.some(x => x.advanced === advanced)) continue
        adds.push({ lang, ref: stat.ref, matcher: { string: m.string, advanced }, supersedes: [m.string] })
      }
    }
  }
  plan(enStats, 'en', tpl.en, ' (...)')
  plan(zhStats, 'cmn-Hant', tpl.zh, '(...)')
  return { adds }
}

/**
 * 「全部 X 寶石等級 #」(ref 結尾 `(Random Skill Gem)`)3.30 進階複製的範圍由「(火球-魔能長杖)」變成「(...)」
 * (GitHub issue #18 贗品．龍牙翱翔)。同一句只多一個進階寫法,舊的標 superseded;英文沒有樣本,照舊寫法推出。
 * @returns {{ adds: any[] }}
 */
export function planRandomSkillGem ({ enStats, zhStats }) {
  const adds = []
  for (const [lang, stats] of [['en', enStats], ['cmn-Hant', zhStats]]) {
    for (const stat of eachStat(stats)) {
      // 「插槽中的寶石被等級 # 的 X 輔助」(Random Support Gem):禁忌軍帽 3.30 仍是短名,進階複製的範圍
      // 「(高階多重投射-聖徒)」變成「(...)」(GitHub issue #43 #44)。短名句已被全名句取代 → 新的進階寫法也標 superseded;英文照舊寫法推出
      if (stat.ref.endsWith('(Random Support Gem)')) {
        for (const m of stat.matchers) {
          const advanced = m.advanced?.replace(/\([^()]*-[^()]*\)(?= 輔助$|$)/, '(...)')
          if (!advanced || advanced === m.advanced || stat.matchers.some(x => x.advanced === advanced)) continue
          adds.push({ lang, ref: stat.ref, matcher: { string: m.string, advanced, superseded: true } })
        }
        continue
      }
      if (!stat.ref.endsWith('(Random Skill Gem)')) continue
      for (const m of stat.matchers) {
        const advanced = m.advanced?.replace(/\([^()]*\)(?= 寶石等級| Gems)/, '(...)')
        if (!advanced || m.superseded || advanced === m.advanced || stat.matchers.some(x => x.advanced === advanced)) continue
        adds.push({ lang, ref: stat.ref, matcher: { string: m.string, advanced }, supersedes: [m.string] })
      }
    }
  }
  return { adds }
}

/**
 * 規則 19:「地圖含有 X 的壁壘」3.30 改成句型「Map contains {0}」:第二行(物品數量增加獎勵)拿掉,
 * 進階複製在名稱後加「(...)」(GitHub 回報 2026-11-16 的實機地圖:「地圖含有巴倫的壁壘(...) — 無法使用的值」)。
 * 多一個單行寫法 + 進階寫法,舊的兩行句標 superseded。英文名稱後沒有空白(2026-11-18 使用者回報的實機樣本)。
 * @returns {{ adds: any[] }}
 */
export function planCitadel ({ enStats, zhStats, ggpkNew }) {
  const tpl = ggpkNew.find(r => r.key.startsWith('map_contains_citadel|') && r.en.includes('{0}'))
  const adds = []
  if (!tpl) return { adds }
  const plan = (stats, lang, text, mark) => {
    const head = toMatcherText(text).split('#')[0]
    for (const stat of eachStat(stats)) {
      if (!/^Map contains .+ Citadel\n/.test(stat.ref)) continue
      for (const m of stat.matchers) {
        const string = m.string.split('\n')[0]
        if (m.superseded || !string.startsWith(head)) continue
        if (!m.string.includes('\n')) {
          // 2026-11-18 英文實機樣本名稱後沒有空白;之前推定的「Citadel (...)」補正,舊的標 superseded
          if (m.advanced && m.advanced !== string + mark && !stat.matchers.some(x => x.advanced === string + mark)) {
            adds.push({ lang, ref: stat.ref, matcher: { string, advanced: string + mark }, supersedes: [string] })
          }
          continue
        }
        if (stat.matchers.some(x => x.string === string)) continue
        adds.push({ lang, ref: stat.ref, matcher: { string, advanced: string + mark }, supersedes: [m.string] })
      }
    }
  }
  plan(enStats, 'en', tpl.en, '(...)')
  plan(zhStats, 'cmn-Hant', tpl.zh, '(...)')
  return { adds }
}

/**
 * 同一條詞綴在遊戲裡的另一種繁中寫法。寫入前仍要在 GGPK 新版找得到這句(英文相同),找不到就不加。
 * - 沒有 `current`:兩種寫法遊戲裡都有(另一句在別的描述檔)→ 新句標 superseded(正則頁不拿它當模板)。
 *   `# 點命中`:3.30 手套後綴「獅眼之」顯示「+587 點命中」(GitHub issue #9),資料只有「# 命中值」。
 * - `current: true`:專案原句在 GGPK 任何描述檔都找不到(APT 留下的舊句 / 錯字 / 沒翻)→ 新句是現行寫法,舊句標 superseded。
 *   同旗標的舊 matcher 不只一條時用 `old` 指名要標的那一句(祭祀神壇:另一句「你地圖中的…」是輿圖天賦的現行寫法)。
 *   單手近戰武器暴擊加成有實機樣本(2026-11-15 翠綠珠寶);其餘是同日 GGPK 3.30 比對補的(使用者裁定沒有實機樣本也補)。
 *   致盲 / 罪魂(2026-11-17 code review):新句才是物品上的寫法(GGPK 3.30 `stat_descriptions.txt`;致盲舊句只剩技能描述檔、
 *   罪魂舊句是輿圖天賦的),原本沒標 `current` → 標反,補上後由 `revive` 換回來。
 * 加新條目前先確認新句在 GGPK 屬於同一個 stat(同一句英文可能對到好幾個 stat,繁中各不相同)。
 */
export const EXTRA_ZH_MATCHERS = [
  { ref: '+# to Accuracy Rating', zh: '# 點命中' },
  { ref: '+#% to Critical Strike Multiplier with One Handed Melee Weapons', zh: '#% 單手近戰武器暴擊加成', current: true },
  { ref: '+#% to Critical Strike Multiplier with Axes', zh: '#% 斧暴擊加成', current: true },
  { ref: '+#% to Critical Strike Multiplier with Bows', zh: '#% 弓暴擊加成', current: true },
  { ref: '+#% to Critical Strike Multiplier with Claws', zh: '#% 爪暴擊加成', current: true },
  { ref: '+#% to Critical Strike Multiplier with Daggers', zh: '#% 匕首暴擊加成', current: true },
  { ref: '+#% to Critical Strike Multiplier with Maces or Sceptres', zh: '#% 錘和權杖暴擊加成', current: true },
  { ref: '+#% to Critical Strike Multiplier with Staves', zh: '#% 長杖暴擊加成', current: true },
  { ref: '+#% to Critical Strike Multiplier with Swords', zh: '#% 劍暴擊加成', current: true },
  { ref: '+#% to Critical Strike Multiplier with Wands', zh: '#% 法杖暴擊加成', current: true },
  { ref: '#% chance to Trigger Explosive Toad when you kill an Enemy', zh: '當你擊殺一名敵人時有 #% 機率觸發爆炸蟾蜍', current: true },
  { ref: '#% chance to Trigger Level 20 Shade Form when you Use a Socketed Skill', zh: '當你使用插槽中的技能時，有 #% 機率觸發等級 20 的暗影姿態', current: true },
  { ref: '+#% chance to Suppress Spell Damage per Power Charge', zh: '每顆暴擊球 #% 壓抑法術傷害率', current: true },
  { ref: 'Monsters cannot steal or remove your Power, Frenzy or Endurance charges on Hit', zh: '怪物擊中時無法偷取或移除你的暴擊、狂怒、或耐力球', current: true },
  { ref: 'You can have an additional Tincture active', zh: '你可以啟用額外一個萃取物', current: true },
  { ref: '#% chance to Blind Enemies on hit', zh: '擊中時有 #% 機率致盲敵人', current: true, old: '擊中時 #% 機率致盲敵人' },
  { ref: '#% increased chance of Ritual Altars with Special Rewards', zh: '增加 #% 祭祀神壇出現特殊獎勵的機率', current: true, old: '增加 #% 特殊獎勵出現於祭祀神壇的機率' },
  { ref: '#% increased chance of Ritual Altars with Special Rewards', zh: '減少 #% 祭祀神壇出現特殊獎勵的機率', negate: true, current: true, old: '減少 #% 特殊獎勵出現於祭祀神壇的機率' },
  { ref: 'Map Bosses have #% chance to be surrounded by Tormented Spirits', zh: '地圖頭目有 #% 機率受罪魂包圍', current: true, old: '地圖頭目有 #% 機率被罪魂圍繞' },
  // 希望之絃(GitHub issue #20):抗性是傳奇自己的合併 stat,繁中沒有空白、「全」不是「全部」(GGPK `{1:+d}%全元素抗性`)
  { ref: '+#% to all Elemental Resistances', zh: '#%全元素抗性', verified: 'GGPK unique_thread_of_hope_base_resist_all_elements_% + issue #20' },
  // 範圍名稱是 clientstrings JewelRadiusMassive「巨大」,專案原句「極大」對不到
  { ref: 'Only affects Passives in Massive Ring', zh: '只會影響巨大範圍內的天賦', advanced: '只會影響巨大範圍內的天賦', current: true, old: '只會影響極大範圍內的天賦', verified: 'GGPK clientstrings JewelRadiusMassive + issue #20' },
  // 進階複製的「巨大(...)」:大範圍有實機截圖(2026-11-18「只會影響大(...)範圍內的天賦」),巨大是同理推論;英文由規則 22 補了
  { ref: 'Only affects Passives in Massive Ring', zh: '只會影響巨大範圍內的天賦', advanced: '只會影響巨大(...)範圍內的天賦', verified: '2026-11-18 截圖「大(...)」同理' },
  // 傭兵輔助 3.30 改名(GGPK mercenarysupports;issue #21–23 只有階層 2 的實機樣本)
  { ref: 'Lesser Increased Area of Effect', zh: '低階增加範圍效果', advanced: '低階增加範圍效果(階層：1)', current: true, old: '低階增加效果範圍', verified: 'GGPK mercenarysupports' },
  { ref: 'Increased Area of Effect', zh: '增加範圍效果', advanced: '增加範圍效果(階層：2)', current: true, old: '增加效果範圍', verified: 'GGPK mercenarysupports + issue #21' },
  { ref: 'Greater Area of Effect', zh: '高階範圍效果', advanced: '高階範圍效果(階層：3)', current: true, old: '高階效果範圍', verified: 'GGPK mercenarysupports' },
  // GitHub issue #36 黑暗君主:句型帶入的是技能名「異蛛復甦」(GGPK activeskills raise_spiders),專案原本的「召喚蜘蛛」是增益名
  { ref: 'Maximum number of Raised Spiders is Doubled\nCannot have Minions other than Raised Spiders', zh: '異蛛復甦的最大數量加倍\n無法擁有異蛛復甦以外的召喚物', advanced: '異蛛復甦(...)的最大數量加倍\n無法擁有異蛛復甦(...)以外的召喚物', current: true, old: '召喚蜘蛛的最大數量加倍\n無法擁有召喚蜘蛛以外的召喚物', verified: 'GGPK activeskills raise_spiders + issue #36' },
  // GitHub issue #61:3.30 帶入的名稱取 GGPK miniondoublingstattypes,其他 15 種與專案相同,只有幻化武器 → 幻靈武器
  { ref: 'Maximum number of Animated Weapons is Doubled\nCannot have Minions other than Animated Weapons', zh: '幻靈武器的最大數量加倍\n無法擁有幻靈武器以外的召喚物', advanced: '幻靈武器(...)的最大數量加倍\n無法擁有幻靈武器(...)以外的召喚物', current: true, old: '幻化武器的最大數量加倍\n無法擁有幻化武器以外的召喚物', verified: 'GGPK miniondoublingstattypes + issue #61' },
]

/** 規則 11:`EXTRA_ZH_MATCHERS` → 繁中多一個 matcher @returns {{ adds: any[] }} */
export function planExtraZh ({ zhStats, ggpkNew }) {
  const inGgpk = new Set(ggpkNew.map(r => `${cmpKey(r.en)}|${toMatcherText(r.zh ?? '')}`))
  const adds = []
  for (const x of EXTRA_ZH_MATCHERS) {
    const have = [...eachStat(zhStats)].filter(s => s.ref === x.ref)
    // negate 的那一句在 GGPK 的英文是 reduced
    // verified:句子不在 stat 描述檔的同一個 stat 鍵底下(別張表 / 合併 stat),來源已人工查過 → 不做 GGPK 逐字檢查
    // 有 advanced 的條目連進階句一起比(同一句、不同進階寫法也要補)
    if (!have.length || have.every(s => s.matchers.some(m => m.string === x.zh && (x.advanced === undefined || m.advanced === x.advanced) && !(x.current && m.superseded))) || (!x.verified && !inGgpk.has(`${cmpKey(x.negate ? x.ref.replace('increased', 'reduced') : x.ref)}|${x.zh}`))) continue
    // superseded:解析器照樣比對,正則「物品詞綴數值」頁不拿它當模板(否則這條變成多種寫法而被排除)
    // supersedes:有 old 就標那一句;''(逐字對不到任何舊句)→ applyStatPlan 在同旗標的舊 matcher 恰好一條時標它
    adds.push(x.current
      ? { lang: 'cmn-Hant', ref: x.ref, matcher: { string: x.zh, ...(x.advanced ? { advanced: x.advanced } : {}), ...(x.negate ? { negate: true } : {}) }, supersedes: x.old ?? '', revive: true }
      : { lang: 'cmn-Hant', ref: x.ref, matcher: { string: x.zh, ...(x.advanced ? { advanced: x.advanced } : {}), ...(x.negate ? { negate: true } : {}), superseded: true } })
  }
  return { adds }
}

/** 物品上的詞綴句子所在的描述檔 */
export const ITEM_STAT_FILES = ['stat_descriptions.txt', 'map_stat_descriptions.txt']

/**
 * 規則 20(GGPK 全量自我檢查):資料裡會出現在物品上的詞綴(有隨機 / 固定 / 破裂 / 工藝 / 附魔 id),它現行的英文寫法在
 * GGPK 新版物品描述檔對到的繁中句子,繁中資料**任何一條詞綴都沒有**(= 繁中客戶端遇到會是未解析)→ 加上。
 * 同一句英文在 GGPK 可能對到好幾個 stat、繁中各不相同(不能被中毒 / 不會中毒),每一句都收。
 * 旗標(negate / value)照那個英文 matcher;一律標 superseded:原句仍是篩選列顯示的現行寫法、正則頁的模板不變。
 * 別條詞綴已經有的句子不管(解析得到,只是配到那一條);數字換成 # 後與既有寫法同形的拒收(會搶走既有詞綴的比對)。
 * 沒有實機樣本:句子由 GGPK 推出(使用者 2026-11-15 裁定沒有樣本也收)。
 * @returns {{ adds: any[], rejects: any[] }}
 */
export function planZhForms ({ enStats, zhStats, ggpkNew }) {
  const byEn = groupBy(ggpkNew.filter(r => r.zh && r.key.split('|').some(p => ITEM_STAT_FILES.includes(p))), r => exactKey(r.en))
  const zhByRef = statsByRef(zhStats)
  const zhTexts = new Set([...eachStat(zhStats)].flatMap(s => [...matcherExact(s)]))
  const zhShapes = new Set([...zhTexts].map(shape))
  const enRefs = refsByMatcher(enStats)
  const adds = []
  const rejects = []
  for (const stat of eachStat(enStats)) {
    if (!zhByRef.has(stat.ref) || !allIds(stat).some(id => TYPE_ID_GROUPS.includes(typeOf(id)) || id.startsWith('enchant.'))) continue
    for (const m of liveOf(stat)) {
      for (const r of byEn.get(m.string.trim()) ?? []) {
        const zh = exactKey(r.zh)
        if (cmpKey(zh) === cmpKey(r.en) || zhTexts.has(zh)) continue
        zhTexts.add(zh)
        const reject = (reason) => rejects.push({ reason, ref: stat.ref, lang: 'cmn-Hant', to: zh })
        // 同一句英文是好幾條詞綴的寫法(X 與 X (Local))→ 繁中該掛哪一條看不出來,掛錯會配到別條
        if ((enRefs.get(cmpKey(m.string))?.size ?? 0) > 1) { reject('英文寫法被多條詞綴共用'); continue }
        if (zhShapes.has(shape(zh))) { reject('與既有寫法同形'); continue }
        zhShapes.add(shape(zh)) // 同一輪後面的新句也不能與它同形
        adds.push({ lang: 'cmn-Hant', ref: stat.ref, matcher: { string: zh, ...flagsOf(m), superseded: true } })
      }
    }
  }
  return { adds, rejects }
}

/**
 * 沒有 # 的寫法代表的固定值:確切的數(`N`)或「至少 A」(`100|#` = 必定)。
 * `#|B`(任意負值都顯示同一句,例:劫盜寶箱「含有更有價值的傳奇物品」)沒有固定值,不取
 */
/** 數字換成 # 的句子(判斷兩句是不是只差數字) */
const digitless = (/** @type {string} */ t) => t.replace(/\d+(?:\.\d+)?/g, '#')

function condValue (token) {
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token)
  const m = /^([\d.]+)\|#$/.exec(token)
  return m ? Number(m[1]) : undefined
}

/**
 * 規則 21(GGPK 全量自我檢查):同一條詞綴在 GGPK 依數值有好幾種寫法(增加 / 減少、#% 機率 / 100% 時的「必定」、單複數、
 * 惡鬼轉世吞噬前後),資料只收了其中幾種 → 補上其他寫法(使用者 2026-11-17 回報的惡鬼轉世「可以吞噬 4 顆…/尚未吞噬任何寶石」)。
 * 同一組 = GGPK 鍵的 stat_ids + 描述檔相同;資料的現行寫法要逐字等於組裡某一句,才拿那一句當基準:
 * - 正負看 GGPK 的 handlers:兩句一句有 negate(遊戲取負號後顯示)、一句沒有 → negate 與基準 matcher 相反
 *   (不能看數值條件的正負:`{0:+d}` 的負值句沒有 negate,遊戲直接印負號,解析器會連負號一起讀;審查 2026-11-17)
 * - 新句沒有 #(單一 stat):數值條件的固定值換算到 ref 的方向後當 value,不帶 negate(解析器不對 value 套 negate)
 * - 兩個 stat 以上的組:新句用到的 stat 必須與基準相同,而且只看那些 stat 的 handlers
 * 新句一律標 superseded(篩選列與正則頁不變)、只補物品上會出現的詞綴;句子已屬於別條詞綴、與既有寫法同形的不補。
 * 沒有實機樣本(惡鬼轉世除外):句子與條件都取自 GGPK。
 * @returns {{ adds: any[], rejects: any[] }}
 */
export function planCondForms ({ enStats, zhStats, ggpkNew }) {
  const groups = groupBy(ggpkNew.filter(r => r.key.split('|').some(p => ITEM_STAT_FILES.includes(p))).map(r => {
    const parts = r.key.split('|')
    const file = parts.findIndex(p => p.endsWith('.txt'))
    return { ...r, ids: parts[0], conds: parts.slice(1, file).join('|').split(' '), group: `${parts[0]}|${parts[file]}` }
  }), r => r.group)
  // 連結標記 [TentacleSmash::{0}|Tentacle Whip] 裡的 {0} 不是數值,先換成顯示文字
  const used = (text) => new Set([...text.replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1').matchAll(/\{(\d*)(?::[^}]*)?\}/g)].map((m, i) => Number(m[1] === '' ? i : m[1])))
  const adds = []
  const rejects = []
  for (const [lang, stats] of /** @type {const} */ ([['en', enStats], ['cmn-Hant', zhStats]])) {
    const textOf = (r) => lang === 'en' ? r.en : r.zh
    const byText = new Map()
    for (const rows of groups.values()) for (const r of rows) if (textOf(r)) (byText.get(exactKey(textOf(r))) ?? byText.set(exactKey(textOf(r)), []).get(exactKey(textOf(r)))).push(r)
    const texts = new Set([...eachStat(stats)].flatMap(s => [...matcherExact(s)]))
    // 同形(只差數字)的既有寫法裡最多有幾個 #
    const hashCount = (t) => t.split('#').length - 1
    /** 同形寫法 → 擁有它的詞綴 ref → 其中最多的 # 數 */
    const shapes = new Map()
    const own = (sh, ref) => shapes.get(sh)?.get(ref) ?? -1
    const note = (t, ref) => { const m = shapes.get(shape(t)) ?? shapes.set(shape(t), new Map()).get(shape(t)); m.set(ref, Math.max(m.get(ref) ?? 0, hashCount(t))) }
    for (const s of eachStat(stats)) for (const t of matcherExact(s)) note(t, s.ref)
    const refs = refsByMatcher(stats)
    const idOf = statsByRef(enStats)
    for (const stat of eachStat(stats)) {
      const en = (idOf.get(stat.ref) ?? [])[0]
      if (!en || !allIds(en).some(id => TYPE_ID_GROUPS.includes(typeOf(id)) || id.startsWith('enchant.'))) continue
      for (const m of liveOf(stat)) {
        if ((refs.get(cmpKey(m.string))?.size ?? 0) > 1) continue // 同一句是好幾條詞綴的寫法,不知道新句該掛哪一條
        const bases = byText.get(m.string.trim()) ?? []
        // 同一句在 GGPK 屬於好幾組(通用的「全元素抗性」也是希望之絃專屬 stat 的一句)→ 不知道是哪一組,不拿來當基準
        if (new Set(bases.map(b => b.group)).size > 1) continue
        for (const base of bases) {
          for (const r of groups.get(base.group)) {
            if (!textOf(r)) continue
            const text = exactKey(textOf(r))
            if (texts.has(text) || cmpKey(text) === cmpKey(r.en) !== (lang === 'en')) continue
            texts.add(text)
            const reject = (reason) => rejects.push({ reason, ref: stat.ref, lang, to: text })
            const baseUsed = used(textOf(base))
            const newUsed = used(textOf(r))
            const single = !base.ids.includes(' ')
            if (!single && (m.value !== undefined || !newUsed.size || [...newUsed].join() !== [...baseUsed].join())) { reject('兩個 stat 以上、用到的數值不同'); continue }
            if (!base.handlers || !r.handlers) { reject('GGPK 沒有 handlers'); continue }
            // 那一句沒有這個數字時,上面的 negate 沒有東西可取負號(「Always Sap」[negate 1])→ 當成沒有
            const neg = (row, i) => used(textOf(row)).has(i) && row.handlers.some(h => h[0] === 'negate' && h[1] === i + 1)
            const at = single ? [0] : [...newUsed]
            // 條件只有負值、沒有 negate、數字也不是 {i:+d} → 照字面遊戲會印「少 -3 個」:這一列的 handlers 不可信(地雷 fewer)
            const odd = (row) => at.some(i => /^(#\|-|-)[\d.]+$/.test(row.conds[i] ?? '') && !neg(row, i) && !new RegExp(`\\{${i}:\\+d\\}`).test(textOf(row)) && used(textOf(row)).has(i))
            if (odd(base) || odd(r)) { reject('handlers 與數值條件矛盾'); continue }
            const diff = at.map(i => neg(base, i) !== neg(r, i))
            if (new Set(diff).size > 1) { reject('數值正負判斷不出來'); continue }
            // 兩句都看得出增加 / 減少時,方向不同才該相反(GGPK 有「增加 #% 效果。使用時 -1% 此數值」這種條件帶負號、字面仍是增加的)
            const da = direction(m.string); const db = direction(text)
            if (da && db && (da !== db) !== diff[0]) { reject('增加 / 減少與數值條件矛盾'); continue }
            // 交易站那條詞綴沒有數值(ref 不含 #)也補帶 # 的寫法:交易站照樣收數值(2026-11-20 實測巫會之后冠 implicit.stat_1916233589:不帶值 357 筆、min 13 → 169、min 500 → 0;上游資料也有 133 條這種詞綴)
            let value
            if (!newUsed.size) {
              // stat 值 → ref 方向:基準句顯示前取負號與基準 matcher 的 negate 各翻一次
              const toRef = neg(base, 0) !== Boolean(m.negate) ? -1 : 1
              value = condValue(r.conds[0])
              // 基準句也沒有數字(資料現行句本身寫死,低階異蛛復甦「觸發等級 20」)時,基準句的條件要也是固定值、且兩句去掉數字後逐字相同
              // (只差數字 = 同一句的不同數值;「區域含有阿爾瓦 / 埃哈」這種用數值選不同對象的不收)
              if (!value || (baseUsed.size === 0 && (!condValue(base.conds[0]) || digitless(text) !== digitless(exactKey(textOf(base)))))) { reject('沒有數字的寫法對不到固定值'); continue }
              // 除以十、毫秒轉秒等換算:條件是換算前的值,value 對不準
              if ([...base.handlers, ...r.handlers].some(h => h[0] !== 'negate')) { reject('數值有換算,固定值對不準'); continue }
              value *= toRef
            }
            // 既有同形寫法的 # 一樣多 → 多餘;既有的把數字寫死(繁中「區域含有 1 個保險箱」)而新句帶 # → 要補(否則英文解析得到、繁中解析不到)
            // 別條詞綴有同形寫法 → 分不出是哪一條,照舊拒收
            // 新句是寫死數字的固定值(帶 value、沒有 #)時,同形的既有寫法接不住它(數字逐字比),不算多餘
            const literal = value !== undefined && hashCount(text) === 0 && baseUsed.size === 0
            if ([...(shapes.get(shape(text))?.keys() ?? [])].some(ref => ref !== stat.ref) || (!literal && own(shape(text), stat.ref) >= hashCount(text))) { reject('與既有寫法同形'); continue }
            note(text, stat.ref)
            const negate = value === undefined && Boolean(m.negate) !== diff[0]
            adds.push({ lang, ref: stat.ref, matcher: { string: text, ...(negate ? { negate: true } : {}), ...(value !== undefined ? { value } : {}), superseded: true } })
          }
        }
      }
    }
  }
  return { adds, rejects }
}

/**
 * 規則 22:3.30 把寫死名稱的句子改成帶入名稱的句型(GitHub issue #28 玫瑰的傳承「賦予等級 20 塑界者的毀滅…」、
 * #29 優雅的高傲「授銜7260個硬幣以紀念卡斯皮羅(...)」)。GGPK 鍵的條件也跟著改了(`5 # 3 1|#` → `5 # # #`),改字規則對不上。
 * 新版句型(`{n}` 帶入)拿去比對舊版同一個 stat(stat_ids + 描述檔相同)的句子,把名稱抓回來填進新句型;
 * 舊句裡仍是 `{n}` 的位置當數字(#)。進階寫法:舊進階句裡名稱後面有「(甲-乙)」的,新的進階寫法改成「名稱(...)」。
 * - 資料的現行寫法逐字等於舊句 → 補新寫法,舊的標 superseded(#29)
 * - 資料只有帶 # 的新句型(交易站的 # 其實是 1/2/3 的編號,遊戲顯示名稱)→ 每個舊句補一個帶 value(舊句的條件值)的寫法,標 superseded(#28)
 * 新句已屬於別條詞綴的拒收。英文也照同樣方式推出(英文沒有樣本)。
 * @returns {{ adds: any[], rejects: any[] }}
 */
export function planNamedSlots ({ enStats, zhStats, ggpkOld, ggpkNew }) {
  const ADV = 'advanced_mod_stat_descriptions.txt'
  const split = (r) => {
    const p = r.key.split('|')
    const fi = p.findIndex(x => x.endsWith('.txt'))
    return { ...r, ids: p[0], cond: p.slice(1, fi).join('|'), file: p[fi] }
  }
  const olds = ggpkOld.map(split)
  const news = ggpkNew.map(split)
  const advOf = (rows) => new Map(rows.filter(r => r.file === ADV).map(r => [`${r.ids}|${r.cond}`, r]))
  const newAdv = advOf(news)
  const oldByGroup = groupBy(olds.filter(r => ITEM_STAT_FILES.includes(r.file)), r => `${r.ids}|${r.file}`)
  const unlink = (t) => t.replace(/\\n/g, '\n').replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1')
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const SLOT = /^\{(\d+)(?::[^}]*)?\}$/
  /** 句型 → 正則:{n} 變成擷取、空白可有可無 */
  const toRegex = (tpl, greedy = false) => {
    const slots = []
    const src = unlink(tpl).split(/(\{\d+(?::[^}]*)?\})/).map(part => {
      const m = SLOT.exec(part)
      if (m) { slots.push(Number(m[1])); return greedy ? '\\s*(.+)\\s*' : '\\s*(.+?)\\s*' }
      return esc(part).replace(/ +/g, '\\s*')
    }).join('')
    return { re: new RegExp(`^${src}$`, 's'), slots }
  }
  const fill = (tpl, vals) => unlink(tpl).replace(/\{(\d+)(?::[^}]*)?\}/g, (s, n) => vals[n] ?? s)
  const adds = []
  const rejects = []
  for (const [lang, stats] of /** @type {const} */ ([['en', enStats], ['cmn-Hant', zhStats]])) {
    const textOf = (r) => lang === 'en' ? r.en : r.zh
    const newTexts = new Set(news.map(r => textOf(r) && toMatcherText(textOf(r))).filter(Boolean))
    const texts = new Set([...eachStat(stats)].flatMap(s => [...matcherExact(s)]))
    const refs = refsByMatcher(stats)
    /** 舊句的現行寫法 / 新句型(# 版)→ [{ 新句, 新進階句, 舊條件 }] */
    const byOld = new Map()
    const byTemplate = new Map()
    for (const r2 of news) {
      if (!ITEM_STAT_FILES.includes(r2.file) || !textOf(r2) || !/\{\d/.test(textOf(r2))) continue
      const { re, slots } = toRegex(textOf(r2))
      const greedy = toRegex(textOf(r2), true).re
      const adv2 = newAdv.get(`${r2.ids}|${r2.cond}`) ?? r2
      for (const r1 of oldByGroup.get(`${r2.ids}|${r2.file}`) ?? []) {
        const t1 = textOf(r1)
        if (!t1 || newTexts.has(toMatcherText(t1))) continue // 舊句新版還在,不是這種改動
        const m = re.exec(unlink(t1))
        if (!m) continue
        // 兩個位置相鄰時切法不唯一(「level {2} {1}」配「level # #」)→ 非貪婪 / 貪婪切出來不同就不收
        const g = greedy.exec(unlink(t1))
        if (!g || g.slice(1).map(v => v.trim()).join('\u0000') !== m.slice(1).map(v => v.trim()).join('\u0000')) continue
        if (m.slice(1).some(v => !SLOT.test(v) && /[{}]/.test(v))) continue
        const names = {}
        // 舊句有時把進階的「(甲-乙)」也寫進一般句(卡葛爾:「梅德偉(沃拉娜-梅德偉)」)→ 去掉;
        // 抓到的是純數字(舊句寫死的等級)就不是名稱
        slots.forEach((n, i) => { if (!SLOT.test(m[i + 1]) && !/^-?[\d.]+$/.test(m[i + 1])) names[n] = m[i + 1].replace(/\([^()]*-[^()]*\)$/, '') })
        if (!Object.keys(names).length) continue
        // 3.30 進階複製在「會變的名稱」後面加「(...)」(卡斯皮羅、塑界者的毀滅、壁壘、召喚物、隨機寶石的實機樣本);
        // 條件是固定值的(永恆珠寶的陣營名)不加。天賦範圍名兩種都見過(issue #20「巨大」沒有、2026-11-18 截圖「大(...)」有)
        // → 照規則加;無括號的舊寫法標 superseded 仍會被解析,兩種都認得
        const conds = r2.cond.split(' ')
        const annotated = (n) => !/^-?\d+$/.test(conds[n] ?? '')
        const advNames = Object.fromEntries(Object.entries(names).map(([n, v]) => [n, annotated(n) ? `${v}(...)` : v]))
        const entry = { string: toMatcherText(fill(textOf(r2), names)), advanced: toMatcherText(fill(textOf(adv2) ?? textOf(r2), advNames)), cond: r1.cond }
        ;(byOld.get(toMatcherText(t1)) ?? byOld.set(toMatcherText(t1), []).get(toMatcherText(t1))).push(entry)
        ;(byTemplate.get(toMatcherText(textOf(r2))) ?? byTemplate.set(toMatcherText(textOf(r2)), []).get(toMatcherText(textOf(r2)))).push(entry)
      }
    }
    // 舊寫法有進階句時新寫法也帶(即使和一般句相同):PoE1 索引對有進階句的寫法只收進階那句
    const advOrNot = (e, m = {}) => e.advanced !== e.string || m.advanced !== undefined ? { advanced: e.advanced } : {}
    const done = new Set() // 同一句可能由好幾個舊列(不同條件)推出
    for (const stat of eachStat(stats)) {
      for (const m of liveOf(stat)) {
        for (const e of byOld.get(m.string.trim()) ?? []) {
          if (e.string === m.string && (e.advanced === (m.advanced ?? m.string))) continue
          const id = `${stat.ref}\n${e.string}\n${e.advanced}`
          if (done.has(id)) continue
          done.add(id)
          if (e.string !== m.string && [...(refs.get(cmpKey(e.string)) ?? [])].some(r => r !== stat.ref)) { rejects.push({ reason: '新句已屬於別條詞綴', ref: stat.ref, lang, to: e.string }); continue }
          adds.push({ lang, ref: stat.ref, matcher: { string: e.string, ...advOrNot(e, m), ...flagsOf(m) }, supersedes: [m.string] })
        }
        if (m.value !== undefined) continue
        for (const e of byTemplate.get(m.string.trim()) ?? []) {
          const value = /^-?\d+$/.test(e.cond) ? Number(e.cond) : undefined
          if (value === undefined || texts.has(e.string)) continue
          texts.add(e.string)
          adds.push({ lang, ref: stat.ref, matcher: { string: e.string, ...advOrNot(e), value, superseded: true } })
        }
      }
    }
  }
  return { adds, rejects }
}

/**
 * 規則 28:永恆珠寶 3.30 改成句型「{2}指揮領導超過{1}名戰士\n範圍內的天賦臣服於{0}」,{2} 是 GGPK `alternatetreeversionkeystones`
 * 的征服者名(3.30 也改了譯名:瑪薩里歐斯 → 馬克薩留斯)。規則 22 從舊句抓名稱,舊句與句型字不同(少「名」)或名稱改了就補不到
 * (GitHub issue #60 #64 #65)→ 名稱改由英文 ref 對征服者表;進階句在征服者名後加「(...)」(實機樣本)。
 * 陣營名取 GGPK `alternatetreeversions`(`factions`,鍵 = 句型條件的版本號;沒給時退回繁中現行句的第二行):
 * 3.30 深淵永恆珠寶是「深淵」,資料沿用的「深淵族」不是 GGPK 寫法(類型掃描 2026-11-24)。
 * 交易站每個征服者一個 id(`explicit.pseudo_timeless_jewel_*`):資料沒有那一列就新增(InternalVersion 0 的舊版征服者 Zerphi 等),
 * 有就補兩語缺的寫法。交易站的名字與遊戲顯示不同的列在 `CONQUEROR_RENAMES`。
 * @param {{ zhStats: any[], enStats?: any[], ggpkNew: any[], conquerors?: Array<{ en: string, zh: string }>, factions?: Record<string, { en: string, zh: string }>, tradeStats?: any[], renames?: Record<string, string> }} input
 * @returns {{ adds: any[], newStats: any[], rejects: any[] }}
 */
export function planTimelessJewels ({ zhStats, enStats = [], ggpkNew, conquerors = [], factions, tradeStats = [], renames = CONQUEROR_RENAMES }) {
  const zhOf = groupBy(conquerors, c => c.en)
  const lines = (t) => toMatcherText(t).split('\n')
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tpls = ggpkNew.filter(r => r.key.startsWith('local_unique_jewel_alternate_tree_version ') && r.key.includes('|stat_descriptions.txt|') && r.zh && r.en.includes('{2}'))
    .map(r => {
      const en = r.en.replace(/\\n/g, '\n')
      return { version: r.key.split('|')[1].split(' ')[0], en, re: new RegExp(`^${esc(en.split('\n')[0]).replace('\\{1\\}', '#').replace('\\{2\\}', '(.+)')}$`), zh: r.zh.replace(/\\n/g, '\n') }
    })
  const byRef = (/** @type {any[]} */ list) => new Map([...eachStat(list)].map(s => [s.ref, s]))
  const zhByRef = byRef(zhStats)
  const enByRef = byRef(enStats)
  const tradeOf = new Map(tradeStats.filter(e => e.id.startsWith('explicit.pseudo_timeless_jewel_')).map(e => [e.text, e.id]))
  const adds = []
  const newStats = []
  const rejects = []
  for (const ref of uniq([...zhByRef.keys(), ...tradeOf.keys()])) {
    const t = tpls.find(x => x.re.test(ref))
    if (!t) continue
    const name = /** @type {string} */ (t.re.exec(ref)?.[1])
    const shown = renames[name] ?? name
    const zhNames = uniq((zhOf.get(shown) ?? []).map(c => c.zh))
    const zhStat = zhByRef.get(ref)
    const [zh1, zh2] = t.zh.split('\n')
    const factionRe = new RegExp(`^${esc(zh2).replace('\\{0\\}', '(.+)')}$`)
    if (factions && !factions[t.version]) { rejects.push({ reason: `GGPK 缺陣營名(version ${t.version})`, ref, lang: 'cmn-Hant' }); continue }
    const faction = factions?.[t.version] ?? (zhStat && { zh: uniq(liveOf(zhStat).map(m => factionRe.exec(lines(m.string)[1] ?? '')?.[1]).filter(Boolean)).join('|'), en: undefined })
    if (zhNames.length !== 1 || !faction?.zh || faction.zh.includes('|')) { rejects.push({ reason: '征服者 / 陣營繁中名不唯一', ref, lang: 'cmn-Hant', candidates: [...zhNames, faction?.zh] }); continue }
    // 陣營表以列序當版本號:英文現行句第二行的陣營名要等於 GGPK 的,不等 = 列序對不上句型,整條不改
    const enLive = enByRef.get(ref) && liveOf(enByRef.get(ref)).map(m => toMatcherText(m.string).split('\n')[1]).filter(Boolean)
    if (faction.en && enLive?.length && !enLive.includes(toMatcherText(t.en.split('\n')[1].replace('{0}', faction.en)))) {
      rejects.push({ reason: `GGPK 陣營名 ${faction.en} 與英文現行句不同`, ref, lang: 'en', candidates: enLive }); continue
    }
    const fill = (/** @type {string} */ tpl, /** @type {string} */ n, /** @type {string} */ f) => toMatcherText(tpl.replace('{2}', n).replace('{0}', f))
    const zhMatcher = { string: fill(t.zh, zhNames[0], faction.zh), advanced: fill(t.zh, `${zhNames[0]}(...)`, faction.zh) }
    const enMatcher = faction.en && { string: fill(t.en, shown, faction.en), advanced: fill(t.en, `${shown}(...)`, faction.en) }
    if (!zhStat && !enByRef.has(ref)) {
      if (tradeOf.has(ref) && enMatcher) newStats.push({ ref, better: 0, en: [enMatcher], zh: [zhMatcher], ids: { explicit: [tradeOf.get(ref)] } })
      continue
    }
    for (const [lang, stat, matcher] of /** @type {const} */ ([['cmn-Hant', zhStat, zhMatcher], ['en', enByRef.get(ref), enMatcher]])) {
      if (!stat || !matcher || stat.matchers.some(m => m.string === matcher.string && m.advanced === matcher.advanced && !m.superseded)) continue
      adds.push({ lang, ref, matcher, supersedes: liveOf(stat).map(m => m.string) })
    }
  }
  return { adds, newStats, rejects }
}

/**
 * 交易站沿用舊名、遊戲顯示新名的征服者(交易站名 → 遊戲名)。
 * Ahuana → Mazcotl:GGPK 3.30 瓦爾征服者已沒有 Ahuana;2026-11-24 以 `explicit.pseudo_timeless_jewel_ahuana` 搜國際服 Standard,
 * 掛單的 explicitMods 印「…sacrificed in the name of Mazcotl」(使用者回報的繁中瑪茲科特爾輝煌的虛榮查不到)。
 */
export const CONQUEROR_RENAMES = { Ahuana: 'Mazcotl' }

/**
 * 規則 29:數值寫死的獨立 stat 與通用詞綴只差大小寫(Goredrill「50% chance to cause Bleeding on Critical Strike」=
 * `local_chance_to_bleed_on_crit_50%`,通用句是「#% chance to Cause …」;GitHub issue #58)→ 補一個帶 value 的寫法、標 superseded。
 * 只收數字恰好一個、對到的通用寫法恰好一條、且沒有 negate 的;繁中同形的寫法本來就由 # 接住,不必補。
 * @returns {{ adds: any[] }}
 */
export function planFixedCase ({ enStats, ggpkNew }) {
  const texts = new Set([...eachStat(enStats)].flatMap(s => [...matcherExact(s)]))
  const byShape = groupBy([...eachStat(enStats)].flatMap(s => liveOf(s).filter(m => m.value === undefined && !m.negate && m.string.includes('#')).map(m => ({ s, m }))), x => cmpKey(x.m.string))
  const adds = []
  for (const r of ggpkNew) {
    if (!r.key.split('|').some(p => ITEM_STAT_FILES.includes(p)) || /[{}[\]]/.test(r.en)) continue
    const en = toMatcherText(r.en)
    const nums = en.match(/\d+(?:\.\d+)?/g)
    if (nums?.length !== 1 || texts.has(en)) continue
    const hashed = en.replace(/\d+(?:\.\d+)?/, '#')
    const hits = byShape.get(cmpKey(hashed)) ?? []
    // 逐字相同(含正負號寫法)= 解析器本來就由 # 寫法接住,不是這種情況
    if (hits.length !== 1 || [hashed, toMatcherText(hashed)].includes(hits[0].m.string.trim())) continue
    // 只收「代回數字後只差大小寫」的:cmpKey 還會收斂空白、去掉 # 前的正負號,負數句會配到 +# 句而 value 少了負號
    if (hits[0].m.string.trim().replace('#', nums[0]).toLowerCase() !== en.toLowerCase()) continue
    texts.add(en)
    adds.push({ lang: 'en', ref: hits[0].s.ref, matcher: { string: en, value: Number(nums[0]), superseded: true } })
  }
  return { adds }
}

/**
 * 交易站的叫法 ≠ 遊戲內名稱、而且上游那一列是壞的(matcher 帶「Has Room: 」前綴、沒有 option → 遊戲文字永遠對不到):
 * ref → 遊戲內英文名(GGPK incursionrooms;2026-11-16 逐列比對 87 個房間只有這一列)
 */
export const ROOM_GAME_NAMES = { 'Has Room: Splinter Research Lab (Tier 1)': 'Anomaly Research Lab' }

/**
 * 規則 17:阿茲瓦特史記的房間(ref `Has Room: X (Tier N)`)繁中名與 GGPK `incursionrooms` 不同 → 加上 GGPK 的寫法、舊名標 superseded
 * (GitHub issue #14:遊戲顯示「保險箱之殿 (階級 1)」,資料是「寶箱之殿」)。GGPK 名稱不唯一就不動。
 * @param {{ zhStats: any[], enStats?: any[], rooms: any[], renames?: any[] }} input
 * @returns {{ adds: any[], option: string[] }}
 */
export function planRoomNames ({ zhStats, enStats = [], rooms, renames = [] }) {
  const zhOf = groupBy(rooms, r => r.en)
  const adds = []
  // 英文名也改了(3.30:阿茲里宴殿等三階 → 創造之搖籃 Cradle of Creation):ref 不動(語言無關鍵),兩語各加新名、舊名標 superseded
  const renameOf = groupBy(renames, r => r.from)
  // 房間目前的英文名:ref 停在舊名,改過名的要看英文現行 matcher(否則下一季再改名 / 只改繁中名都對不到)
  const liveEn = new Map([...eachStat(enStats)].map(s => [s.ref, s.matchers.find(x => !x.superseded)?.string.split(' (')[0]]))
  const nameOf = (ref) => { const m = /^Has Room: (.+) \(Tier \d+\)$/.exec(ref); return m ? (liveEn.get(ref) ?? m[1]) : null }
  // 名稱恰好一個才換:現行寫法的名稱換成它(「 (階級 N)」後綴照留),舊名標 superseded
  const rename = (lang, stat, names) => {
    if (names.length !== 1) return
    for (const old of liveOf(stat)) {
      const cut = old.string.indexOf(' (')
      const next = cut === -1 ? null : names[0] + old.string.slice(cut)
      if (next && next !== old.string && !stat.matchers.some(x => x.string === next)) adds.push({ lang, ref: stat.ref, matcher: { string: next }, supersedes: old.string })
    }
  }
  for (const [lang, stats] of [['cmn-Hant', zhStats], ['en', enStats]]) {
    // zh 可能是 null(GGPK 還沒翻譯的列)→ 不當成名稱,那個語言不動
    for (const stat of eachStat(stats)) rename(lang, stat, uniq((renameOf.get(nameOf(stat.ref)) ?? []).map(r => lang === 'en' ? r.en : r.zh).filter(Boolean)))
  }
  for (const stat of eachStat(zhStats)) rename('cmn-Hant', stat, uniq((zhOf.get(nameOf(stat.ref)) ?? []).map(r => r.zh)))
  // 壞掉的列(ROOM_GAME_NAMES):兩語補上遊戲內寫法,並標成選項型(開啟 / 受阻)
  const option = []
  for (const [ref, en] of Object.entries(ROOM_GAME_NAMES)) {
    const zh = uniq((zhOf.get(en) ?? []).map(r => r.zh))
    const tier = / \(Tier (\d+)\)$/.exec(ref)?.[1]
    if (zh.length !== 1 || !tier) continue
    for (const [lang, stats, text] of [['cmn-Hant', zhStats, `${zh[0]} (階級 ${tier})`], ['en', enStats, `${en} (Tier ${tier})`]]) {
      const stat = [...eachStat(stats)].find(s => s.ref === ref)
      if (!stat) continue
      if (!stat.matchers.some(x => x.string === text)) adds.push({ lang, ref, matcher: { string: text }, supersedes: stat.matchers.find(x => !x.superseded)?.string ?? '' })
      if (!stat.trade?.option && !option.includes(ref)) option.push(ref)
    }
  }
  return { adds, option }
}

/**
 * 規則 12:傳奇的繁中名改了(3.30「輪迴」→「馬拉凱的輪迴」,GitHub issue #8)。GGPK 新版對這個英文名只有一個繁中名、
 * 且和資料不同 → 改成新名(台服交易站用的也是新名;舊名的剪貼簿不再認得)。
 * @returns {{ refName: string, from: string, zh: string }[]}
 */
export function planUniqueZhNames ({ zhItems, words }) {
  const zhOf = groupBy(words, w => w.en)
  const out = []
  const seen = new Set()
  for (const item of zhItems) {
    if (item.namespace !== 'UNIQUE' || seen.has(item.refName)) continue
    seen.add(item.refName)
    const zh = uniq((zhOf.get(item.refName) ?? []).map(w => w.zh))
    const mine = new Set(zhItems.filter(i => i.namespace === 'UNIQUE' && i.refName === item.refName).map(i => i.name))
    if (zh.length === 1 && !mine.has(zh[0])) out.push({ refName: item.refName, from: item.name, zh: zh[0] })
  }
  return out
}

/** `rewriteLines` 的 edit 回傳這個值 = 刪掉這一列 */
const DROP_ROW = Symbol('drop')

/** 逐列改寫 ndjson:只重寫有變動的列,保留原行尾 */
function rewriteLines (fileText, edit, appended = []) {
  const eol = fileText.includes('\r\n') ? '\r\n' : '\n'
  const lines = fileText.split(eol)
  const tail = lines[lines.length - 1] === '' ? [lines.pop()] : []
  const out = lines.flatMap(line => {
    if (!line.trim()) return [line]
    const obj = JSON.parse(line)
    const r = edit(obj)
    return r === DROP_ROW ? [] : [r ? JSON.stringify(obj) : line]
  })
  return [...out, ...appended.map(o => JSON.stringify(o)), ...tail].join(eol)
}

/**
 * 套用詞綴計畫(adds / replace / remove / newStats)到一份 stats.ndjson 文字
 * @param {string} fileText
 * @param {'en' | 'cmn-Hant'} lang
 * @param {{ adds?: any[], replace?: Record<string, string>, remove?: string[], newStats?: any[], better?: Record<string, number>, fill?: Record<string, Record<string, string[]>>, extra?: Record<string, Record<string, string[]>>, option?: string[], merge?: Array<{ from: string, into: string }> }} [plan]
 */
export function applyStatPlan (fileText, lang, { adds = [], replace = {}, remove = [], newStats = [], better = {}, fill = {}, extra = {}, option = [], merge = [] } = {}) {
  const merged = applyStatPlanNoMerge(fileText, lang, { adds, replace, remove, newStats, better, fill, extra, option })
  if (!merge.length) return merged
  // 併列(規則 30):from 那一列整列刪掉,它的寫法以 superseded、交易站 id 原樣搬進 into(兩種寫法都還解析得到,索引改指 into;
  // 同一輪其他規則掛到 from 的 id 也一起搬,不會跟著被刪)
  const intoOf = new Map(merge.map(m => [m.from, m.into]))
  /** @type {Map<string, any[]>} */
  const moved = new Map()
  for (const line of merged.split(/\r?\n/)) {
    const row = line.trim() && JSON.parse(line)
    const ref = row && wholeRefOf(row)
    if (ref && intoOf.has(ref)) (moved.get(intoOf.get(ref)) ?? moved.set(intoOf.get(ref), []).get(intoOf.get(ref))).push(...(row.stats ?? [row]))
  }
  const same = (/** @type {any} */ x, /** @type {any} */ m) => x.string === m.string && x.advanced === m.advanced && Boolean(x.negate) === Boolean(m.negate) && x.value === m.value
  return rewriteLines(merged, (row) => {
    const whole = wholeRefOf(row)
    if (whole && intoOf.has(whole)) return DROP_ROW
    let changed = false
    for (const stat of row.stats ?? [row]) {
      for (const from of moved.get(stat.ref) ?? []) {
        for (const m of from.matchers) {
          if (stat.matchers.some(x => same(x, m))) continue
          stat.matchers.push({ ...m, superseded: true })
          changed = true
        }
        for (const [type, ids] of Object.entries(from.trade?.ids ?? {})) {
          for (const id of ids) {
            if ((stat.trade.ids[type] ??= []).includes(id)) continue
            stat.trade.ids[type].push(id)
            changed = true
          }
        }
      }
    }
    return changed
  })
}

/**
 * 規則 30:同一句的兩列(英文現行寫法相同,一列的交易站 id 是另一列的子集)併成 id 多的那列。
 * 3.30 前的固定輔助列(只有 `indexable_support_N`、繁中是舊譯)和隨機輔助列(`indexable_support_N` + 固定輔助的 `effect_*`)
 * 英文同句:索引讓檔案裡先出現的那列勝出 → 英文解析成固定列、繁中(只有隨機列有 3.30 寫法)解析成隨機列,中英不一致,
 * 英文也少送固定輔助的 id(類型掃描 2026-11-24;使用者裁定兩個 id 都送)。兩語都要有兩列;
 * better / trade.option 不同、ref 出現不只一列、連鎖(into 本身也要併走)的不併。
 * 「一列」也可以是同一 ref 重複的群組(上游的 trivial-merge,Fire Penetration 等 4 組);另外 into 的 ref 剛好是 from 加
 * ` (Random Support Gem)` 的配對即使 id 不是子集也併(固定列用舊的固定輔助 id,Flamewood 等 5 組)—— 併列後 id 取聯集
 * (`applyStatPlan` 的 merge 會搬 id)。` (Random Skill Gem)` 不併:「全部 X 寶石等級」一般列與隨機列是不同的 id,
 * 帶 (...) 標記的是隨機列、不能送一般列的 id(marker-tolerance R2 的既有設計;使用者裁定「兩個 id 都送」只針對輔助寶石)。
 * @returns {{ merge: Array<{ from: string, into: string }> }}
 */
export function planMergeDuplicates ({ enStats, zhStats }) {
  /** 每個「單位」= 一列頂層 stat 或同一 ref 的群組;ref 在全檔只屬於這個單位才收 */
  const unitsOf = (/** @type {any[]} */ list) => {
    const refCount = groupBy(list.flatMap(r => r.stats ?? [r]), s => s.ref)
    return list.map(r => ({ ref: wholeRefOf(r), stats: r.stats ?? [r] }))
      .filter(u => u.ref && u.stats[0].matchers && refCount.get(u.ref).length === u.stats.length)
      .map(u => ({ ...u.stats[0], ref: /** @type {string} */ (u.ref), trade: { ...u.stats[0].trade, ids: mergeIds(u.stats) } }))
  }
  const top = unitsOf(enStats)
  const zhRefs = new Set(unitsOf(zhStats).map(u => u.ref))
  /** @type {Map<string, Set<any>>} */
  const byString = new Map()
  for (const s of top) for (const m of s.matchers) (byString.get(m.string) ?? byString.set(m.string, new Set()).get(m.string)).add(s)
  const merge = []
  for (const a of top) {
    const ia = allIds(a)
    const live = liveOf(a).map(m => m.string)
    if (!ia.length || !live.length || !zhRefs.has(a.ref)) continue
    const pair = (/** @type {any} */ b) => b.ref === `${a.ref} (Random Support Gem)`
    const into = [...new Set(live.flatMap(x => [...(byString.get(x) ?? [])]))].filter(b => b !== a && zhRefs.has(b.ref) &&
      b.better === a.better && Boolean(b.trade?.option) === Boolean(a.trade?.option) &&
      (pair(b) || (allIds(b).length > ia.length && ia.every(i => allIds(b).includes(i)))) && live.every(x => b.matchers.some(m => m.string === x)))
    if (into.length === 1) merge.push({ from: a.ref, into: into[0].ref })
  }
  const froms = new Set(merge.map(m => m.from))
  return { merge: merge.filter(m => !froms.has(m.into)) }
}

/** 頂層 stat 的 ref;群組裡全部同一個 ref(重複列)也算;其他群組 = null */
function wholeRefOf (/** @type {any} */ row) {
  if (!row.stats) return row.ref ?? null
  return row.stats.length && row.stats.every((/** @type {any} */ s) => s.ref === row.stats[0].ref) ? row.stats[0].ref : null
}

/** 幾個 stat 的交易站 id 依類型取聯集 */
function mergeIds (/** @type {any[]} */ stats) {
  /** @type {Record<string, string[]>} */
  const out = {}
  for (const s of stats) for (const [type, ids] of Object.entries(s.trade?.ids ?? {})) out[type] = uniq([...(out[type] ?? []), ...ids])
  return out
}

function applyStatPlanNoMerge (fileText, lang, { adds = [], replace = {}, remove = [], newStats = [], better = {}, fill = {}, extra = {}, option = [] } = {}) {
  const addsByRef = groupBy(adds.filter(a => a.lang === lang), a => a.ref)
  const gone = new Set(remove)
  const existingRefs = new Set()
  const editStat = (stat) => {
    let changed = false
    existingRefs.add(stat.ref)
    if (stat.ref in better && stat.better !== better[stat.ref]) {
      stat.better = better[stat.ref]
      changed = true
    }
    if (option.includes(stat.ref) && stat.trade && !stat.trade.option) {
      stat.trade.option = true
      changed = true
    }
    for (const a of addsByRef.get(stat.ref) ?? []) {
      const keys = matcherKeys(stat)
      // revive(只有 planExtraZh 給):新句已在資料裡但之前被標成 superseded(標反)→ 換回來,舊句標記
      const dead = a.revive ? stat.matchers.find(m => m.superseded && m.string === a.matcher.string) : undefined
      if (dead) {
        delete dead.superseded
        for (const m of stat.matchers) if (m !== dead && cmpKey(m.string) === cmpKey(a.supersedes)) m.superseded = true
        changed = true
        continue
      }
      // 已經有了沒 = 逐字比(解析器逐字比對,只差大小寫的新寫法也要加)
      if ((a.matcher.advanced ? stat.matchers.some(m => m.advanced === a.matcher.advanced) : matcherExact(stat).has(a.matcher.string.trim())) || (a.after !== undefined && !keys.has(cmpKey(a.after)))) continue
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
      if (a.drops) stat.matchers = stat.matchers.filter(m => !a.drops.includes(m.string)) // 規則 25:腐敗之種的列直接換掉舊句
      changed = true
    }
    // 繁中資料裡暫放的英文句(當時 GGPK 還沒有繁中):同列有了繁中現行寫法就標 superseded,
    // 否則正則「物品詞綴數值」頁把它當兩種寫法而排除(審查 2026-11-20)
    if (lang === 'cmn-Hant' && stat.matchers?.some(m => !m.superseded && /[一-鿿]/.test(m.string))) {
      for (const m of stat.matchers) {
        if (!m.superseded && /[A-Za-z]{3}/.test(m.string) && !/[^\x00-\x7f]/.test(m.string)) { m.superseded = true; changed = true }
      }
    }
    for (const [type, ids] of Object.entries(stat.trade?.ids ?? {})) {
      const next = uniq(ids.filter(id => !gone.has(id)).map(id => replace[id] ?? id))
      if (next.length === ids.length && next.every((id, i) => id === ids[i])) continue
      if (next.length) stat.trade.ids[type] = next
      else delete stat.trade.ids[type]
      changed = true
    }
    const attach = (byType, accept = (/** @type {string} */ _id) => true) => {
      for (const [type, ids] of Object.entries(byType)) {
        for (const id of ids) {
          if (!accept(id) || (stat.trade.ids[type] ??= []).includes(id)) continue
          stat.trade.ids[type].push(id)
          changed = true
        }
      }
    }
    if (fill[stat.ref] && stat.trade) {
      const hasIds = allIds(stat).length > 0 // 同 ref 有多份時各自判斷:已有 id 的只收 effect_ 新 id
      attach(fill[stat.ref], id => !hasIds || id.includes('.effect_'))
    }
    if (extra[stat.ref] && stat.trade) attach(extra[stat.ref])
    return changed
  }
  const text = rewriteLines(fileText, (row) => (row.stats ?? [row]).filter(s => s.matchers).map(editStat).some(Boolean))
  const fresh = newStats.filter(s => !existingRefs.has(s.ref)).map(s => ({
    ref: s.ref, better: s.better, ...(s.mercenary ? { mercenary: s.mercenary } : {}), matchers: lang === 'en' || !s.zh.length ? s.en : s.zh, trade: { ids: s.ids }
  }))
  return fresh.length ? rewriteLines(text, () => false, fresh) : text
}

/**
 * 套用物品計畫(renames / adds)到一份 items.ndjson 文字
 * @param {string} fileText
 * @param {'en' | 'cmn-Hant'} lang
 * @param {{ renames?: any[], adds?: any[], uniques?: any[], bases?: any[], gems?: any[], zhNames?: any[], builds?: any[] }} [plan]
 */
export function applyItemPlan (fileText, lang, { renames = [], adds = [], uniques = [], bases = [], gems = [], zhNames = [], builds = [] } = {}) {
  let warrant // 既有的契約書列,新流派的契約書照它抄欄位
  const warrantTypes = new Set()
  const zhName = new Map(lang === 'cmn-Hant' ? zhNames.map(z => [z.refName, z.zh]) : [])
  const byFrom = new Map(renames.map(r => [r.from, r]))
  const have = new Set()
  const gemIcon = new Map() // 圖示取同語系原版那一列(繁中檔用台服 CDN)
  const nameOf = (en, zh) => (lang === 'en' ? en : (zh ?? en))
  const text = rewriteLines(fileText, (item) => {
    const r = byFrom.get(item.refName)
    if (r) {
      item.name = nameOf(r.to, r.zh)
      item.refName = r.to
      item.tradeTag = r.tradeTag
    }
    have.add(item.refName)
    if (item.refName === 'Mercenary Warrant') { warrant ??= item; warrantTypes.add(item.tradeType) }
    if (item.namespace === 'GEM') gemIcon.set(item.refName, item.icon)
    const z = item.namespace === 'UNIQUE' ? zhName.get(item.refName) : undefined
    if (z && item.name !== z) {
      item.name = z
      return true
    }
    return Boolean(r)
  })
  const fresh = adds.filter(a => !have.has(a.refName)).map(a => ({
    name: nameOf(a.refName, a.zh), refName: a.refName, namespace: 'ITEM', tradeTag: a.tradeTag, exchangeable: true, icon: a.icon
  }))
  for (const b of bases) {
    if (!have.has(b.refName)) fresh.push({ name: nameOf(b.refName, b.zh), refName: b.refName, namespace: 'ITEM', ...(b.category ? { craftable: { category: b.category } } : {}) })
  }
  for (const u of uniques) {
    if (!have.has(u.refName)) fresh.push({ name: nameOf(u.refName, u.zh), refName: u.refName, namespace: 'UNIQUE', unique: { base: u.base } })
  }
  for (const g of gems) {
    if (have.has(g.refName)) continue
    fresh.push(g.normal
      ? { name: nameOf(g.refName, g.zh), refName: g.refName, namespace: 'GEM', tradeDisc: g.disc, icon: gemIcon.get(g.normal) ?? g.icon, gem: { transfigured: true, normalVariant: g.normal, maxLevel: g.maxLevel } }
      : { name: nameOf(g.refName, g.zh), refName: g.refName, namespace: 'GEM', gem: { maxLevel: g.maxLevel } })
  }
  const warrants = []
  for (const b of builds) {
    if (!warrant || warrantTypes.has(b.tradeType)) continue
    warrants.push({ ...warrant, disc: { ...warrant.disc, sectionText: nameOf(b.refName, b.zh) }, tradeType: b.tradeType })
    if (!have.has(b.refName)) fresh.push({ name: nameOf(b.refName, b.zh), refName: b.refName, namespace: 'MERCENARY_BUILD', icon: '', mercenaryBuild: b.base ?? { skills: [] } })
  }
  const out = fresh.length ? rewriteLines(text, () => false, fresh) : text
  // 最後一列契約書是沒有條件的通用列(disc 空):挑變體時對什麼都成立 → 新流派排在最後一列帶 tradeType 的契約書後面
  return warrants.length ? insertAfterLast(out, l => l.includes('"refName":"Mercenary Warrant"') && l.includes('"tradeType":'), warrants) : out
}

/**
 * 在最後一列符合 isAnchor 的列後面插入新列。名稱索引對同名同 refName 的列只收第一列,
 * 其餘變體(契約書的各流派)靠相鄰列讀到 → 新變體不能放檔尾。
 */
function insertAfterLast (fileText, isAnchor, rows) {
  const eol = fileText.includes('\r\n') ? '\r\n' : '\n'
  const lines = fileText.split(eol)
  let at = -1
  lines.forEach((l, i) => { if (isAnchor(l)) at = i })
  lines.splice(at + 1, 0, ...rows.map(r => JSON.stringify(r)))
  return lines.join(eol)
}
