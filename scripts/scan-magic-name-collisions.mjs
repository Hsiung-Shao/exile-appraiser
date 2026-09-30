// @ts-check
// PoE2 魔法物品名「詞綴名 × 底材名」碰撞掃描 → poe2/test/Parser/fixtures/magic-name-collisions.json
//   node scripts/scan-magic-name-collisions.mjs --from ../pob-zh-engine [--check]
//
// 為什麼:魔法物品只有一行名稱(前綴 + 底材 + 後綴),parser 的 `magicBasetype`(poe2/src/parser/magic-name.ts)
// 靠「名稱的子字串哪個是物品名」找底材。詞綴名本身含另一個物品名時就可能挑錯
// (繁中「昇華的幻像異界之譫妄碑牌」→ 後綴 `幻像異界之` 裡的碎片名「幻像異界」)。
//
// 來源(GGPK = 第一真值):
//   * 詞綴名:`<from>/tools/ggpk2_zh/out/poe2/categories/affixes.json`(Mods 表 Name 欄,en / tc 同列,以 mod Id 對接)
//     ⚠ 這份抽取沒有 Domain / GenerationType,**無法只挑「會出在該底材上的詞綴」**,所以結果是過度涵蓋的
//       「潛在」碰撞(含怪物詞綴、精髓名等不會出在物品名上的)。前後綴:繁中不分(名稱一律 `{詞綴}{底材}`);
//       英文以 `of ` 開頭判為後綴(`{底材} {詞綴}`),其餘為前綴(`{詞綴} {底材}`)——PoB2 ModItem 的 3,056 條
//       前後綴有 41 條例外,例外只影響組句位置,不影響「是否含物品名」。
//   * 底材與候選物品名:本 repo `data/poe2/{en,cmn-Hant}/items.ndjson`(ITEM、有 craftable)+ `data/poe2/trade/intl/items.json`,
//     查法與 magicBasetype 相同(refName / name 第一筆的 craftable;查不到再查交易站 type / text)。
//     底材排除不會是魔法的類別(NOT_MAGIC)。
//
// 「潛在碰撞」定義(與演算法無關):組出的名稱裡,存在一個**不是底材本身**、長度 ≥ 底材的候選物品名
// (上游只比長度、同長取先出現,這些組合都有風險)。回歸測試 poe2/test/Parser/magic-name-collisions.test.ts
// 對每一組跑真正的 magicBasetype,必須還原出底材;名稱本身有歧義的(詞綴 + 底材恰好拼成另一個物品名)列在測試檔的已知清單。
//
// 守門(exit 1):魔法可出的英文底材名含 ` of `(magic-name.ts 的英文位置規則假設沒有)。
// 輸出不含時間戳:同一份來源重跑逐位元組相同。`--check` 只比對不寫檔(不同 → exit 1)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (/** @type {string} */ name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const fromArg = flag('--from')
if (!fromArg) {
  console.error('用法:node scripts/scan-magic-name-collisions.mjs --from <pob-zh-engine 路徑> [--check]')
  process.exit(2)
}
const GG = path.join(path.resolve(ROOT, fromArg), 'tools', 'ggpk2_zh', 'out', 'poe2')
const DATA = path.join(ROOT, 'data', 'poe2')
const OUT = path.join(ROOT, 'poe2', 'test', 'Parser', 'fixtures', 'magic-name-collisions.json')

/** 不會以魔法稀有度出現的類別(對應 ItemCategory 值) */
const NOT_MAGIC = [
  'Breachstone', 'BrequelFruit', 'Currency', 'Incubator', 'MapFragment', 'MiscMapItem',
  'Omen', 'PinnacleKey', 'QuestItem', 'SoulCore', 'UncutSkillGem', 'VaultKey'
]

const readJson = (/** @type {string} */ p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const readNd = (/** @type {string} */ p) =>
  fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))

const meta = readJson(path.join(GG, 'meta.json'))
/** @type {Array<{id: string, table: string, column: string, en: string, tc: string}>} */
const affixes = readJson(path.join(GG, 'categories', 'affixes.json'))
const tradeItems = readJson(path.join(DATA, 'trade', 'intl', 'items.json'))
/** @type {Set<string>} */
const tradeSet = new Set()
for (const c of tradeItems.result) {
  for (const e of c.entries) {
    if (e.type) tradeSet.add(e.type)
    if (e.text) tradeSet.add(e.text)
  }
}

const usable = (/** @type {string} */ s) => !!s && !/[<>{}[\]\r\n]/.test(s) && !/DNT/.test(s)

/** @param {'en' | 'cmn-Hant'} lang */
function scan (lang) {
  const items = readNd(path.join(DATA, lang, 'items.ndjson')).filter((i) => i.namespace === 'ITEM')
  /** @type {Map<string, any>} */ const byRef = new Map()
  /** @type {Map<string, any>} */ const byName = new Map()
  for (const i of items) {
    if (!byRef.has(i.refName)) byRef.set(i.refName, i)
    if (!byName.has(i.name)) byName.set(i.name, i)
  }
  // 與 magicBasetype 相同:ITEM_BY_REF ?? ITEM_BY_TRANSLATED 的第一筆有 craftable;查不到才看交易站
  const isCandidate = (/** @type {string} */ s) => {
    const r = byRef.get(s) ?? byName.get(s)
    if (r) return !!r.craftable
    return tradeSet.has(s)
  }
  const bases = [...new Set(items
    .filter((i) => i.craftable && !NOT_MAGIC.includes(i.craftable.category))
    .map((i) => i.name))].sort()

  if (lang === 'en') {
    const bad = bases.filter((b) => / of /.test(b))
    if (bad.length) {
      console.error(`魔法可出的英文底材名含 " of ",magic-name.ts 的英文位置規則不成立:${bad.join(', ')}`)
      process.exit(1)
    }
  }

  /** @type {Map<string, Set<string>>} 名稱 → mod Id */
  const names = new Map()
  for (const a of affixes) {
    const n = lang === 'en' ? a.en : a.tc
    if (!usable(n)) continue
    if (!names.has(n)) names.set(n, new Set())
    names.get(n)?.add(a.id)
  }

  const cases = []
  let combos = 0
  for (const affix of [...names.keys()].sort()) {
    const suffix = lang === 'en' && affix.startsWith('of ')
    const hits = []
    for (const base of bases) {
      combos++
      const composed = lang === 'en' ? (suffix ? `${base} ${affix}` : `${affix} ${base}`) : `${affix}${base}`
      const sep = lang === 'en' ? ' ' : ''
      const words = lang === 'en' ? composed.split(' ') : [...composed]
      let risky = false
      for (let s = 0; s < words.length && !risky; s++) {
        for (let e = s + 1; e <= words.length; e++) {
          const c = words.slice(s, e).join(sep)
          if (c !== base && c.length >= base.length && isCandidate(c)) { risky = true; break }
        }
      }
      if (risky) hits.push(base)
    }
    if (hits.length) {
      cases.push({ affix, form: lang === 'en' ? (suffix ? 'suffix' : 'prefix') : 'any', modIds: [...(names.get(affix) ?? [])].sort(), bases: hits })
    }
  }
  const total = cases.reduce((n, c) => n + c.bases.length, 0)
  console.log(`${lang}:詞綴名 ${names.size} × 底材 ${bases.length} = ${combos} 組;潛在碰撞 ${total} 組(詞綴名 ${cases.length})`)
  for (const c of cases) {
    console.log(`  ${JSON.stringify(c.affix)} [${c.modIds.slice(0, 3).join(', ')}${c.modIds.length > 3 ? ', …' : ''}] × ${c.bases.length}:${c.bases.slice(0, 4).join('、')}${c.bases.length > 4 ? '…' : ''}`)
  }
  // 很多詞綴撞到的底材清單完全相同(例如「所有 ≤ 4 字的底材」),存成共用表以免 fixture 過大
  /** @type {string[]} */ const keys = []
  /** @type {string[][]} */ const baseSets = []
  const compact = cases.map((c) => {
    const key = c.bases.join('\n')
    let i = keys.indexOf(key)
    if (i === -1) { i = keys.length; keys.push(key); baseSets.push(c.bases) }
    return { affix: c.affix, form: c.form, modIds: c.modIds, baseSet: i }
  })
  return { affixNames: names.size, bases: bases.length, combos, total, cases: compact, baseSets }
}

const out = {
  source: {
    ggpk: `ggpk2_zh out/poe2 categories/affixes.json(game_version ${meta.game_version})`,
    items: 'data/poe2/{en,cmn-Hant}/items.ndjson + data/poe2/trade/intl/items.json'
  },
  note: '由 scripts/scan-magic-name-collisions.mjs 產生;不手改。組句:cmn-Hant `{affix}{base}`;en form=prefix `{affix} {base}`、form=suffix `{base} {affix}`',
  notMagicCategories: NOT_MAGIC,
  languages: { 'cmn-Hant': scan('cmn-Hant'), en: scan('en') }
}
const text = JSON.stringify(out, null, 1) + '\n'
if (args.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  if (cur !== text) {
    console.error(`${path.relative(ROOT, OUT)} 與重新掃描結果不同`)
    process.exit(1)
  }
  console.log('一致')
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, text)
  console.log(`寫出 ${path.relative(ROOT, OUT)}`)
}
