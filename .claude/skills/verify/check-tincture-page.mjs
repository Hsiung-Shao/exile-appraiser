// 實跑驗證的斷言:讀證據目錄裡的 state-tincture-mods.json 與 state-vendor-bases.json(dump-regex-page.js 的輸出),
// 把每條檢查寫進 run.log、結束碼寫進 exit_code.txt(0 = 全過)。
// 用法:node .claude/skills/verify/check-tincture-page.mjs <證據目錄>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('用法:node check-tincture-page.mjs <證據目錄>'); process.exit(2) }

const lines = []
let failed = 0
const check = (label, ok, detail = '') => {
  if (!ok) failed++
  lines.push(`${ok ? 'PASS' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
}
const load = (name) => {
  try { return JSON.parse(readFileSync(join(dir, name), 'utf8')) } catch (e) { check(`讀 ${name}`, false, String(e.message)); return null }
}
/** 清單文字裡「清除」之後的列(中英各一行) */
const listRows = (s) => s.rows.slice(s.rows.lastIndexOf('清除') + 1)

const mods = load('state-tincture-mods.json')
const bases = load('state-vendor-bases.json')

if (mods) {
  const ids = (mods.pages ?? []).map(p => p.id)
  const at = ids.indexOf('tincture_mods')
  check('頁面選單有「萃取物詞綴」', at >= 0 && mods.pages[at].title.startsWith('萃取物詞綴'), ids.join(','))
  check('排在藥劑詞綴後面', at > 0 && ids[at - 1] === 'flask_mods', ids.join(','))
  check('目前頁是萃取物詞綴', mods.page === 'tincture_mods', mods.page)
  check('分類有前綴 / 後綴', ['前綴', '後綴'].every(g => mods.groups.includes(g)), mods.groups.join(','))
  check('清單共 17 列、已勾 2 列', /^已勾選 2 \/ 17$/.test(mods.count), mods.count)
  const rows = listRows(mods)
  check('清單列出 17 列(中英各一行)', rows.length === 34, String(rows.length))
  check('清單含「增加 #% 效果」與英文', rows.includes('增加 #% 效果') && rows.includes('#% increased effect'))
  check('勾選後輸出一條加引號的搜尋字串', /^".+"$/.test(mods.query), mods.query)
}

if (bases) {
  check('目前頁是物品基底', bases.page === 'vendor_bases', bases.page)
  check('分類有「萃取物」且已選', bases.groups.includes('萃取物') && bases.group === '萃取物', bases.group)
  const rows = listRows(bases)
  check('萃取物分類共 10 列(中英各一行)', rows.length === 20, String(rows.length))
  check('含 灰樹皮萃取物 / Ashbark Tincture', rows.includes('灰樹皮萃取物') && rows.includes('Ashbark Tincture'))
  check('物品基底共 1067 列、已勾 1 列', /^已勾選 1 \/ 1067$/.test(bases.count), bases.count)
  check('勾選後輸出一條加引號的搜尋字串', /^".+"$/.test(bases.query), bases.query)
}

lines.push(failed ? `RESULT: FAIL(${failed} 條)` : 'RESULT: PASS')
writeFileSync(join(dir, 'run.log'), lines.join('\n') + '\n')
writeFileSync(join(dir, 'exit_code.txt'), failed ? '1' : '0')
console.log(lines.join('\n'))
process.exit(failed ? 1 : 0)
