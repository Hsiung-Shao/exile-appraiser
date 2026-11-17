// 地圖詞綴設定頁旅程(features/map-check-settings.md)的斷言:讀 <證據目錄>/state-after-click.json,寫 run.log / exit_code.txt。
// 用法:node .claude/skills/verify/check-map-check.mjs <證據目錄>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('用法:node check-map-check.mjs <證據目錄>'); process.exit(2) }
const lines = []
let failed = 0
const check = (label, ok, detail = '') => { if (!ok) failed++; lines.push(`${ok ? 'PASS' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`) }
let s = null
try { s = JSON.parse(readFileSync(join(dir, 'state-after-click.json'), 'utf8')) } catch (e) { check('讀 state-after-click.json', false, e.message) }
if (s) {
  const i = s.nav.indexOf('地圖詞綴')
  check('左選單有「地圖詞綴」且在拆粉排行之後', i > -1 && i === s.nav.indexOf('拆粉排行') + 1, s.nav.join(','))
  check('目前分頁是 map-check', s.activeTab === '#tab=map-check', s.activeTab)
  check('說明一句提到熱鍵', s.hasLead === true)
  check('清單至少 290 條(3.30 新地圖詞綴已補標記)', Number(s.countLine) >= 290, s.countLine)
  const hit = s.mapCheck?.selectedStats?.find(x => x.ref === 'Area contains two Unique Bosses')
  check('點「危險」後存檔以 ref 為鍵、設定檔 I = d', hit?.decision === 'd--', JSON.stringify(hit))
  check('其他預設標記保留', s.mapCheck?.selectedStats?.length === 4)
}
writeFileSync(join(dir, 'run.log'), lines.join('\n') + '\n')
writeFileSync(join(dir, 'exit_code.txt'), String(failed ? 1 : 0))
console.log(lines.join('\n'))
process.exit(failed ? 1 : 0)
