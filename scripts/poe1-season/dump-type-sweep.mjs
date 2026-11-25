// 類型掃描的輸入:依物品類型列出「這類物品會出現的詞綴句子」(中英各一句),給 poe1/test/type-sweep.test.ts 用。
//
//   node scripts/poe1-season/dump-type-sweep.mjs [--rel-version 5] [--text-version 5] [--out poe1/test/docs/type-sweep.json]
//
// 來源是維護者本機的 GGPK 版本庫(docker `supabase_db_pobtools-ggpk-db`,只讀):
//   哪類物品會出現哪些詞綴 = rel_mod(domain / 產生方式)+ rel_mod_spawn(標籤權重)+ rel_base_item(_tag / _implicit)
//   句子 = ggpk_stat(描述檔;依詞綴數值挑條件相符的那一句)
// 句子是照 GGPK 組的,不是實機剪貼簿:數值只取詞綴上下限,顯示前的換算(除以 60 之類)沒做 —— 解析器不看數值大小。
// 2026-11-24 起預設讀 Supabase version 5(3.30.0d,含關聯表);新賽季匯入後改這兩個預設值。
//
// 傳奇專屬詞綴(classes 的 `Unique <類別>`):GGPK 3.30 的 mods 表(--rows 的 row 資料庫,GenerationType 3)
// 依同一套描述檔組句;名稱槽(天賦 hash、征服者、可索引輔助 / 技能寶石、珠寶範圍、召喚物類型)以同一個資料庫的表代入,
// 賦予技能(GrantedEffectsPerLevelKeys)以 clientstrings 句型 + 技能 / 輔助名組成。
// 「哪個傳奇掛哪條詞綴」GGPK 客戶端沒有,借 PoB Uniques(pob_record,3.29 版 PoB)的英文行對應:數字一律當 #,對到哪些傳奇就進那些傳奇底材的類別。
// shortcut: PoB 沒收的傳奇 / 英文改寫過的句子對不到、不進掃描(數量印在最後);PoB 更新後重匯 pob_record 再重跑。
//
// 開季差異掃描:
//   node scripts/poe1-season/dump-type-sweep.mjs --diff <舊 version>,<新 version> [--diff-rel <version>] [--out poe1/test/docs/type-sweep-diff.json]
// 兩邊各自從 Supabase 的同一個 version 讀關聯表 / 句子 / row 資料(`poe1.ggpk_row`,不讀 --rows),
// 只留「新版這類物品有、舊版這類沒有」的句子(sweep-diff.mjs `diffSweep`),每句標 new-mod / changed / new-spawn。
// `--diff-rel` = 兩邊都用這個 version 的關聯表(新版關聯表還沒匯入時,先比句子改字與傳奇詞綴)。
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffSweep, fill, lineShape, pobLineFits, sweepKey } from './sweep-diff.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const flag = (/** @type {string} */ n, /** @type {string} */ d) => args.includes(n) ? args[args.indexOf(n) + 1] : d
const DIFF = flag('--diff', '')
const OUT = path.resolve(ROOT, flag('--out', DIFF ? 'poe1/test/docs/type-sweep-diff.json' : 'poe1/test/docs/type-sweep.json'))
const ROWS = flag('--rows', 'D:/codeproject/Pob2/pob-zh-engine/tools/ggpk_zh/db/ggpk_rows_3.30.0.1.sqlite')

/** @returns {any[]} */
function sql (/** @type {string} */ q) {
  const out = execFileSync('docker', ['exec', 'supabase_db_pobtools-ggpk-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-At',
    '-c', `select coalesce(json_agg(t), '[]') from (${q}) t`], { encoding: 'utf8', maxBuffer: 1 << 30 })
  return JSON.parse(out)
}

/** 詞綴的產生方式 → 交易站類型;只收「依物品標籤決定能不能出現」的幾種 */
const GEN_TYPE = { prefix: 'explicit', suffix: 'explicit', corrupted: 'implicit', eater_implicit: 'implicit', exarch_implicit: 'implicit' }
/** 地圖類的句子先看地圖描述檔(同一個 stat 在地圖上的寫法不同) */
const FILES_OF = (/** @type {string} */ domain) => /area/.test(domain) ? ['map_stat_descriptions.txt', 'stat_descriptions.txt'] : ['stat_descriptions.txt']

/** row 資料:預設讀 --rows 的 sqlite;差異掃描讀 Supabase 指定 version(舊版沒有的表 = 空) */
const sqliteRows = () => {
  const rdb = new DatabaseSync(ROWS, { readOnly: true })
  return (/** @type {string} */ t) => rdb.prepare('select row_ix, en, zh_tw from row where tbl = ? order by row_ix').all(t)
    .map((/** @type {any} */ r) => ({ ix: r.row_ix, en: JSON.parse(r.en), zh: r.zh_tw ? JSON.parse(r.zh_tw) : {} }))
}
const supabaseRows = (/** @type {number} */ v) => (/** @type {string} */ t) =>
  sql(`select row_ix ix, en, coalesce(zh_tw, '{}') zh from poe1.ggpk_row where version_id = ${v} and tbl = '${t}' order by row_ix`)

// 整個產生流程以一個 version 為單位(差異掃描跑兩次);內文沿用原本的頂層寫法,未重新縮排
/** @param {number} REL 關聯表 version @param {number} TXT 句子 / 名稱 version @param {(t: string) => { ix: number, en: any, zh: any }[]} rowsOf */
function build (REL, TXT, rowsOf) {
const bases = sql(`select b.item_id, b.item_class, b.domain, c.en, c.zh_tw zh from poe1.rel_base_item b
  join poe1.ggpk_cell c on c.version_id = ${TXT} and c.tbl = 'baseitemtypes' and c.col = 'Name' and c.ident = b.item_id
  where b.version_id = ${REL} and b.domain not like 'unknown%' and b.domain <> 'dummy'`)
const baseTags = sql(`select item_id, tag_id from poe1.rel_base_item_tag where version_id = ${REL}`)
const baseImpl = sql(`select item_id, mod_id from poe1.rel_base_item_implicit where version_id = ${REL}`)
const mods = sql(`select mod_id, domain, generation_type gen from poe1.rel_mod where version_id = ${REL}`)
const spawn = sql(`select mod_id, tag_id, weight from poe1.rel_mod_spawn where version_id = ${REL} order by mod_id, ix`)
const modStat = sql(`select mod_id, stat_id, min, max from poe1.rel_mod_stat where version_id = ${REL} order by mod_id, slot`)
const descs = sql(`select stat_ids, cond, src_file, en, zh_tw zh, handlers from poe1.ggpk_stat where version_id = ${TXT}
  and src_file in ('stat_descriptions.txt', 'map_stat_descriptions.txt') order by src_file, stat_ids, src_line, dup_ix`)
const classes = sql(`select ident, en, zh_tw zh from poe1.ggpk_cell where version_id = ${TXT} and tbl = 'itemclasses' and col = 'Name'`)

const group = (/** @type {any[]} */ list, /** @type {(x: any) => string} */ key) => {
  /** @type {Map<string, any[]>} */
  const m = new Map()
  for (const x of list) (m.get(key(x)) ?? m.set(key(x), []).get(key(x))).push(x)
  return m
}
const tagsOf = group(baseTags, r => r.item_id)
const spawnOf = group(spawn, r => r.mod_id)
const statsOf = group(modStat, r => r.mod_id)
const modById = new Map(mods.map(m => [m.mod_id, m]))

const nm = (/** @type {any} */ r, col = 'Name') => ({ en: r.en[col], zh: r.zh[col] || r.en[col] })
/** 名稱槽:描述檔 handler → 依數值查名稱(可能好幾個:同一個征服者槽在不同 InternalVersion 有不同人) */
const byIndex = (/** @type {string} */ t, col = 'Index') => group(rowsOf(t), r => String(r.en[col]))
const passives = byIndex('passiveskills', 'PassiveSkillGraphId')
const treeVersions = rowsOf('alternatetreeversions')
const keystones = rowsOf('alternatetreeversionkeystones')
const supportIx = byIndex('indexablesupportgems')
const nonActiveIx = byIndex('indexablenonactivesupportgems')
const skillIx = byIndex('indexableskillgems')
const doubling = byIndex('miniondoublingstattypes')
const radii = rowsOf('passivejewelradii')
const clientStrings = new Map(rowsOf('clientstrings').map(r => [r.ix, r]))
/** @type {Record<string, (v: number, vals: number[]) => { en: string, zh: string }[]>} */
const NAME = {
  passive_hash: v => (passives.get(String(v)) ?? []).map(r => nm(r)),
  alternate_tree_version_name: v => treeVersions.filter(r => r.ix === v).map(r => nm(r)),
  // 第 1 個數值是版本(local_unique_jewel_alternate_tree_version)
  alternate_tree_version_keystone: (v, vals) => keystones.filter(r => r.en.Version === vals[0] && r.en.StatValue === v).map(r => nm(r, 'Conqueror')),
  display_indexable_support: v => (supportIx.get(String(v)) ?? []).map(r => nm(r)),
  display_indexable_non_active_support: v => (nonActiveIx.get(String(v)) ?? []).map(r => nm(r)),
  display_indexable_skill: v => (skillIx.get(String(v)) ?? []).map(r => nm(r, 'Name1')),
  passive_jewel_radius: v => radii.filter(r => r.ix === v - 1).map(r => nm(clientStrings.get(r.en.ClientString), 'Text')),
  minion_doubling_type: v => (doubling.get(String(v)) ?? []).map(r => nm(r))
}
/** 名稱槽的數值是索引:範圍內每個值都組一句(上限避免把整張表展開) */
const NAME_RANGE_MAX = 400
// 伺服器端才骰的天賦 hash(客戶端 mods 表只有佔位值):禁忌珠寶 = 昇華大天賦、不可能的逃脫 = 基石
// 篩選:輿圖 / 自訂昇華節點 / 布雷克爾子樹 / 多選一節點除外,昇華只收六個職業;再只留交易站這條詞綴的選項清單裡有的名字
// (GGPK 客戶端沒有「能骰出哪些」,交易站選項是唯一的完整清單)
const TRADE_STATS = JSON.parse(fs.readFileSync(path.join(ROOT, 'poe1/test/docs/trade-stats.json'), 'utf8')).result.flatMap((/** @type {any} */ g) => g.entries)
// 存檔把每個選項展開成一筆(`id|hash`、句子帶名字),名字從句型擷取
const optionNames = (/** @type {RegExp} */ re) => new Set(TRADE_STATS.map((/** @type {any} */ e) => re.exec(e.text)?.[1]).filter(Boolean))
const forbiddenNames = optionNames(/^Allocates (.+) if you have the matching modifier on Forbidden (?:Flesh|Flame)$/)
const escapeNames = optionNames(/^Passive Skills in Radius of (.+) can be Allocated\n/)
const ascendancies = new Map(rowsOf('ascendancy').map(r => [r.ix, r]))
// SkillType 1 = 輿圖天賦;Id `AscendancyCustom*` = 不在一般昇華樹上的自訂節點(血脈、劫盜展品之類)
const passiveRows = [...passives.values()].flat().filter(r => !r.en.IsJustIcon && !r.en.IsMultipleChoiceOption && r.en.Name &&
  r.en.SkillType === 0 && !r.en.Id.startsWith('AscendancyCustom') && r.en.BrequelSubTree == null && !r.en.IsBrequelWomb)
const ascNotables = passiveRows.filter(r => r.en.IsNotable && !r.en.IsAscendancyStartingNode && !r.en.IsMultipleChoice &&
  ascendancies.has(r.en.AscendancyKey) && ascendancies.get(r.en.AscendancyKey).en.Character !== 2 && forbiddenNames.has(r.en.Name)).map(r => r.en.PassiveSkillGraphId)
const keystoneHashes = passiveRows.filter(r => r.en.AscendancyKey == null && r.en.IsKeystone && escapeNames.has(r.en.Name)).map(r => r.en.PassiveSkillGraphId)
if (!ascNotables.length || !keystoneHashes.length) throw new Error('交易站選項清單對不到禁忌珠寶 / 不可能的逃脫的天賦(存檔格式變了?)')
/** @type {Record<string, number[]>} */
const VALUE_POOL = {
  unique_jewel_grants_notable_hash_part_1: ascNotables,
  unique_jewel_grants_notable_hash_part_2: ascNotables,
  local_unique_jewel_disconnected_passives_can_be_allocated_around_keystone_hash: keystoneHashes
}
// 描述區塊:同一個檔的同一組 stat_ids;每個 stat 可以屬於好幾個區塊
const blocks = [...group(descs, r => `${r.src_file}|${r.stat_ids}`).values()].map(rows => ({ file: rows[0].src_file, ids: rows[0].stat_ids.split(' '), rows }))
const blocksOf = group(blocks.flatMap(b => b.ids.map(id => ({ id, b }))), r => r.id)

/** 條件的一格:`#` 任意、`N` 等於、`A|B` 範圍(# = 不限)、`!N` 不等於 */
function condOk (/** @type {string} */ tok, /** @type {number} */ v) {
  if (tok === '#') return true
  if (tok.startsWith('!')) return v !== Number(tok.slice(1))
  if (!tok.includes('|')) return v === Number(tok)
  const [a, b] = tok.split('|')
  return (a === '#' || v >= Number(a)) && (b === '#' || v <= Number(b.replace('#', '')))
}
/** 一個詞綴 → 它印出來的句子(數值各取下限與上限一次) */
function linesOfMod (/** @type {string} */ modId, /** @type {string} */ domain) {
  return linesOfStats(statsOf.get(modId) ?? [], FILES_OF(domain))
}
/** @param {{ stat_id: string, min: number | string, max: number | string }[]} stats @param {string[]} files */
function linesOfStats (stats, files) {
  /** @type {{ en: string, zh: string, key: string, shape: string }[]} */
  const out = []
  const done = new Set()
  for (const pick of ['min', 'max']) {
    const val = new Map(stats.map(s => [s.stat_id, Number(s[pick])]))
    for (const s of stats) {
      // 「區域內找到更多地圖 / 通貨 / 綢帶」在地圖上印成屬性行(更多地圖: +N%),不是詞綴行(推論:實機地圖樣本都是屬性行)
      if (s.stat_id.endsWith('_final_from_uber_mod')) continue
      const mine = blocksOf.get(s.stat_id)?.map(r => r.b) ?? []
      const b = files.map(f => mine.find(x => x.file === f)).find(Boolean)
      if (!b) continue
      const vals = b.ids.map((/** @type {string} */ id) => val.get(id) ?? 0)
      if (vals.every((/** @type {number} */ v) => v === 0) && !b.ids.some((/** @type {string} */ id) => id in VALUE_POOL)) continue
      const ok = b.rows.filter((/** @type {any} */ r) => r.cond.split(' ').every((/** @type {string} */ t, /** @type {number} */ i) => condOk(t, vals[i])))
      // 同一個條件在描述檔出現兩次(舊句 + 新句)時後面那句生效(流血「Cannot / cannot be inflicted」)
      const row = ok.findLast((/** @type {any} */ r) => r.cond === ok[0].cond)
      // 沒有字的句子(釣竿的「{0}」)不是詞綴行
      if (!row?.en || !row.zh || !/\p{L}/u.test(row.en)) continue
      // 顯示前取負號的數值(handlers 的 negate,第幾個從 1 起算)
      const shown = vals.map((/** @type {number} */ v, /** @type {number} */ i) => (row.handlers ?? []).some((/** @type {any[]} */ h) => h[0] === 'negate' && Number(h[1]) === i + 1) ? -v : v)
      for (const named of nameCombos(row.handlers ?? [], b.ids, shown, stats)) {
        // key = 描述句鍵(差異掃描判斷「同一個 stat 改字」用)
        const line = { en: fill(row.en, named, 'en'), zh: fill(row.zh, named, 'zh'), key: `${b.file}|${b.ids.join(' ')}|${row.cond}`, shape: lineShape(row.en, row.zh, named) }
        if (!done.has(line.en)) { done.add(line.en); out.push(line) }
      }
    }
  }
  return out
}

/** 名稱槽代入:每個槽展開成範圍內每個值的每個名稱(笛卡兒積);查不到名稱的值留數字 */
function nameCombos (/** @type {any[][]} */ handlers, /** @type {string[]} */ ids, /** @type {number[]} */ shown, /** @type {any[]} */ stats) {
  /** @type {Array<Array<number | { en: string, zh: string }>>} */
  let combos = [shown]
  for (const [h, at] of handlers) {
    if (!(h in NAME)) continue
    const k = Number(at) - 1
    const s = stats.find(x => x.stat_id === ids[k])
    const lo = Number(s?.min ?? shown[k]); const hi = Number(s?.max ?? shown[k])
    const vs = VALUE_POOL[ids[k]] ?? (hi - lo <= NAME_RANGE_MAX ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : [shown[k]])
    combos = combos.flatMap(c => vs.flatMap(v => {
      const names = NAME[h](v, shown)
      // 查不到名稱(索引超出表)= 遊戲不會印出這一句,不組
      return names.map(n => c.map((x, i) => i === k ? n : x))
    }))
  }
  return combos
}

/** @type {Record<string, any>} */
const out = {}
/** @type {string[][]} */
const lines = []
const lineIx = new Map()
/** 與 lines 同索引:這一句來自哪些詞綴 id、哪些描述句鍵 @type {{ mods: Set<string>, stats: Set<string> }[]} */
const meta = []
const add = (/** @type {{en: string, zh: string, key?: string, shape?: string}} */ l, /** @type {string} */ modId) => {
  // 只差代入數值的句子算同一句(解析器不看數值大小),留第一個當樣本;寫死的數字不同是兩句(2026-11-25 野變 per 15 / Eldritch per 100)
  const k = l.shape ?? sweepKey(l.en, l.zh)
  // 文字完全相同的也算同一句(寫死數值的獨立 stat 與模板句印出同一句,shape 不同)
  const text = JSON.stringify([l.en, l.zh])
  if (!lineIx.has(k)) {
    const same = lineIx.get(text)
    if (same !== undefined) lineIx.set(k, same)
    else { lineIx.set(k, lines.length); lines.push([l.en, l.zh]); meta.push({ mods: new Set(), stats: new Set(), shape: k }) }
  }
  if (!lineIx.has(text)) lineIx.set(text, lineIx.get(k))
  const ix = lineIx.get(k)
  meta[ix].mods.add(modId)
  if (l.key) meta[ix].stats.add(l.key)
  return ix
}
const modsByDomain = group(mods.filter(m => m.gen in GEN_TYPE), m => m.domain)
const implOf = group(baseImpl, r => r.item_id)
const className = new Map(classes.map(c => [c.ident, c]))
/** 已經從遊戲移除、不會再有人查價的類別 */
const SKIP = new Set(['HiddenItem', 'RemovedItem', 'AnimalCharm', 'Leaguestone', 'SentinelDrone', 'AtlasUpgradeItem'])
for (const [cls, list] of group(bases, b => b.item_class)) {
  if (SKIP.has(cls)) continue
  const name = className.get(cls) ?? className.get(cls.replace(/ /g, ''))
  const sets = { explicit: new Set(), implicit: new Set() }
  for (const b of list) {
    const tags = new Set((tagsOf.get(b.item_id) ?? []).map(t => t.tag_id))
    for (const m of modsByDomain.get(b.domain) ?? []) {
      // 標籤權重由上往下第一個物品有的標籤決定;權重 0 = 這個底材不會出現
      const hit = (spawnOf.get(m.mod_id) ?? []).find(s => tags.has(s.tag_id))
      if (!hit || Number(hit.weight) <= 0) continue
      for (const l of linesOfMod(m.mod_id, m.domain)) sets[GEN_TYPE[m.gen]].add(add(l, m.mod_id))
    }
    for (const i of implOf.get(b.item_id) ?? []) {
      for (const l of linesOfMod(i.mod_id, modById.get(i.mod_id)?.domain ?? b.domain)) sets.implicit.add(add(l, i.mod_id))
    }
  }
  if (!sets.explicit.size && !sets.implicit.size) continue
  out[cls] = {
    class: name ? [name.en, name.zh] : null,
    bases: [...new Map(list.map(b => [b.en, [b.en, b.zh]])).values()],
    explicit: [...sets.explicit].sort((a, b) => a - b),
    implicit: [...sets.implicit].sort((a, b) => a - b)
  }
}
// ---- 傳奇專屬詞綴 ----
const rowMap = (/** @type {string} */ t) => new Map(rowsOf(t).map(r => [r.ix, r]))
const rStats = rowMap('stats')
const gepl = rowMap('grantedeffectsperlevel')
const grantedEffects = rowMap('grantedeffects')
const activeSkills = rowMap('activeskills')
const gemEffects = rowsOf('gemeffects')
const csById = new Map([...clientStrings.values()].map(r => [r.en.Id, r]))
/** 賦予技能:3.30 起由句型 + 技能(或輔助)名組成,不在描述檔 */
function grantLines (/** @type {any} */ m) {
  return m.GrantedEffectsPerLevelKeys.flatMap((/** @type {number} */ k) => {
    const l = gepl.get(k)
    const g = l && grantedEffects.get(l.en.GrantedEffect)
    if (!g) return []
    const e = g.en.IsSupport ? gemEffects.find(x => (x.en.GrantedEffect === g.ix || x.en.GrantedEffect2 === g.ix) && x.en.SupportName) : null
    const a = g.en.IsSupport ? null : activeSkills.get(g.en.ActiveSkill)
    const name = e ? nm(e, 'SupportName') : a ? nm(a, 'DisplayedName') : null
    const tpl = csById.get(g.en.IsSupport ? 'ModGrantsSupportEffectWithLevel' : 'ModGrantsEffectWithLevel')
    if (!name?.en || !tpl) return []
    const f = (/** @type {'en' | 'zh'} */ lang) => nm(tpl, 'Text')[lang].replace('{0}', name[lang]).replace('{1}', String(l.en.Level))
    return [{ en: f('en'), zh: f('zh') }]
  })
}
// 物品上的 domain(rel_mod 的 domain_id):item / flask / base_jewel / affliction_jewel / tincture;地圖、怪物、寶箱等傳奇詞綴不在物品上
const ITEM_DOMAINS = new Set([1, 2, 10, 21, 34])
const uniqueMods = rowsOf('mods').filter(m => m.en.GenerationType === 3 && ITEM_DOMAINS.has(m.en.Domain)).map(({ en: m }) => {
  const stats = []
  for (let n = 1; n <= 8; n++) {
    const k = m[`StatsKey${n}`]
    if (k != null) stats.push({ stat_id: rStats.get(k).en.Id, min: m[`Stat${n}Min`], max: m[`Stat${n}Max`] })
  }
  // shortcut: 只看 stat_descriptions.txt(上面只匯了它與地圖描述檔),萃取物等其他描述檔的句子會靜默掉出掃描;要掃時把檔案加進 descs 查詢
  // 賦予技能句只在詞綴自己沒有描述檔句子時才組:有的話物品上印的是描述檔那句(「Triggers Level 20 X when Equipped」之類)
  const own = linesOfStats(stats, ['stat_descriptions.txt'])
  return { id: m.Id, stats: stats.map(s => s.stat_id), lines: own.length ? own : grantLines(m) }
}).filter(m => m.lines.length)

// PoB 的傳奇:名稱 + 底材 + 每一行英文;數字(含範圍)一律當 #,句尾「 Skill」(3.29 的賦予技能寫法)拿掉
const norm = (/** @type {string} */ s) => s.toLowerCase().replace(/\(-?[\d.]+--?[\d.]+\)/g, '#').replace(/\d+(?:\.\d+)?/g, '#').replace(/[+-]#/g, '#').replace(/ skill$/, '').trim()
const pob = sql(`select src_file, src_line, field, en_text from poe1.pob_record where src_file like 'Data/Uniques/%' and field in ('name', 'base', 'lines') order by src_file, src_line, ordinal`)
const baseOf = new Map(bases.map(b => [b.en, b]))
const wordZh = new Map(rowsOf('words').filter(w => w.zh.Text2 && w.zh.Text2 !== w.en.Text2).map(w => [w.en.Text2, w.zh.Text2]))
// PoB 的特殊檔只有詞綴行、沒有名稱與底材
const POB_SPECIAL = { 'Data/Uniques/Special/WatchersEye.lua': ["Watcher's Eye", 'Prismatic Jewel'], 'Data/Uniques/Special/BoundByDestiny.lua': ['Bound By Destiny', 'Prismatic Jewel'] }
// PoB 用程式產生、pob_record 沒有的傳奇:以 stat id 直接指定
const STAT_UNIQUE = {
  unique_jewel_grants_notable_hash_part_1: ['Forbidden Flesh', 'Cobalt Jewel'],
  unique_jewel_grants_notable_hash_part_2: ['Forbidden Flame', 'Crimson Jewel'],
  local_unique_jewel_disconnected_passives_can_be_allocated_around_keystone_hash: ['Impossible Escape', 'Viridian Jewel']
}
const mkUnique = (/** @type {string | undefined} */ name, /** @type {string | undefined} */ base, /** @type {string[]} */ ls) => ({ name, zhName: name && wordZh.get(name), base: base && baseOf.get(base), lines: ls.map(norm), raw: ls })
const pobUniques = [...group(pob, r => `${r.src_file}|${r.src_line}`).values()].map(rs => {
  const [sName, sBase] = POB_SPECIAL[/** @type {keyof typeof POB_SPECIAL} */ (rs[0].src_file)] ?? []
  return mkUnique(sName ?? rs.find(r => r.field === 'name')?.en_text, sBase ?? rs.find(r => r.field === 'base')?.en_text, rs.filter(r => r.field === 'lines').map(r => r.en_text))
}).concat(Object.values(STAT_UNIQUE).map(([n, b]) => mkUnique(n, b, []))).filter(u => u.base && !SKIP.has(u.base.item_class))
const uniquesOfLine = group(pobUniques.flatMap(u => u.lines.map((l, i) => ({ l, u, raw: u.raw[i] }))), r => r.l)
/** 物品大類:每大類只放對到最多傳奇的一個類別,避免同一句重複幾十次(推論:局部 / 全域詞綴大多只在大類之間不同,箭袋 / 盾的少數例外靠下面的樣本類別補) */
// 有實機傳奇樣本(GitHub issue 的剪貼簿)的類別一律保留,樣本才對得到掃描
const SAMPLE_CLASSES = new Set(fs.readdirSync(path.join(ROOT, 'poe1/test/docs')).filter(f => /^3\.30-issue-.*\.txt$/.test(f)).flatMap(f => {
  const text = fs.readFileSync(path.join(ROOT, 'poe1/test/docs', f), 'utf8')
  if (!/^(稀有度|Rarity): (傳奇|Unique)\r?$/m.test(text)) return []
  const klass = text.split(/\r?\n/)[0].replace(/^(Item Class|物品種類): /, '')
  return classes.filter(c => c.en === klass || c.zh === klass).map(c => c.ident.replace(/ /g, ''))
}))
const KIND = (/** @type {string} */ cls) => /Flask|Tincture/.test(cls) ? 'flask' : /Jewel/.test(cls) ? 'jewel' : /^(Amulet|Ring|Belt)$/.test(cls) ? 'jewellery'
  : /^(Body Armour|Boots|Gloves|Helmet|Shield|Quiver)$/.test(cls) ? 'armour' : 'weapon'
let unmatched = 0
/** 每一句 → 類別 → 對到幾個傳奇 @type {Map<number, Map<string, number>>} */
const lineClasses = new Map()
/** `--explain <檔>`:每一句來自哪些詞綴、對到哪些 PoB 傳奇(查缺口來源用) @type {Map<number, { mods: Set<string>, uniques: Set<string> }>} */
const explain = new Map()
for (const m of uniqueMods) {
  // norm 把數字一律當 #;有 shape 的句子再要求寫死的數字相同(審查 2026-11-25:per 50 / per 200 的傳奇對到 Divergent 詞綴的 per 100 / per 400)
  const matched = m.lines.flatMap(l => (uniquesOfLine.get(norm(l.en.split('\n')[0])) ?? [])
    .filter(r => !('shape' in l) || pobLineFits(JSON.parse(String(l.shape))[0].split('\n')[0], r.raw)).map(r => r.u))
  for (const s of m.stats) if (s in STAT_UNIQUE) matched.push(mkUnique(...STAT_UNIQUE[/** @type {keyof typeof STAT_UNIQUE} */ (s)], []))
  const hits = matched.map(u => u.base.item_class)
  if (!hits.length) { unmatched += 1; continue }
  for (const l of m.lines) {
    const ix = add(l, m.id)
    const counts = lineClasses.get(ix) ?? lineClasses.set(ix, new Map()).get(ix)
    for (const cls of hits) counts.set(cls, (counts.get(cls) ?? 0) + 1)
    const e = explain.get(ix) ?? explain.set(ix, { mods: new Set(), uniques: new Set() }).get(ix)
    e.mods.add(m.id)
    for (const u of matched) e.uniques.add(u.name)
  }
}
const EXPLAIN = flag('--explain', '')
if (EXPLAIN) fs.writeFileSync(EXPLAIN, JSON.stringify(Object.fromEntries([...explain].map(([ix, e]) => [lines[ix][0], { mods: [...e.mods], uniques: [...e.uniques] }]))))
/** @type {Map<string, Set<number>>} */
const uniqueSets = new Map()
for (const [ix, counts] of lineClasses) {
  /** @type {Map<string, [string, number]>} */
  const best = new Map()
  for (const [cls, n] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    const cur = best.get(KIND(cls))
    if (!cur || n > cur[1]) best.set(KIND(cls), [cls, n])
  }
  const keep = new Set([...best.values()].map(([cls]) => cls).concat([...counts.keys()].filter(cls => SAMPLE_CLASSES.has(cls.replace(/ /g, '')))))
  for (const cls of keep) (uniqueSets.get(cls) ?? uniqueSets.set(cls, new Set()).get(cls)).add(ix)
}
// 傳奇的詞綴在物品上印成哪一段,GGPK 客戶端沒有;看交易站 3.30 stats 存檔:只有 implicit id 的放固定詞綴段,
// 只有附魔等其他類型 id 的不收(附魔不在掃描範圍),有 explicit 或完全沒有 id 的放傳奇詞綴段
const tradeTypes = (() => {
  // 交易站只列「increased」與單數寫法:減少 / 複數也當成同一句
  const nk = (/** @type {string} */ s) => s.toLowerCase().replace(/\d+(?:\.\d+)?/g, '#').replace(/[+-]#/g, '#').replace(/\breduced\b/g, 'increased')
    .replace(/\bmodifiers\b/g, 'modifier').replace(/\s+/g, ' ').trim()
  /** @type {Map<string, Set<string>>} */
  const m = new Map()
  const put = (/** @type {string} */ text, /** @type {string} */ id) => (m.get(nk(text)) ?? m.set(nk(text), new Set()).get(nk(text))).add(id.split('.')[0])
  for (const e of TRADE_STATS) {
    put(e.text, e.id)
    for (const o of e.option?.options ?? []) put(e.text.replace('#', o.text), e.id)
  }
  return (/** @type {string} */ en) => m.get(nk(en)) ?? m.get(nk(en.split('\n')[0])) ?? new Set()
})()
let enchantOnly = 0
for (const [cls, set] of [...uniqueSets].sort(([a], [b]) => a.localeCompare(b))) {
  const name = className.get(cls) ?? className.get(cls.replace(/ /g, ''))
  const explicit = []; const implicit = []
  for (const ix of [...set].sort((a, b) => a - b)) {
    const t = tradeTypes(lines[ix][0])
    if (t.has('explicit') || !t.size) explicit.push(ix)
    else if (t.has('implicit')) implicit.push(ix)
    else enchantOnly += 1
  }
  // 代表物品:這類的傳奇裡有繁中名的前 30 個(測試挑第一個解析器認得的)
  const picks = [...new Map(pobUniques.filter(u => u.base.item_class === cls && u.zhName && u.base.zh).map(u => [u.name, u])).values()].slice(0, 30)
  out[`Unique ${cls}`] = {
    class: name ? [name.en, name.zh] : null,
    bases: picks.map(u => [u.base.en, u.base.zh]),
    uniques: picks.map(u => [u.name, u.zhName]),
    explicit,
    implicit
  }
}
console.log(`傳奇詞綴:${uniqueMods.length} 條有句子,${unmatched} 條對不到 PoB 的傳奇(不進掃描),${enchantOnly} 句(類別 × 句)交易站只有附魔等 id(不進掃描)`)
// allMods = 這個版本存在的全部詞綴(差異掃描判斷 new-mod;沒進掃描的也算「舊版就有」)
const allMods = [...new Set([...mods.map(m => m.mod_id), ...rowsOf('mods').map(r => r.en.Id)])].sort()
return { lines, classes: out, meta: meta.map(m => ({ mods: [...m.mods].sort(), stats: [...m.stats].sort(), shape: m.shape })), allMods }
}

/** @type {{ lines: string[][], classes: Record<string, any> }} */
let result
if (DIFF) {
  const [oldV, newV] = DIFF.split(',').map(Number)
  const rel = flag('--diff-rel', '')
  const gameVersion = (/** @type {number} */ v) => sql(`select game_version from poe1.ggpk_version where id = ${v}`)[0]?.game_version ?? String(v)
  const before = build(rel ? Number(rel) : oldV, oldV, supabaseRows(oldV))
  const after = build(rel ? Number(rel) : newV, newV, supabaseRows(newV))
  const d = diffSweep(before, after)
  result = { diff: { old: gameVersion(oldV), new: gameVersion(newV), versions: [oldV, newV], rel: rel ? Number(rel) : null }, ...d }
  const count = (/** @type {string} */ o) => d.origins.filter(x => x === o).length
  console.log(`差異:${d.lines.length} 句(new-mod ${count('new-mod')}、changed ${count('changed')}、new-spawn ${count('new-spawn')})`)
} else {
  const REL = Number(flag('--rel-version', '5'))
  const TXT = Number(flag('--text-version', '5'))
  const { lines, classes } = build(REL, TXT, sqliteRows())
  result = { relVersion: REL, textVersion: TXT, lines, classes }
}
fs.writeFileSync(OUT, JSON.stringify(result) + '\n')
console.log(`寫入 ${path.relative(ROOT, OUT)}:${Object.keys(result.classes).length} 類、${result.lines.length} 句`)
for (const [k, v] of Object.entries(result.classes)) console.log(`  ${k}: 底材 ${v.bases.length}、隨機 ${v.explicit.length}、固定 ${v.implicit.length}`)
