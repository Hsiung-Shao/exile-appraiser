// 物品詞綴數值頁改名對照產生器(2026-11-25):比較寫入前 / 後兩份資料的物品詞綴數值頁,
// 同一個英文 ref 的項目 id 整個換掉 → 加進 regex/src/pages/renamed-entry-ids.ts(只加不刪,已有的保留)。
// 由 scripts/poe1-season/update.mjs --write 自動呼叫(tsx 執行):
//   node node_modules/tsx/dist/cli.mjs regex/scripts/gen-renamed-entry-ids.ts --game poe1 --before <寫入前的 regex 資料夾>
// <before> 的結構同 data/:<before>/item-mod-forms.json、<before>/../poe1/{en,cmn-Hant}/stats.ndjson(loadItemModData 的規則)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadItemModData } from '../src/node'
import { itemModPage } from '../src/pages/item-mods'
import { RENAMED_ENTRY_IDS } from '../src/pages/renamed-entry-ids'
import type { RegexGame } from '../src/data'
import { renamedEntryIds } from '../../scripts/season/lib.mjs'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/pages/renamed-entry-ids.ts')
const args = process.argv.slice(2)
const flag = (n: string): string => {
  const i = args.indexOf(n)
  if (i < 0 || !args[i + 1]) throw new Error(`缺少 ${n}`)
  return args[i + 1]
}
const game = flag('--game') as RegexGame
const entries = (dir?: string) => itemModPage(game, loadItemModData(game, dir)).entries.map(e => ({ id: e.id, en: e.en }))
const after = entries()
// 新版英文資料:每個寫法(含 superseded)→ 所在詞綴的 ref
const alias = new Map<string, string[]>()
for (const line of fs.readFileSync(path.resolve(path.dirname(OUT), '../../../data', game, 'en/stats.ndjson'), 'utf8').split('\n')) {
  if (!line.trim()) continue
  const s = JSON.parse(line)
  for (const st of s.stats ?? [s]) for (const m of st.matchers ?? []) if (m.string !== st.ref) alias.set(m.string, [...(alias.get(m.string) ?? []), st.ref])
}
const next: Record<string, string> = renamedEntryIds({ before: entries(flag('--before')), after, existing: RENAMED_ENTRY_IDS, aliasOf: (s: string) => alias.get(s) ?? [] })
const added = Object.keys(next).filter(k => !(k in RENAMED_ENTRY_IDS))
if (added.length === 0) {
  console.log('物品詞綴數值頁改名對照:沒有新的')
} else {
  const text = fs.readFileSync(OUT, 'utf8')
  const refOf = (id: string): string => after.find(e => e.id === id)?.en[0] ?? ''
  const head = text.slice(0, text.indexOf('{\n') + 2)
  const lines = Object.entries(next).map(([k, v], i, all) => `  ${k}: '${v}'${i < all.length - 1 ? ',' : ''} // ${k in RENAMED_ENTRY_IDS ? existingComment(text, k) : refOf(v)}`)
  fs.writeFileSync(OUT, `${head}${lines.join('\n')}\n}\n`)
  console.log(`物品詞綴數值頁改名對照:新增 ${added.length} 筆(${added.join('、')})`)
}

function existingComment (text: string, key: string): string {
  return new RegExp(`^\\s+${key}: '[^']*',? // (.*)$`, 'm').exec(text)?.[1] ?? ''
}
