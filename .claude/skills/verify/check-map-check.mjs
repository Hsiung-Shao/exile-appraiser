// 地圖詞綴檢查的設定入口旅程(features/map-check-settings.md;2026-11-18 起在 設定 › 正則 書籤卡片)的斷言:
// 讀 <證據目錄>/state-after-select.json,寫 run.log / exit_code.txt。用法:node .claude/skills/verify/check-map-check.mjs <證據目錄>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('用法:node check-map-check.mjs <證據目錄>'); process.exit(2) }
const lines = []
let failed = 0
const check = (label, ok, detail = '') => { if (!ok) failed++; lines.push(`${ok ? 'PASS' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`) }
let s = null
try { s = JSON.parse(readFileSync(join(dir, 'state-after-select.json'), 'utf8')) } catch (e) { check('讀 state-after-select.json', false, e.message) }
if (s) {
  check('沒有獨立的「地圖詞綴」分頁', !s.nav.includes('地圖詞綴'), s.nav.join(','))
  check('目前分頁是正則', s.activeTab === '#tab=regex', s.activeTab)
  check('書籤卡片 PoE1 分頁有「地圖檢查書籤」列', s.rowFound === true)
  check('下拉只列 PoE1 地圖詞綴頁的書籤(藥劑頁不列)', JSON.stringify(s.options) === JSON.stringify(['(不上色)', '驗證-地圖危險']), JSON.stringify(s.options))
  check('選了以後存檔 mapCheckBookmark = { folder, name }', s.selectedLabel === '驗證-地圖危險' && s.saved?.name === '驗證-地圖危險' && s.saved?.folder === '', `${s.selectedLabel} / ${JSON.stringify(s.saved)}`)
  check('沒選過且只有一個地圖書籤 → 下拉一開始就顯示它(自動選)', s.autoBefore === '驗證-地圖危險', s.autoBefore)
  check('舊的獨立標記設定 mapCheck 不再寫出', s.hasOldMapCheck === false)
  check('說明一句用卡片的說明樣式', s.leadClass === 'rx-bm-other', s.leadClass)
}
writeFileSync(join(dir, 'run.log'), lines.join('\n') + '\n')
writeFileSync(join(dir, 'exit_code.txt'), String(failed ? 1 : 0))
console.log(lines.join('\n'))
process.exit(failed ? 1 : 0)
