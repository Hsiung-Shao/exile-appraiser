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
  const zhByRef = groupBy([...eachStat(zhStats)], s => s.ref)
  const has = (stats, text) => stats.some(s => s.matchers.some(x => x.string === text))
  for (const stat of eachStat(enStats)) {
    const m = /^Socketed Gems are Supported by Level # (.+) \(Random Support Gem\)$/.exec(stat.ref)
    if (!m) continue
    const zh = [...new Set((gems.get(`${m[1]} Support`) ?? []).map(r => r.zh))]
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
  const fill = (text, name) => text.replace('{1}', '#').replace('{0}', name)
  const zhOf = groupBy(skills, s => s.en)
  const zhByRef = groupBy([...eachStat(zhStats)], s => s.ref)
  const live = (stat) => stat.matchers.filter(m => !m.superseded)
  for (const stat of eachStat(enStats)) {
    const m = /^Grants Level # ([^\n]+?)(?: Skill)?$/.exec(stat.ref)
    if (!m) continue
    const en = fill(template.en, m[1])
    // 瓦爾版技能的英文顯示名有時與原版相同(Determination → 堅定 / 瓦爾．堅定);英文沒寫 Vaal 就不是瓦爾版
    const zhNames = [...new Set((zhOf.get(m[1]) ?? []).map(s => s.zh))].filter((z, _, a) => a.length === 1 || m[1].startsWith('Vaal ') || !z.startsWith('瓦爾．'))
    const zhStat = (zhByRef.get(stat.ref) ?? [])[0]
    if (zhNames.length !== 1 || !zhStat) { rejects.push({ reason: 'GGPK 沒有唯一的技能繁中名', ref: stat.ref, candidates: zhNames }); continue }
    const zh = fill(template.zh, zhNames[0])
    if (live(stat).length === 1 && !stat.matchers.some(x => x.string === en)) adds.push({ lang: 'en', ref: stat.ref, matcher: { string: en }, supersedes: live(stat)[0].string })
    if (live(zhStat).length === 1 && !zhStat.matchers.some(x => x.string === zh)) adds.push({ lang: 'cmn-Hant', ref: stat.ref, matcher: { string: zh }, supersedes: live(zhStat)[0].string })
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
  const used = new Set()
  for (const stat of eachStat(enStats)) for (const id of allIds(stat)) used.add(id)
  const byText = groupBy(tradeStats.filter(e => !e.id.startsWith('pseudo.')), e => cmpKey(noLocal(e.text)))
  /** @type {Record<string, Record<string, string[]>>} */
  const out = {}
  for (const stat of eachStat(enStats)) {
    if (stat.ref in out) continue
    // 已有 id 的詞綴只加 effect_ 新 id:3.30 物品的輔助寶石 / 賦予技能詞綴索引在新 id,舊 id 可能搜尋 0 筆,兩個都送(count 群組)
    const hasIds = allIds(stat).length > 0
    const keys = new Set([cmpKey(stat.ref), ...stat.matchers.filter(m => !m.superseded).map(m => cmpKey(m.string))])
    /** @type {Record<string, string[]>} */
    const ids = {}
    for (const k of keys) {
      for (const e of byText.get(k) ?? []) {
        const type = e.id.slice(0, e.id.indexOf('.'))
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
  const used = new Set(taken)
  for (const stat of eachStat(enStats)) for (const id of allIds(stat)) used.add(id)
  const byRef = groupBy([...eachStat(enStats)], s => s.ref)
  const zhByRef = groupBy([...eachStat(zhStats)], s => s.ref)
  const kinds = [
    { re: /^Socketed Gems are Supported by Level # (.+ Support)$/, tpl: strings.ModGrantsSupportEffectWithLevel, names: groupBy(supports, s => s.en) },
    { re: /^Grants Level # (.+)$/, tpl: strings.ModGrantsEffectWithLevel, names: groupBy(skills, s => s.en) },
    { re: /^Grants (.+)$/, tpl: strings.ModGrantsEffect, names: groupBy(skills, s => s.en) }
  ]
  const fill = (text, name) => text.replace('{1}', '#').replace('{0}', name)
  const live = (stat) => stat.matchers.filter(m => !m.superseded)
  const newStats = new Map()
  const adds = []
  const rejects = []
  for (const e of tradeStats) {
    if (!e.id.includes('.effect_') || used.has(e.id)) continue
    if (newStats.has(e.text)) { (newStats.get(e.text).ids[e.id.slice(0, e.id.indexOf('.'))] ??= []).push(e.id); continue }
    const kind = kinds.find(k => k.tpl && k.re.test(e.text))
    const name = kind?.re.exec(e.text)?.[1]
    // 瓦爾版的英文顯示名有時與原版相同(同規則 13)
    const zhNames = [...new Set((kind?.names.get(name) ?? []).map(s => s.zh))].filter((z, _, a) => a.length === 1 || name.startsWith('Vaal ') || !z.startsWith('瓦爾．'))
    if (!kind || zhNames.length !== 1) { rejects.push({ reason: 'GGPK 沒有唯一的技能 / 寶石繁中名', id: e.id, to: e.text, candidates: zhNames }); continue }
    const en = fill(kind.tpl.en, name)
    const zh = fill(kind.tpl.zh, zhNames[0])
    // 舊列 ref 沒有「 Support」的寫法只認還沒有任何 id 的(有 id 的那種與「(Random Support Gem)」列並存,新 id 由規則 14 掛到後者)
    const bare = (byRef.get(e.text.replace(/ Support$/, '')) ?? []).filter(x => !allIds(x).length)
    const old = (byRef.get(e.text) ?? byRef.get(`${e.text} Skill`) ?? bare)[0]
    const oldZh = old && (zhByRef.get(old.ref) ?? [])[0]
    if (old && oldZh) {
      if (live(old).length === 1 && !old.matchers.some(m => m.string === en)) adds.push({ lang: 'en', ref: old.ref, matcher: { string: en }, supersedes: live(old)[0].string })
      if (live(oldZh).length === 1 && !oldZh.matchers.some(m => m.string === zh)) adds.push({ lang: 'cmn-Hant', ref: old.ref, matcher: { string: zh }, supersedes: live(oldZh)[0].string })
      continue
    }
    newStats.set(e.text, { ref: e.text, better: betterOf(e.text), en: [{ string: en }], zh: [{ string: zh }], ids: { [e.id.slice(0, e.id.indexOf('.'))]: [e.id] } })
  }
  return { newStats: [...newStats.values()], adds, rejects }
}

/**
 * 規則 16:交易站有、專案沒有任何詞綴引用的 id(隨機 / 固定 / 破裂 / 工藝),而專案裡有文字相同的詞綴 → 把 id 掛上去
 * (逐條比對 `audit-trade-ids.mjs` 的「沒引用 A / B」:同一條詞綴少掛了某個類型的 id)。
 * 只收文字(ref 或現行英文 matcher,寬鬆鍵)相同且唯一的那一條;同文字不只一條、選項型 id(`X|n`)、
 * 在合併群組裡的詞綴(類型會影響群組內選哪一條)、雜湊與該詞綴既有 id 不同的都拒收。
 * @returns {{ extra: Record<string, Record<string, string[]>>, rejects: any[] }}
 */
export const TYPE_ID_GROUPS = ['explicit', 'implicit', 'fractured', 'crafted']
export function planTypeIds ({ enStats, tradeStats }) {
  const used = new Set()
  const grouped = new Set()
  const hashOf = (id) => id.slice(id.indexOf('.') + 1)
  /** @type {Map<string, Set<string>>} */
  const hashes = new Map()
  /** @type {Map<string, Set<string>>} */
  const refsByText = new Map()
  for (const row of enStats) {
    for (const stat of row.stats ?? [row]) {
      if (!stat.matchers) continue
      if (row.stats) grouped.add(stat.ref)
      for (const id of allIds(stat)) used.add(id)
      for (const id of allIds(stat)) (hashes.get(stat.ref) ?? hashes.set(stat.ref, new Set()).get(stat.ref)).add(hashOf(id))
      for (const k of [cmpKey(stat.ref), ...stat.matchers.filter(m => !m.superseded).map(m => cmpKey(m.string))]) {
        if (!refsByText.has(k)) refsByText.set(k, new Set())
        refsByText.get(k).add(stat.ref)
      }
    }
  }
  /** @type {Record<string, Record<string, string[]>>} */
  const extra = {}
  const rejects = []
  for (const e of tradeStats) {
    const type = e.id.slice(0, e.id.indexOf('.'))
    if (!TYPE_ID_GROUPS.includes(type) || used.has(e.id)) continue
    const refs = [...(refsByText.get(cmpKey(noLocal(e.text))) ?? [])]
    if (!refs.length) continue // 資料完全沒有這條詞綴(逐條比對的 C 類),不在這條規則的範圍
    const reject = (reason) => rejects.push({ reason, id: e.id, to: e.text, candidates: refs })
    if (refs.length > 1) reject('同文字的詞綴不只一條')
    else if (e.id.includes('|')) reject('選項型 id')
    else if (grouped.has(refs[0])) reject('在合併群組裡')
    // 交易站會把同一句話給兩個不同的 stat(例:地圖的「#% more Monster Life」);只收與該詞綴既有 id 同一個雜湊的(= 同一個 stat 少掛了某個類型),
    // 雜湊不同就不確定是不是同一條,任何類型都不掛(審查 2026-11-15:只擋同類型會讓破裂 / 固定掛到另一個 stat)
    else if (!hashes.get(refs[0])?.has(hashOf(e.id))) reject('與既有 id 不是同一個 stat')
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
  const zhByRef = groupBy([...eachStat(zhStats)], s => s.ref)
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
  // 繁中新句把數字換成 # 後若與既有 matcher 同形(「獲得 1 層盛怒」對「獲得 # 層盛怒」),會搶走既有詞綴的比對 → 不加
  const shape = (text) => text.replace(/\d+(?:\.\d+)?/g, '#')
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
      for (const e of entries) (ids[e.id.slice(0, e.id.indexOf('.'))] ??= []).push(e.id)
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
  return [...new Set(out.values())]
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
    const zh = [...new Set((zhOf.get(e.name) ?? []).map(w => w.zh))]
    if (!bases.has(e.type)) rejects.push({ reason: '底材不在資料裡', id: e.name, to: e.type })
    else if (zh.length !== 1) rejects.push({ reason: 'GGPK 沒有唯一的繁中名', id: e.name, candidates: zh })
    else adds.push({ refName: e.name, zh: zh[0], base: e.type })
  }
  return { adds, rejects }
}

/** 交易站 items 群組 → 新底材那一列要帶的 craftable 類別(null = 不帶);沒列的群組不自動加(拒收) */
export const TRADE_BASE_GROUPS = { jewel: 'Jewel', viscera: null }

/**
 * 規則 7:GGPK 新版新增、且交易站 items 清單列為底材的物品(3.30:臟器、菌潮核心)。
 * 要先於規則 6 跑(新傳奇的底材可能是這裡加的)。
 * @returns {{ adds: any[], rejects: any[] }}
 */
export function planTradeBases ({ enItems, baseOld, baseNew, tradeItems }) {
  const have = new Set(enItems.map(i => i.refName))
  const oldPaths = new Set(baseOld.map(r => r.path))
  const fresh = groupBy(baseNew.filter(r => !oldPaths.has(r.path)), r => r.en)
  const adds = []
  const rejects = []
  for (const e of tradeItems) {
    if (e.flags?.unique || have.has(e.type) || !fresh.has(e.type)) continue
    have.add(e.type)
    const zh = [...new Set(fresh.get(e.type).map(r => r.zh))]
    if (!(e.group in TRADE_BASE_GROUPS)) rejects.push({ reason: '這個交易站群組沒有新增規則', id: e.type, to: e.group })
    else if (zh.length !== 1) rejects.push({ reason: 'GGPK 沒有唯一的繁中名', id: e.type, candidates: zh })
    else adds.push({ refName: e.type, zh: zh[0], category: TRADE_BASE_GROUPS[e.group] })
  }
  return { adds, rejects }
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
  for (const e of tradeItems) {
    // 新的一般技能寶石(沒有 disc):等級上限資料來源沒有,只收 NEW_GEM_MAX_LEVEL 列出的;繁中名取 GGPK activeskills
    if (e.group === 'gem' && !e.disc && !e.text && e.type && !e.type.startsWith('Vaal ') && !byRef.has(e.type)) {
      byRef.set(e.type, e)
      const zh = [...new Set((skillZh.get(e.type) ?? []).map(g => g.zh))]
      if (!(e.type in NEW_GEM_MAX_LEVEL)) rejects.push({ reason: '新的一般寶石:等級上限未確認(補進 NEW_GEM_MAX_LEVEL)', id: e.type })
      else if (zh.length !== 1) rejects.push({ reason: 'GGPK 沒有唯一的繁中名', id: e.type, candidates: zh })
      else adds.push({ refName: e.type, zh: zh[0], maxLevel: NEW_GEM_MAX_LEVEL[e.type] })
      continue
    }
    if (e.group !== 'gem' || !e.disc || !e.text || e.text.startsWith('Vaal ') || byRef.has(e.text)) continue
    byRef.set(e.text, e)
    const normal = byRef.get(e.type)
    const zh = [...new Set((zhOf.get(e.text) ?? []).map(g => g.zh))]
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
 * 多一個單行寫法 + 進階寫法,舊的兩行句標 superseded。英文沒有樣本,空白照規則 10 推出。
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
        if (m.superseded || !m.string.includes('\n') || !string.startsWith(head) || stat.matchers.some(x => x.string === string)) continue
        adds.push({ lang, ref: stat.ref, matcher: { string, advanced: string + mark }, supersedes: [m.string] })
      }
    }
  }
  plan(enStats, 'en', tpl.en, ' (...)')
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
  { ref: '#% chance to Blind Enemies on hit', zh: '擊中時有 #% 機率致盲敵人' },
  { ref: '#% increased chance of Ritual Altars with Special Rewards', zh: '增加 #% 祭祀神壇出現特殊獎勵的機率', current: true, old: '增加 #% 特殊獎勵出現於祭祀神壇的機率' },
  { ref: '#% increased chance of Ritual Altars with Special Rewards', zh: '減少 #% 祭祀神壇出現特殊獎勵的機率', negate: true, current: true, old: '減少 #% 特殊獎勵出現於祭祀神壇的機率' },
  { ref: 'Map Bosses have #% chance to be surrounded by Tormented Spirits', zh: '地圖頭目有 #% 機率受罪魂包圍' },
  // 希望之絃(GitHub issue #20):抗性是傳奇自己的合併 stat,繁中沒有空白、「全」不是「全部」(GGPK `{1:+d}%全元素抗性`)
  { ref: '+#% to all Elemental Resistances', zh: '#%全元素抗性', verified: 'GGPK unique_thread_of_hope_base_resist_all_elements_% + issue #20' },
  // 範圍名稱是 clientstrings JewelRadiusMassive「巨大」,專案原句「極大」對不到
  { ref: 'Only affects Passives in Massive Ring', zh: '只會影響巨大範圍內的天賦', advanced: '只會影響巨大範圍內的天賦', current: true, old: '只會影響極大範圍內的天賦', verified: 'GGPK clientstrings JewelRadiusMassive + issue #20' },
  // 傭兵輔助 3.30 改名(GGPK mercenarysupports;issue #21–23 只有階層 2 的實機樣本)
  { ref: 'Lesser Increased Area of Effect', zh: '低階增加範圍效果', advanced: '低階增加範圍效果(階層：1)', current: true, old: '低階增加效果範圍', verified: 'GGPK mercenarysupports' },
  { ref: 'Increased Area of Effect', zh: '增加範圍效果', advanced: '增加範圍效果(階層：2)', current: true, old: '增加效果範圍', verified: 'GGPK mercenarysupports + issue #21' },
  { ref: 'Greater Area of Effect', zh: '高階範圍效果', advanced: '高階範圍效果(階層：3)', current: true, old: '高階效果範圍', verified: 'GGPK mercenarysupports' }
]

/** 規則 11:`EXTRA_ZH_MATCHERS` → 繁中多一個 matcher @returns {{ adds: any[] }} */
export function planExtraZh ({ zhStats, ggpkNew }) {
  const inGgpk = new Set(ggpkNew.map(r => `${cmpKey(r.en)}|${toMatcherText(r.zh ?? '')}`))
  const adds = []
  for (const x of EXTRA_ZH_MATCHERS) {
    const have = [...eachStat(zhStats)].filter(s => s.ref === x.ref)
    // negate 的那一句在 GGPK 的英文是 reduced
    // verified:句子不在 stat 描述檔的同一個 stat 鍵底下(別張表 / 合併 stat),來源已人工查過 → 不做 GGPK 逐字檢查
    if (!have.length || have.every(s => s.matchers.some(m => m.string === x.zh)) || (!x.verified && !inGgpk.has(`${cmpKey(x.negate ? x.ref.replace('increased', 'reduced') : x.ref)}|${x.zh}`))) continue
    // superseded:解析器照樣比對,正則「物品詞綴數值」頁不拿它當模板(否則這條變成多種寫法而被排除)
    // supersedes:有 old 就標那一句;''(逐字對不到任何舊句)→ applyStatPlan 在同旗標的舊 matcher 恰好一條時標它
    adds.push(x.current
      ? { lang: 'cmn-Hant', ref: x.ref, matcher: { string: x.zh, ...(x.advanced ? { advanced: x.advanced } : {}), ...(x.negate ? { negate: true } : {}) }, supersedes: x.old ?? '' }
      : { lang: 'cmn-Hant', ref: x.ref, matcher: { string: x.zh, ...(x.negate ? { negate: true } : {}), superseded: true } })
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
  for (const [lang, stats] of [['cmn-Hant', zhStats], ['en', enStats]]) {
    for (const stat of eachStat(stats)) {
      const to = [...new Set((renameOf.get(nameOf(stat.ref)) ?? []).map(r => lang === 'en' ? r.en : r.zh))]
      if (to.length !== 1) continue
      for (const old of stat.matchers.filter(x => !x.superseded)) {
        const cut = old.string.indexOf(' (')
        const next = cut === -1 ? null : to[0] + old.string.slice(cut)
        if (next && next !== old.string && !stat.matchers.some(x => x.string === next)) adds.push({ lang, ref: stat.ref, matcher: { string: next }, supersedes: old.string })
      }
    }
  }
  for (const stat of eachStat(zhStats)) {
    const names = [...new Set((zhOf.get(nameOf(stat.ref)) ?? []).map(r => r.zh))]
    if (names.length !== 1) continue
    for (const old of stat.matchers.filter(x => !x.superseded)) {
      const cut = old.string.indexOf(' (')
      const next = cut === -1 ? null : names[0] + old.string.slice(cut)
      if (next && next !== old.string && !stat.matchers.some(x => x.string === next)) adds.push({ lang: 'cmn-Hant', ref: stat.ref, matcher: { string: next }, supersedes: old.string })
    }
  }
  // 壞掉的列(ROOM_GAME_NAMES):兩語補上遊戲內寫法,並標成選項型(開啟 / 受阻)
  const option = []
  for (const [ref, en] of Object.entries(ROOM_GAME_NAMES)) {
    const zh = [...new Set((zhOf.get(en) ?? []).map(r => r.zh))]
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
    const zh = [...new Set((zhOf.get(item.refName) ?? []).map(w => w.zh))]
    const mine = new Set(zhItems.filter(i => i.namespace === 'UNIQUE' && i.refName === item.refName).map(i => i.name))
    if (zh.length === 1 && !mine.has(zh[0])) out.push({ refName: item.refName, from: item.name, zh: zh[0] })
  }
  return out
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
 * @param {{ adds?: any[], replace?: Record<string, string>, remove?: string[], newStats?: any[], better?: Record<string, number>, fill?: Record<string, Record<string, string[]>>, extra?: Record<string, Record<string, string[]>>, option?: string[] }} [plan]
 */
export function applyStatPlan (fileText, lang, { adds = [], replace = {}, remove = [], newStats = [], better = {}, fill = {}, extra = {}, option = [] } = {}) {
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
      changed = true
    }
    for (const [type, ids] of Object.entries(stat.trade?.ids ?? {})) {
      const next = [...new Set(ids.filter(id => !gone.has(id)).map(id => replace[id] ?? id))]
      if (next.length === ids.length && next.every((id, i) => id === ids[i])) continue
      if (next.length) stat.trade.ids[type] = next
      else delete stat.trade.ids[type]
      changed = true
    }
    if (fill[stat.ref] && stat.trade) {
      const hasIds = allIds(stat).length > 0 // 同 ref 有多份時各自判斷:已有 id 的只收 effect_ 新 id
      for (const [type, ids] of Object.entries(fill[stat.ref])) {
        for (const id of ids) {
          if (hasIds && !id.includes('.effect_')) continue
          if ((stat.trade.ids[type] ??= []).includes(id)) continue
          stat.trade.ids[type].push(id)
          changed = true
        }
      }
    }
    if (extra[stat.ref] && stat.trade) {
      for (const [type, ids] of Object.entries(extra[stat.ref])) {
        for (const id of ids) {
          if ((stat.trade.ids[type] ??= []).includes(id)) continue
          stat.trade.ids[type].push(id)
          changed = true
        }
      }
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
 * @param {{ renames?: any[], adds?: any[], uniques?: any[], bases?: any[], gems?: any[], zhNames?: any[] }} [plan]
 */
export function applyItemPlan (fileText, lang, { renames = [], adds = [], uniques = [], bases = [], gems = [], zhNames = [] } = {}) {
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
  return fresh.length ? rewriteLines(text, () => false, fresh) : text
}
