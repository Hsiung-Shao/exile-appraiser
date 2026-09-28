// @ts-check
// PoE2 褻瀆(Desecration)詞綴 Tier 資料表:PoB2 `Data/{ModItem,ModJewel,ModVeiled}.lua` + `Data/Bases/*.lua`
// + 本 repo 的 `data/poe2/{en,cmn-Hant}/stats.ndjson` → `data/poe2/desecration/{tiers,base_profiles}.json`,然後重寫
// MANIFEST 的 `data/poe2/desecration` 前綴。
//
//   node scripts/build-desecration-tiers.mjs --from <PoB2 portable 的 Data 目錄> [--no-manifest] [--allow-mismatch]
//   例:node scripts/build-desecration-tiers.mjs --from ../pob-zh-engine/dist/PathOfBuildingCommunity-PoE2-Portable/Data
//
// 邏輯逐段移植自 poenavi `scripts/build_poetore_poe2_desecration_tiers.py`(MIT,Buri_Isono):
//   * lua 逐行 regex 解析(ROW_RE、type/group/level/weightKey/weightVal/modTags/tradeHashes)
//   * Bases → profiles(類別 + 排序後 tags 去重;排除 charm/flask/traptool…;Staff + warstaff tag → quarterstaff)
//   * spawn weight = weightKey 中「第一個」出現在 profile tags 的鍵的值(PoB/遊戲語意)
//   * pool 三類:normal(ModItem/ModJewel 且正權重 tag 含基底 tag)、desecration_exclusive(ModVeiled 且帶
//     ulaman/amanamu/kurgal tag)、desecration_exclusive_jewel(ModVeiled 的 AbyssModJewel*)
//   * 合併重複(pool,type,group,level,tradeHashes 相同)、Tier = 同 (pool,type,group,profile) 內 level 降序
//   * parts:tradeHash → stats.ndjson 的 `trade.ids`(desecrated 優先、其次 explicit)取 `ref`(英文模板)與
//     cmn-Hant 同 `ref` 的 `matchers[0].string`(繁中);ranges 以 `ref` 的 `#` 對 PoB 文字 fullmatch 取得;
//     increased/reduced 極性不一致時翻轉一次並記 `direction`
// 與 poenavi 的差異(本專案):日文模板 → 繁中模板;poenavi 的 stat_index(GGG trade2 文字)→ EE2 stats.ndjson 的 `ref`;
// 版本鎖由 git revision 改為 portable 的 `manifest.xml`(版本號 + 逐檔 sha1,且驗證磁碟上的檔與 manifest 相符)。
// 輸出不含時間戳,同一輸入重跑逐位元組相同。說明見 docs/desecration-tiers.md。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (/** @type {string} */ name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const fromArg = flag('--from')
if (!fromArg) {
  console.error('用法:node scripts/build-desecration-tiers.mjs --from <PoB2 portable 的 Data 目錄> [--no-manifest] [--allow-mismatch]')
  process.exit(2)
}
const DATA = path.resolve(process.env.INIT_CWD ?? process.cwd(), fromArg)
const POB_ROOT = path.dirname(DATA)
const MANIFEST_XML = path.join(POB_ROOT, 'manifest.xml')
const OUT_DIR = path.join(ROOT, 'data', 'poe2', 'desecration')
const STATS_EN = path.join(ROOT, 'data', 'poe2', 'en', 'stats.ndjson')
const STATS_ZH = path.join(ROOT, 'data', 'poe2', 'cmn-Hant', 'stats.ndjson')
const ITEMS_EN = path.join(ROOT, 'data', 'poe2', 'en', 'items.ndjson')
for (const p of [DATA, MANIFEST_XML, STATS_EN, STATS_ZH, ITEMS_EN]) {
  if (!fs.existsSync(p)) {
    console.error(`找不到:${p}`)
    process.exit(2)
  }
}

// ---- 常數(與 poenavi 相同) ----
const NUMBER = String.raw`[+-]?\d+(?:\.\d+)?`
const ROW_RE = /^\s*\["([^"]+)"\] = \{(.*)\},\s*$/
const BASE_RE = /itemBases\["([^"]+)"\]\s*=\s*\{(.*?)\n\}/gs
const RANGE_RE = new RegExp(String.raw`^\(\s*(${NUMBER})\s*-\s*(${NUMBER})\s*\)$`)
const NAMED_DESECRATION_TAGS = new Set(['ulaman_mod', 'amanamu_mod', 'kurgal_mod'])
const JEWEL_TAGS = new Set(['strjewel', 'dexjewel', 'intjewel'])
const BASE_TAGS = new Set([
  'amulet', 'armour', 'axe', 'belt', 'body_armour', 'boots', 'bow',
  'cannon', 'claw', 'crossbow', 'dagger', 'dex_armour', 'dex_int_armour',
  'dexjewel', 'flail', 'focus', 'gloves', 'helmet', 'int_armour',
  'intjewel', 'mace', 'one_hand_weapon', 'quiver', 'ring', 'sceptre',
  'shield', 'spear', 'staff', 'str_armour', 'str_dex_armour',
  'str_dex_int_armour', 'str_int_armour', 'strjewel', 'sword', 'talisman',
  'two_hand_weapon', 'wand', 'warstaff', 'weapon'
])
const EXCLUDED_CATEGORIES = new Set([
  'charm', 'fishing_rod', 'flask', 'incursion_limb', 'transcendent_limb',
  'trap', 'traptool'
])
/** PoB 權重表漏了基底 tag 的兩條(poenavi 手動補) */
const MISSING_PROFILE_OVERRIDES = {
  AbyssModBootsUlamanSuffixReducedMovementPenaltyWhileSkilling: 'boots',
  AbyssModGlovesAmanamuSuffixPercentOfLifeLeechInstant: 'gloves'
}
/** [英文來源字, 英文目標字, 繁中來源字, 繁中目標字, direction](poenavi 為日文 増加/減少) */
const DIRECTION_RULES = /** @type {const} */ ([
  ['increased', 'reduced', '增加', '減少', 'decrease'],
  ['reduced', 'increased', '減少', '增加', 'increase']
])

const readText = (/** @type {string} */ p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Python `str < str` / `list < list` 的字典序(ASCII 內與 JS 預設比較一致) */
const cmpStr = (/** @type {string} */ a, /** @type {string} */ b) => a < b ? -1 : a > b ? 1 : 0
function cmpList (/** @type {string[]} */ a, /** @type {string[]} */ b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = cmpStr(a[i], b[i])
    if (c) return c
  }
  return a.length - b.length
}

// ---- lua 解析 ----
function quotedList (/** @type {string} */ text) {
  return [...text.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(m => m[1])
}
function field (/** @type {string} */ body, /** @type {string} */ name) {
  const m = body.match(new RegExp(`${escapeRe(name)} = "([^"]*)"`))
  return m ? m[1] : ''
}
function numberField (/** @type {string} */ body, /** @type {string} */ name) {
  const m = body.match(new RegExp(`${escapeRe(name)} = (-?\\d+)`))
  return m ? Number(m[1]) : 0
}
/** @returns {Array<[string, number]>} */
function weightRules (/** @type {string} */ body) {
  const k = body.match(/weightKey = \{([^}]*)\}/)
  const v = body.match(/weightVal = \{([^}]*)\}/)
  if (!k || !v) return []
  const keys = quotedList(k[1])
  const values = [...v[1].matchAll(new RegExp(NUMBER, 'g'))].map(m => Number(m[0]))
  const n = Math.min(keys.length, values.length) // Python zip 截短
  return keys.slice(0, n).map((key, i) => [key, values[i]])
}
/** @returns {Array<[string, string[]]>} hash → PoB 顯示文字(保留原順序) */
function tradeHashes (/** @type {string} */ body) {
  const idx = body.indexOf('tradeHashes = {')
  if (idx === -1) return []
  const section = body.slice(idx + 'tradeHashes = {'.length)
  /** @type {Map<string, string[]>} */
  const out = new Map()
  for (const m of section.matchAll(/\[(\d+)\] = \{(.*?)\},/g)) out.set(m[1], quotedList(m[2]))
  return [...out]
}

/**
 * @typedef {{ source: string, mod_id: string, type: string, affix: string, group: string, level: number,
 *   weights: Array<[string, number]>, mod_tags: string[], trade_hashes: Array<[string, string[]]>,
 *   pool?: string, profiles?: string[], tiers?: Record<string, number> }} ModRow
 */
/** @returns {ModRow[]} */
function parseModFile (/** @type {string} */ file, /** @type {string} */ source) {
  /** @type {ModRow[]} */
  const rows = []
  for (const line of readText(file).split('\n')) {
    const m = line.match(ROW_RE)
    if (!m) continue
    const [, modId, body] = m
    const tags = body.match(/modTags = \{([^}]*)\}/)
    rows.push({
      source,
      mod_id: modId,
      type: field(body, 'type'),
      affix: field(body, 'affix'),
      group: field(body, 'group'),
      level: numberField(body, 'level'),
      weights: weightRules(body),
      mod_tags: tags ? quotedList(tags[1]) : [],
      trade_hashes: tradeHashes(body)
    })
  }
  return rows
}

const categoryKey = (/** @type {string} */ v) => v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
/** PoB 把 PoE2 的長杖與細杖(Quarterstaff)共用 `Staff` 類別,以 warstaff tag 拆開 */
const concreteBaseCategory = (/** @type {string} */ c, /** @type {string[]} */ tags) => c === 'staff' && tags.includes('warstaff') ? 'quarterstaff' : c

/** @typedef {{ id: string, category: string, tags: string[] }} Profile */
/** @returns {{ profiles: Profile[], baseToKey: Map<string, string> }} */
function parseBaseProfiles (/** @type {string} */ basesDir) {
  /** @type {Map<string, { category: string, tags: string[] }>} */
  const byKey = new Map()
  /** @type {Map<string, string>} 基底英文名 → profile 鍵 */
  const baseToKey = new Map()
  for (const name of fs.readdirSync(basesDir).filter(f => f.endsWith('.lua')).sort()) {
    const text = readText(path.join(basesDir, name))
    for (const m of text.matchAll(BASE_RE)) {
      const [, baseName, body] = m
      const t = body.match(/\btype = "([^"]+)"/)
      const tg = body.match(/\btags = \{([^}]*)\}/)
      if (!t || !tg) continue
      let category = categoryKey(t[1])
      if (EXCLUDED_CATEGORIES.has(category)) continue
      const tags = [...new Set([...tg[1].matchAll(/([a-z0-9_]+)\s*=\s*true/g)].map(x => x[1]))].sort(cmpStr)
      if (!tags.length) continue
      category = concreteBaseCategory(category, tags)
      const key = category + '|' + tags.join(',')
      if (!byKey.has(key)) byKey.set(key, { category, tags })
      if (!baseToKey.has(baseName)) baseToKey.set(baseName, key)
    }
  }
  const sorted = [...byKey.entries()].sort(([, a], [, b]) => cmpStr(a.category, b.category) || cmpList(a.tags, b.tags))
  /** @type {Profile[]} */
  const profiles = sorted.map(([, p], i) => ({ id: `p${String(i).padStart(3, '0')}`, ...p }))
  const keyToId = new Map(sorted.map(([k], i) => [k, profiles[i].id]))
  return { profiles, baseToKey: new Map([...baseToKey].map(([n, k]) => [n, /** @type {string} */ (keyToId.get(k))])) }
}

function spawnWeight (/** @type {ModRow} */ row, /** @type {Profile} */ profile) {
  const tags = new Set(profile.tags)
  for (const [key, value] of row.weights) if (tags.has(key)) return value
  return 0
}

/** @returns {ModRow[]} */
function classify (/** @type {ModRow[]} */ rows, /** @type {Profile[]} */ profiles) {
  /** @type {ModRow[]} */
  const selected = []
  for (const row of rows) {
    const modTags = new Set(row.mod_tags)
    const positive = row.weights.filter(([, v]) => v > 0).map(([k]) => k)
    let pool
    if ((row.source === 'ModItem' || row.source === 'ModJewel') && positive.some(t => BASE_TAGS.has(t))) pool = 'normal'
    else if (row.source === 'ModVeiled' && [...modTags].some(t => NAMED_DESECRATION_TAGS.has(t))) pool = 'desecration_exclusive'
    else if (row.source === 'ModVeiled' && row.mod_id.startsWith('AbyssModJewel')) pool = 'desecration_exclusive_jewel'
    else continue
    let applicable = profiles.filter(p => spawnWeight(row, p) > 0).map(p => p.id)
    const override = /** @type {Record<string, string>} */ (MISSING_PROFILE_OVERRIDES)[row.mod_id]
    if (override) applicable = profiles.filter(p => p.category === override).map(p => p.id)
    if (pool === 'desecration_exclusive_jewel') {
      applicable = profiles.filter(p => p.tags.some(t => JEWEL_TAGS.has(t)) && spawnWeight(row, p) > 0).map(p => p.id)
    }
    if (!applicable.length || !row.trade_hashes.length) continue
    selected.push({ ...row, pool, profiles: applicable })
  }
  return selected
}

/** Python `json.dumps(trade_hashes, sort_keys=True)` 的等價簽章 */
const hashesSignature = (/** @type {ModRow} */ row) => JSON.stringify([...row.trade_hashes].sort(([a], [b]) => cmpStr(a, b)))

function mergeDuplicateRecords (/** @type {ModRow[]} */ rows) {
  /** @type {Map<string, ModRow>} */
  const merged = new Map()
  for (const row of rows) {
    const sig = JSON.stringify([row.pool, row.type, row.group, row.level, hashesSignature(row)])
    const cur = merged.get(sig)
    if (!cur) { merged.set(sig, row); continue }
    cur.mod_id += ';' + row.mod_id
    cur.profiles = [...new Set([...(cur.profiles ?? []), ...(row.profiles ?? [])])].sort(cmpStr)
    cur.mod_tags = [...new Set([...cur.mod_tags, ...row.mod_tags])]
  }
  return [...merged.values()]
}

function assignProfileTiers (/** @type {ModRow[]} */ rows) {
  /** @type {Map<string, ModRow[]>} */
  const buckets = new Map()
  for (const row of rows) {
    for (const pid of row.profiles ?? []) {
      const k = JSON.stringify([row.pool, row.type, row.group, pid])
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k)?.push(row)
    }
  }
  /** @type {Map<string, Record<string, number>>} */
  const tiers = new Map()
  for (const [k, cands] of buckets) {
    const pid = JSON.parse(k)[3]
    const levels = [...new Set(cands.map(r => r.level))].sort((a, b) => b - a)
    for (const r of cands) {
      if (!tiers.has(r.mod_id)) tiers.set(r.mod_id, {})
      const rec = tiers.get(r.mod_id); if (rec) rec[pid] = levels.indexOf(r.level) + 1
    }
  }
  for (const row of rows) row.tiers = tiers.get(row.mod_id) ?? {}
}

// ---- stats.ndjson ----
/** @typedef {{ ref: string, matchers: Array<{ string: string }>, trade?: { ids?: Record<string, string[]> } }} StatLine */
function readNdjson (/** @type {string} */ file) {
  return /** @type {any[]} */ (readText(file).split('\n').filter(Boolean).map(l => JSON.parse(l)))
}
/** hash → { desecrated?: StatLine, explicit?: StatLine }(檔案順序第一筆) */
function loadStats () {
  /** @type {Map<string, { desecrated?: StatLine, explicit?: StatLine }>} */
  const byHash = new Map()
  for (const s of /** @type {StatLine[]} */ (readNdjson(STATS_EN))) {
    for (const kind of /** @type {const} */ (['desecrated', 'explicit'])) {
      for (const id of s.trade?.ids?.[kind] ?? []) {
        const m = id.match(/^(desecrated|explicit)\.stat_(\d+)$/)
        if (!m || m[1] !== kind) continue
        const slot = byHash.get(m[2]) ?? {}
        slot[kind] ??= s
        byHash.set(m[2], slot)
      }
    }
  }
  /** @type {Map<string, string>} */
  const zhByRef = new Map()
  for (const s of /** @type {StatLine[]} */ (readNdjson(STATS_ZH))) {
    if (!zhByRef.has(s.ref) && s.matchers?.[0]) zhByRef.set(s.ref, s.matchers[0].string)
  }
  return { byHash, zhByRef }
}

/** @returns {number[][] | null} */
function valueRanges (/** @type {string} */ template, /** @type {string} */ rendered) {
  template = template.replace(/\s*\(Local\)\s*$/i, '')
  const token = String.raw`\+?(?:\(\s*${NUMBER}\s*-\s*${NUMBER}\s*\)|${NUMBER})`
  let pattern = ''
  let captures = 0
  for (const part of template.split(/(#)/)) {
    if (part === '#') { pattern += `(${token})`; captures++ } else pattern += escapeRe(part)
  }
  const m = rendered.match(new RegExp(`^(?:${pattern})$`, 'i'))
  if (!m || m.length - 1 !== captures) return null
  return m.slice(1).map(value => {
    const comparable = value.startsWith('+(') ? value.slice(1) : value
    const r = comparable.match(RANGE_RE)
    if (r) return [Number(r[1]), Number(r[2])]
    const n = Number(comparable)
    return [n, n]
  })
}

function resolveDirectionalPart (/** @type {string} */ en, /** @type {string} */ zh, /** @type {string} */ rendered) {
  for (const [src, dst, zhSrc, zhDst, direction] of DIRECTION_RULES) {
    if ((en.match(new RegExp(`\\b${src}\\b`, 'gi')) ?? []).length !== 1) continue
    if (zh.split(zhSrc).length - 1 !== 1) continue
    const adjustedEn = en.replace(new RegExp(`\\b${src}\\b`, 'i'), dst)
    const ranges = valueRanges(adjustedEn, rendered)
    if (!ranges) continue
    return {
      en: adjustedEn,
      zh: zh.replace(zhSrc, zhDst),
      ranges: ranges.map(([lo, hi]) => [Math.min(Math.abs(lo), Math.abs(hi)), Math.max(Math.abs(lo), Math.abs(hi))]),
      direction
    }
  }
  return null
}

function buildParts (/** @type {ModRow} */ row, /** @type {ReturnType<typeof loadStats>} */ stats) {
  const parts = []
  for (const [hash, descriptions] of row.trade_hashes) {
    const slot = stats.byHash.get(hash)
    const stat = slot?.desecrated ?? slot?.explicit
    if (!stat) continue
    const en = stat.ref
    const zh = stats.zhByRef.get(stat.ref) ?? ''
    // exile-appraiser 追加:模板本身跨兩行(`…gain an\nadditional…`)而 PoB 把它拆成兩段文字 → 接回一段
    const lines = en.includes('\n') && descriptions.length === en.split('\n').length ? [descriptions.join('\n')] : descriptions
    for (const description of lines) {
      let ranges = valueRanges(en, description)
      const directional = ranges ? null : resolveDirectionalPart(en, zh, description)
      if (directional) ranges = directional.ranges
      // exile-appraiser 追加(poenavi 沒有):`ref` 對不上時,改用同一列的其他英文 matcher(單複數 / 措辭變體,
      // 同一個 stat 所以仍是語言無關對接);negate matcher 會翻轉數值語意,不採用
      let viaMatcher
      if (!ranges) {
        for (const m of stat.matchers ?? []) {
          if (/** @type {any} */ (m).negate || m.string === en) continue
          const r = valueRanges(m.string, description)
          if (r) { ranges = r; viaMatcher = m.string; break }
        }
      }
      /** @type {Record<string, unknown>} */
      const part = {
        stat_hash: hash,
        stat_id: `desecrated.stat_${hash}`,
        ref: stat.ref,
        text: { en: directional ? directional.en : en, zh: directional ? directional.zh : zh },
        ranges,
        source_text: description
      }
      if (directional) part.direction = directional.direction
      if (viaMatcher) part.matched_template = viaMatcher
      parts.push(part)
    }
  }
  return parts
}

function templateAudit (/** @type {any[]} */ entries) {
  const mixed = []
  /** @type {Map<string, Set<string>>} */
  const skeletons = new Map()
  for (const e of entries) {
    for (const p of e.parts) {
      const t = String(p.text.zh)
      if (t.includes('#') && /\d/.test(t)) mixed.push({ mod_id: e.mod_id, template: t })
      const sk = t.replace(new RegExp(NUMBER, 'g'), '#')
      if (!skeletons.has(sk)) skeletons.set(sk, new Set())
      skeletons.get(sk)?.add(t)
    }
  }
  return {
    mixed_fixed_dynamic_parts: mixed.length,
    mixed_fixed_dynamic_templates: new Set(mixed.map(m => m.template)).size,
    numeric_skeleton_collisions: [...skeletons].sort(([a], [b]) => cmpStr(a, b))
      .filter(([, s]) => s.size > 1).map(([numeric_skeleton, s]) => ({ numeric_skeleton, templates: [...s].sort(cmpStr) }))
  }
}

// ---- 版本鎖 ----
const manifestXml = readText(MANIFEST_XML)
const pob2Version = manifestXml.match(/<Version [^>]*number="([^"]+)"/)?.[1]
if (!pob2Version) {
  console.error(`manifest.xml 讀不到版本號:${MANIFEST_XML}`)
  process.exit(1)
}
const sha1 = (/** @type {Buffer} */ b) => crypto.createHash('sha1').update(b).digest('hex')
const sha256 = (/** @type {string} */ p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
/** @type {Record<string, string>} */
const pob2Files = {}
const mismatched = []
const basesDir = path.join(DATA, 'Bases')
const lockedFiles = [
  'Data/ModItem.lua', 'Data/ModJewel.lua', 'Data/ModVeiled.lua',
  ...fs.readdirSync(basesDir).filter(f => f.endsWith('.lua')).sort().map(f => `Data/Bases/${f}`)
]
for (const rel of lockedFiles) {
  const want = manifestXml.match(new RegExp(`<File name="${escapeRe(rel)}"[^>]*sha1="([0-9a-f]+)"`))?.[1]
  const buf = fs.readFileSync(path.join(POB_ROOT, rel))
  // 與 PoB 自己的 UpdateCheck.lua 相同:sha1(content) 或 sha1(content 的 LF 換成 CRLF)任一相符即可
  // (manifest 記的是 CRLF 版,portable 磁碟上是 LF)
  const got = sha1(buf)
  const gotCrlf = sha1(Buffer.from(buf.toString('latin1').replace(/\n/g, '\r\n'), 'latin1'))
  if (!want) mismatched.push(`${rel}:manifest.xml 沒有這個檔`)
  else if (want !== got && want !== gotCrlf) mismatched.push(`${rel}:manifest ${want} ≠ 實際 ${got} / ${gotCrlf}`)
  pob2Files[rel] = want ?? got
}
if (mismatched.length && !args.includes('--allow-mismatch')) {
  console.error('PoB2 檔案與 manifest.xml 不符(PoB2 自己更新到一半?),拒絕產生:\n  ' + mismatched.join('\n  '))
  process.exit(1)
}
const poe2Manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'MANIFEST.json'), 'utf8'))
const statsCommit = poe2Manifest.sources?.['data/poe2']?.commit ?? null

// ---- 產生 ----
const { profiles, baseToKey } = parseBaseProfiles(basesDir)
/** @type {ModRow[]} */
const allRows = []
for (const [file, source] of [['ModItem.lua', 'ModItem'], ['ModJewel.lua', 'ModJewel'], ['ModVeiled.lua', 'ModVeiled']]) {
  allRows.push(...parseModFile(path.join(DATA, file), source))
}
const rows = mergeDuplicateRecords(classify(allRows, profiles))
assignProfileTiers(rows)
const stats = loadStats()
const entries = []
const skipped = []
const polarity = []
for (const row of rows) {
  const parts = buildParts(row, stats)
  // 每個 tradeHash 至少要有一個 part(stats.ndjson 查不到 → 不完整),且每個 part 都要有 ranges
  const covered = new Set(parts.map(p => p.stat_hash))
  if (row.trade_hashes.some(([h]) => !covered.has(h)) || parts.some(p => p.ranges == null)) skipped.push(row.mod_id)
  if (parts.some(p => 'direction' in p)) polarity.push(row.mod_id)
  entries.push({
    mod_id: row.mod_id,
    pool: row.pool,
    type: row.type,
    group: row.group,
    required_level: row.level,
    profile_tiers: row.tiers,
    // exile-appraiser 追加:三神專屬詞綴屬於哪位神(modTags 的 ulaman_mod / amanamu_mod / kurgal_mod),UI 顯示 pool 名用
    ...(row.pool === 'desecration_exclusive' ? { gods: row.mod_tags.filter(t => NAMED_DESECRATION_TAGS.has(t)).map(t => t.replace(/_mod$/, '')).sort(cmpStr) } : {}),
    parts
  })
}
entries.sort((a, b) => cmpStr(/** @type {string} */ (a.pool), /** @type {string} */ (b.pool)) || cmpStr(a.mod_id, b.mod_id))
/** @type {Record<string, number>} */
const byPool = {}
for (const e of entries) byPool[/** @type {string} */ (e.pool)] = (byPool[/** @type {string} */ (e.pool)] ?? 0) + 1

// base_profiles:items.ndjson(en)的 ITEM refName 直接對 Bases 鍵;UNIQUE 經 `unique.base`,所有底材同一 profile 才收
/** @type {Record<string, string>} */
const baseProfiles = {}
const unmappedItems = []
/** @type {Map<string, Set<string>>} */
const uniqueProfiles = new Map()
for (const it of readNdjson(ITEMS_EN)) {
  if (it.namespace === 'ITEM') {
    const cat = it.craftable?.category
    const pid = baseToKey.get(it.refName)
    if (pid) baseProfiles[it.refName] = pid
    else if (cat && /armour|weapon|jewel|ring|amulet|belt|quiver|focus|shield|boots|gloves|helmet|staff|wand|sceptre|bow|mace|spear|claw|dagger|sword|axe|flail|talisman|crossbow/i.test(cat)) unmappedItems.push(it.refName)
  } else if (it.namespace === 'UNIQUE' && it.unique?.base) {
    const pid = baseToKey.get(it.unique.base)
    if (!uniqueProfiles.has(it.refName)) uniqueProfiles.set(it.refName, new Set())
    uniqueProfiles.get(it.refName)?.add(pid ?? '?')
  }
}
let uniqueMapped = 0
for (const [name, set] of uniqueProfiles) {
  if (set.size === 1 && !set.has('?') && !baseProfiles[name]) {
    baseProfiles[name] = /** @type {string} */ ([...set][0])
    uniqueMapped++
  }
}
const sortedBaseProfiles = Object.fromEntries(Object.entries(baseProfiles).sort(([a], [b]) => cmpStr(a, b)))

const source = {
  pob2: 'https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2',
  pob2Version,
  files: pob2Files,
  statsCommit,
  statsSha256: {
    'en/stats.ndjson': sha256(STATS_EN),
    'cmn-Hant/stats.ndjson': sha256(STATS_ZH),
    'en/items.ndjson': sha256(ITEMS_EN)
  },
  tierDerivation: 'required levels descending within pool/type/group/base-tag profile(poenavi build_poetore_poe2_desecration_tiers.py)'
}
const tiers = {
  schema: 1,
  source,
  profiles,
  entries,
  diagnostics: {
    selected_rows: rows.length,
    emitted_rows: entries.length,
    by_pool: byPool,
    fully_matchable_rows: entries.length - skipped.length,
    rows_with_unparsed_parts: skipped.sort(cmpStr),
    polarity_adjusted_rows: polarity.sort(cmpStr),
    ...templateAudit(entries),
    base_profiles: {
      mapped: Object.keys(sortedBaseProfiles).length,
      uniques_mapped: uniqueMapped,
      unmapped_equipment_refnames: [...new Set(unmappedItems)].sort(cmpStr)
    }
  }
}
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, 'tiers.json'), JSON.stringify(tiers) + '\n')
fs.writeFileSync(path.join(OUT_DIR, 'base_profiles.json'), JSON.stringify({ schema: 1, pob2Version, profiles: sortedBaseProfiles }, null, 1) + '\n')

console.log(`PoB2 ${pob2Version}(${mismatched.length ? `⚠ ${mismatched.length} 個檔與 manifest 不符` : 'manifest.xml sha1 全符'})`)
console.log(`profiles: ${profiles.length}`)
console.log(`entries: ${entries.length}(${Object.entries(byPool).map(([k, v]) => `${k} ${v}`).join(' / ')})`)
console.log(`fully matchable: ${entries.length - skipped.length};unparsed: ${skipped.length};polarity adjusted: ${polarity.length}`)
console.log(`zh mixed fixed/dynamic parts: ${tiers.diagnostics.mixed_fixed_dynamic_parts};numeric skeleton collisions: ${tiers.diagnostics.numeric_skeleton_collisions.length}`)
console.log(`base_profiles: ${Object.keys(sortedBaseProfiles).length}(unique ${uniqueMapped});未對上的裝備 refName ${tiers.diagnostics.base_profiles.unmapped_equipment_refnames.length}`)

if (!args.includes('--no-manifest')) {
  execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'), '--write', '--prefix', 'data/poe2/desecration',
    '--commit', pob2Files['Data/ModVeiled.lua'],
    '--source', `PoB2 ${pob2Version} Data/*.lua + stats.ndjson`,
    '--path', 'scripts/build-desecration-tiers.mjs(PathOfBuildingCommunity-PoE2-Portable/Data;commit 欄 = manifest.xml 的 ModVeiled.lua sha1)'
  ], { stdio: 'inherit' })
}
