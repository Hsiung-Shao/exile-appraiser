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
  'Enemies Taunted by your Warcries have #% increased Action Speed': -1
}

/**
 * 新詞綴的 better:帶數值且不是「減少 / 更少」→ 1(查價用「至少這個值」);其他 → 0(完全相同才算)。
 * 既有資料帶數值的詞綴 97% 是 1;標 0 會讓預設查詢只找數值一模一樣的掛單(2026-11-14 范迪戈之革)。
 * shortcut: 少數「越低越好」的句子(承受傷害、消耗)會被標成 1,遇到再個別改資料列。
 */
export function betterOf (ref) {
  if (ref in BETTER_OVERRIDES) return BETTER_OVERRIDES[ref]
  return ref.includes('#') && direction(ref) >= 0 && !/Grants Level \d+ #/.test(ref) ? 1 : 0
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
export function planEffectStats ({ enStats, zhStats, tradeStats, skills, supports, strings = {} }) {
  const used = new Set()
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
    const old = (byRef.get(e.text) ?? byRef.get(`${e.text} Skill`) ?? [])[0]
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
export function planNewStats ({ enStats, zhStats = /** @type {any[]} */ ([]), ggpkOld, ggpkNew, tradeStats }) {
  const oldKeys = new Set(ggpkOld.map(r => r.key))
  // 繁中新句把數字換成 # 後若與既有 matcher 同形(「獲得 1 層盛怒」對「獲得 # 層盛怒」),會搶走既有詞綴的比對 → 不加
  const shape = (text) => text.replace(/\d+(?:\.\d+)?/g, '#')
  const zhShapes = new Set([...eachStat(zhStats)].flatMap(s => s.matchers.map(m => shape(m.string))))
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
    if (known.has(k) || !/[a-z]/.test(k)) continue
    const entries = (tradeByText.get(k) ?? []).filter(e => !usedIds.has(e.id))
    if (!entries.length) continue
    // 舊版就有的 stat:只收交易站只列為固定詞綴的(3.30 臟器的詞綴多半是舊 stat、這季才給 implicit id);
    // 其餘類型的舊缺口數量大、沒有樣本,不自動加
    if (oldKeys.has(row.key) && !entries.every(e => e.id.startsWith('implicit.'))) continue
    if (row.zh && zhShapes.has(shape(toMatcherText(row.zh)))) continue
    if (!out.has(k)) {
      /** @type {Record<string, string[]>} */
      const ids = {}
      for (const e of entries) (ids[e.id.slice(0, e.id.indexOf('.'))] ??= []).push(e.id)
      const ref = entries[0].text.replace(/\s+\(Local\)$/i, '')
      out.set(k, { ref, better: betterOf(ref), en: [{ string: toMatcherText(row.en) }], zh: [], ids })
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

/**
 * 規則 9:交易站 gem 群組新上架的變異寶石(帶 `disc`;瓦爾版「Vaal X (…)」不算)。
 * 繁中名取 GGPK gemeffects,等級上限與圖示照原版寶石那一列。
 * @returns {{ adds: any[], rejects: any[] }}
 */
export function planGems ({ enItems, tradeItems, gems }) {
  const byRef = new Map(enItems.filter(i => i.namespace === 'GEM').map(i => [i.refName, i]))
  const zhOf = groupBy(gems, g => g.en)
  const adds = []
  const rejects = []
  for (const e of tradeItems) {
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
 * 同一條詞綴在遊戲裡的另一種繁中寫法(遊戲檔別的描述檔的句子)。只收有實機樣本的,逐條列在這裡;
 * 寫入前仍要在 GGPK 新版找得到這句(英文相同),找不到就不加。
 * - `# 點命中`:3.30 手套後綴「獅眼之」顯示「+587 點命中」(GitHub issue #9),資料只有「# 命中值」
 */
export const EXTRA_ZH_MATCHERS = [{ ref: '+# to Accuracy Rating', zh: '# 點命中' }]

/** 規則 11:`EXTRA_ZH_MATCHERS` → 繁中多一個 matcher @returns {{ adds: any[] }} */
export function planExtraZh ({ zhStats, ggpkNew }) {
  const inGgpk = new Set(ggpkNew.map(r => `${cmpKey(r.en)}|${toMatcherText(r.zh ?? '')}`))
  const adds = []
  for (const x of EXTRA_ZH_MATCHERS) {
    const have = [...eachStat(zhStats)].filter(s => s.ref === x.ref)
    if (!have.length || have.every(s => s.matchers.some(m => m.string === x.zh)) || !inGgpk.has(`${cmpKey(x.ref)}|${x.zh}`)) continue
    // superseded:解析器照樣比對,正則「物品詞綴數值」頁不拿它當模板(否則這條變成多種寫法而被排除)
    adds.push({ lang: 'cmn-Hant', ref: x.ref, matcher: { string: x.zh, superseded: true } })
  }
  return { adds }
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
 * @param {{ adds?: any[], replace?: Record<string, string>, remove?: string[], newStats?: any[], better?: Record<string, number>, fill?: Record<string, Record<string, string[]>> }} [plan]
 */
export function applyStatPlan (fileText, lang, { adds = [], replace = {}, remove = [], newStats = [], better = {}, fill = {} } = {}) {
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
    if (!have.has(g.refName)) fresh.push({ name: nameOf(g.refName, g.zh), refName: g.refName, namespace: 'GEM', tradeDisc: g.disc, icon: gemIcon.get(g.normal) ?? g.icon, gem: { transfigured: true, normalVariant: g.normal, maxLevel: g.maxLevel } })
  }
  return fresh.length ? rewriteLines(text, () => false, fresh) : text
}
