// @ts-check
// Poe Regex 演算法頁的標籤暫代檔:PobTools 維護者管線的 clientstrings 抽取結果 → data/regex/labels.poe{1,2}.json。
//   node regex/scripts/gen-labels.mjs --from ../pob-zh-engine
//
// 為什麼有這支:PobTools 產生器升到 schema 2 後,`regex_poe*.json` 頂層會自帶 `labels{zh,en}`(regex/src/data.ts 優先讀它);
// 在那之前用這份暫代檔讓演算法頁可以跑。來源只有一個:
//   pob-zh-engine/tools/ggpk_zh/out/poe1/tables/clientstrings.json(PoE1 GGPK 抽取,欄 `Text`)
//   pob-zh-engine/tools/ggpk2_zh/out/poe2/tables/clientstrings.json(PoE2 GGPK 抽取,欄 `Text`)
// 以 clientstrings 的 **鍵**(語言無關)取值,不按位置;`{0}` → `#`、PoE2 的 `[Id|文字]` 剝成文字(與 data.ts normalizeLabel 相同)。
// 交叉比對:每個標籤到 regex_poe*.json 的 ambient 行(同樣出自 GGPK,由 PobTools 產生器取)找一次,找得到 = 兩條管線一致;
// 找不到的列出英文(不是錯,只是沒有第二個來源背書)。缺鍵 → exit 1(不猜)。
// 寫完呼叫 verify-data-manifest 重寫這兩個檔自己的前綴(每個檔一個來源紀錄,不併進 data/regex 的 PobTools 同步前綴)。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const flag = (/** @type {string} */ name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const FROM = path.resolve(ROOT, flag('--from') ?? '../pob-zh-engine')

/** 演算法頁用到的鍵(regex/src/pages/*.ts 的 LABEL_KEYS 必須是它的子集;測試會檢查) */
const KEYS = {
  poe1: [
    'ItemDisplayMapTier', 'ItemDisplayMapQuantityIncrease', 'ItemDisplayMapRarityIncrease', 'ItemDisplayMapPackSizeIncrease',
    'ItemDisplayMapScarabDropBonus', 'ItemDisplayMapCurrencyDropBonus', 'ItemDisplayMapMapDropBonus',
    'ItemDisplayMapDivinationCardDropBonus',
    'ItemLevelPopup', 'Quality', 'ItemDisplayStringSockets', 'ItemPopupCorrupted', 'Level',
    'ItemPopupShaperItem', 'ItemPopupElderItem', 'ItemPopupCrusaderItem', 'ItemPopupRedeemerItem',
    'ItemPopupHunterItem', 'ItemPopupWarlordItem', 'ItemPopupSearingExarchItem', 'ItemPopupEaterofWorldsItem',
    'ItemDisplayStringRarity', 'ItemDisplayStringNormal', 'ItemDisplayStringMagic', 'ItemDisplayStringRare', 'ItemDisplayStringUnique'
  ],
  poe2: [
    'ItemDisplayMapTier', 'ItemDisplayMapItemRarity', 'ItemDisplayMapPack', 'ItemDisplayMapMonsterRarity',
    'ItemDisplayMapWaystoneDropChance', 'ItemDisplayMapMagicMonsterQuantityBonus', 'ItemDisplayMapRareMonsterQuantityBonus',
    'ItemDisplayMapExperienceGained', 'ItemDisplayMapMonsterEffectiveness',
    'ItemLevelPopup', 'Quality', 'ItemDisplayStringSockets', 'ItemPopupCorrupted', 'Level',
    'ItemDisplayStringRarity', 'ItemDisplayStringNormal', 'ItemDisplayStringMagic', 'ItemDisplayStringRare', 'ItemDisplayStringUnique'
  ]
}
const SRC = {
  poe1: path.join(FROM, 'tools', 'ggpk_zh', 'out', 'poe1', 'tables', 'clientstrings.json'),
  poe2: path.join(FROM, 'tools', 'ggpk2_zh', 'out', 'poe2', 'tables', 'clientstrings.json')
}
const META = {
  poe1: path.join(FROM, 'tools', 'ggpk_zh', 'out', 'poe1', 'meta.json'),
  poe2: path.join(FROM, 'tools', 'ggpk2_zh', 'out', 'poe2', 'meta.json')
}

/** 與 regex/src/data.ts normalizeLabel 相同 */
function normalizeLabel (/** @type {string} */ s) {
  return s
    .replace(/\[([^\]|]*)\|([^\]]*)\]/g, '$2')
    .replace(/\[([^\]|]*)\]/g, '$1')
    .replace(/\{\d+\}/g, '#')
}

let failed = 0
for (const game of /** @type {const} */ (['poe1', 'poe2'])) {
  const rows = JSON.parse(fs.readFileSync(SRC[game], 'utf8'))
  /** @type {Map<string, {en: string, tc: string}>} */
  const byId = new Map()
  for (const r of rows) {
    if (r.table !== 'clientstrings' || r.column !== 'Text' || typeof r.id !== 'string') continue
    if (byId.has(r.id)) {
      console.error(`${game}:clientstrings 鍵 ${r.id} 出現兩次,不猜哪一個`)
      failed++
      continue
    }
    byId.set(r.id, { en: r.en, tc: r.tc })
  }
  const zh = {}
  const en = {}
  const missing = []
  for (const k of KEYS[game]) {
    const v = byId.get(k)
    if (!v || typeof v.en !== 'string' || typeof v.tc !== 'string') { missing.push(k); continue }
    zh[k] = normalizeLabel(v.tc)
    en[k] = normalizeLabel(v.en)
  }
  if (missing.length) {
    console.error(`${game}:clientstrings 缺鍵(表只收中英不同的字串;缺鍵不猜):${missing.join(', ')}`)
    failed++
    continue
  }
  // 交叉比對:regex_poe*.json 的 ambient 行
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'regex', `regex_${game}.json`), 'utf8'))
  const ambZh = new Set(cat.pages.flatMap(p => p.ambientZh ?? []))
  const ambEn = new Set(cat.pages.flatMap(p => p.ambientEn ?? []))
  const confirmed = []
  const unconfirmed = []
  for (const k of KEYS[game]) {
    if (ambZh.has(zh[k]) && ambEn.has(en[k])) confirmed.push(k)
    else unconfirmed.push(`${k}(${en[k]} / ${zh[k]})`)
  }
  let version = ''
  try { version = JSON.parse(fs.readFileSync(META[game], 'utf8')).game_version ?? '' } catch {}
  const out = {
    schema: 1,
    game,
    source: `pob-zh-engine ${path.relative(FROM, SRC[game]).split(path.sep).join('/')}(clientstrings,欄 Text;meta game_version ${version || '未知'})`,
    note: '暫代檔:PobTools regex_poe*.json 升到 schema 2 自帶 labels 後,regex/src/data.ts 優先讀資料檔內的 labels。{0} 已換成 #。',
    labels: { zh, en }
  }
  const file = path.join(ROOT, 'data', 'regex', `labels.${game}.json`)
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n')
  console.log(`${game}:${KEYS[game].length} 鍵 → ${path.relative(ROOT, file)}`)
  console.log(`  與 regex_${game}.json ambient 一致:${confirmed.length} 鍵`)
  if (unconfirmed.length) console.log(`  ambient 沒有(只有 clientstrings 一個來源):\n    ${unconfirmed.join('\n    ')}`)
  const stat = fs.statSync(SRC[game])
  execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'), '--write', '--prefix', `data/regex/labels.${game}.json`,
    '--fetched-at', stat.mtime.toISOString(),
    '--source', `clientstrings(${out.source};regex/scripts/gen-labels.mjs 產生)`,
    '--path', path.relative(ROOT, SRC[game]).split(path.sep).join('/')
  ], { stdio: 'inherit' })
}
process.exit(failed ? 1 : 0)
