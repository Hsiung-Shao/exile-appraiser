// 類型掃描的輸入:依物品類型列出「這類物品會出現的詞綴句子」(中英各一句),給 poe1/test/type-sweep.test.ts 用。
//
//   node scripts/poe1-season/dump-type-sweep.mjs [--rel-version 3] [--text-version 4] [--out poe1/test/docs/type-sweep.json]
//
// 來源是維護者本機的 GGPK 版本庫(docker `supabase_db_pobtools-ggpk-db`,只讀):
//   哪類物品會出現哪些詞綴 = rel_mod(domain / 產生方式)+ rel_mod_spawn(標籤權重)+ rel_base_item(_tag / _implicit)
//   句子 = ggpk_stat(描述檔;依詞綴數值挑條件相符的那一句)
// 句子是照 GGPK 組的,不是實機剪貼簿:數值只取詞綴上下限,顯示前的換算(除以 60 之類)沒做 —— 解析器不看數值大小。
// shortcut: 關聯表只匯到 3.29.3(--rel-version),3.30 才有的詞綴不在裡面;import-rel 補上 3.30 後改 --rel-version。
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const flag = (/** @type {string} */ n, /** @type {string} */ d) => args.includes(n) ? args[args.indexOf(n) + 1] : d
const REL = Number(flag('--rel-version', '3'))
const TXT = Number(flag('--text-version', '4'))
const OUT = path.resolve(ROOT, flag('--out', 'poe1/test/docs/type-sweep.json'))

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
/** `[連結|顯示文字]` 留顯示文字;`{0}` 換數值(`{0:+d}` 帶正負號) */
function fill (/** @type {string} */ text, /** @type {number[]} */ vals) {
  let seq = -1
  return text.replace(/\\n/g, '\n').replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1').replace(/\[([^\]]*)\]/g, '$1')
    .replace(/\{(\d*)(?::([^}]*))?\}/g, (_, i, fmt) => {
      seq += 1
      const v = vals[i === '' ? seq : Number(i)] ?? 0
      return (fmt ?? '').includes('+') && v >= 0 ? `+${v}` : String(v)
    })
}
/** 一個詞綴 → 它印出來的句子(數值各取下限與上限一次) */
function linesOfMod (/** @type {string} */ modId, /** @type {string} */ domain) {
  const stats = statsOf.get(modId) ?? []
  const files = FILES_OF(domain)
  /** @type {{ en: string, zh: string }[]} */
  const out = []
  const done = new Set()
  for (const pick of ['min', 'max']) {
    const val = new Map(stats.map(s => [s.stat_id, Number(s[pick])]))
    for (const s of stats) {
      const mine = blocksOf.get(s.stat_id)?.map(r => r.b) ?? []
      const b = files.map(f => mine.find(x => x.file === f)).find(Boolean)
      if (!b) continue
      const vals = b.ids.map((/** @type {string} */ id) => val.get(id) ?? 0)
      if (vals.every((/** @type {number} */ v) => v === 0)) continue
      const row = b.rows.find((/** @type {any} */ r) => r.cond.split(' ').every((/** @type {string} */ t, /** @type {number} */ i) => condOk(t, vals[i])))
      if (!row?.en || !row.zh) continue
      // 顯示前取負號的數值(handlers 的 negate,第幾個從 1 起算)
      const shown = vals.map((/** @type {number} */ v, /** @type {number} */ i) => (row.handlers ?? []).some((/** @type {any[]} */ h) => h[0] === 'negate' && Number(h[1]) === i + 1) ? -v : v)
      const line = { en: fill(row.en, shown), zh: fill(row.zh, shown) }
      if (!done.has(line.en)) { done.add(line.en); out.push(line) }
    }
  }
  return out
}

/** @type {Record<string, any>} */
const out = {}
/** @type {string[][]} */
const lines = []
const lineIx = new Map()
const add = (/** @type {{en: string, zh: string}} */ l) => {
  // 只差數字的句子算同一句(解析器不看數值大小),留第一個當樣本
  const k = JSON.stringify([l.en, l.zh]).replace(/\d+(?:\.\d+)?/g, '#')
  if (!lineIx.has(k)) { lineIx.set(k, lines.length); lines.push([l.en, l.zh]) }
  return lineIx.get(k)
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
      for (const l of linesOfMod(m.mod_id, m.domain)) sets[GEN_TYPE[m.gen]].add(add(l))
    }
    for (const i of implOf.get(b.item_id) ?? []) {
      for (const l of linesOfMod(i.mod_id, modById.get(i.mod_id)?.domain ?? b.domain)) sets.implicit.add(add(l))
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
fs.writeFileSync(OUT, JSON.stringify({ relVersion: REL, textVersion: TXT, lines, classes: out }) + '\n')
console.log(`寫入 ${path.relative(ROOT, OUT)}:${Object.keys(out).length} 類、${lines.length} 句`)
for (const [k, v] of Object.entries(out)) console.log(`  ${k}: 底材 ${v.bases.length}、隨機 ${v.explicit.length}、固定 ${v.implicit.length}`)
