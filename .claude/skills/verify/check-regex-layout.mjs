// 設定 › 正則的版面(設計稿 P10 / P11):兩欄門檻、數值條件區換欄、書籤頁兩張小卡。用法:node check-regex-layout.mjs <證據目錄>
// 讀 state-840.json / state-1000.json(dump-regex-layout.js 在視窗寬 840 與 1000 各跑一次的回傳值),寫 run.log 與 exit_code.txt。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const read = n => JSON.parse(readFileSync(join(dir, n), 'utf8'))
const n = read('state-840.json'); const w = read('state-1000.json')
const stacked = c => Math.abs(c.sideX - c.colX) < 2 && c.sideY < c.colY
const twoCol = c => c.sideX > c.colX + 100 && Math.abs(c.sideY - c.colY) < 2
const checks = [
  ['量測寬度正確(840 與 1000)', n.width === 840 && w.width === 1000],
  [`窄(840,面板 ${n.panelW}px):單欄,輸出疊在清單上方`, stacked(n.cols) && n.cols.outInSide === true],
  [`寬(1000,面板 ${w.panelW}px):清單在左、輸出在右`, twoCol(w.cols) && w.cols.outInSide === true],
  ['數值條件展開時在左欄清單上方', w.expanded === 'col'],
  ['數值條件收合時在右欄', w.collapsed === 'side'],
  ['收合、展開各一次後鍵盤焦點都在數值條件的標題鈕上', w.focus.length === 2 && w.focus.every(f => f === 'section-toggle')],
  ['輸出語言是分段鈕(繁中 / English)', w.lang.join('|') === '繁中|English'],
  ['勾選詞綴後輸出框有字串', typeof w.query === 'string' && w.query.length > 0],
  ['書籤頁:子分頁是底線樣式(.tabs > .tab 兩顆)', w.bookmarks.underlineTabs === 2],
  ['書籤頁(PoE1):地圖詞綴檢查與書籤列兩張小卡並排', w.bookmarks.cards === 2 && w.bookmarks.cardsSameRow === true],
  ['書籤頁:書籤列是畫得出來的開關', w.bookmarks.switchTrackW > 10]
]
const lines = checks.map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'} ${name}`)
const code = checks.every(c => c[1]) ? 0 : 1
writeFileSync(join(dir, 'run.log'), lines.join('\n') + `\nRESULT: ${code ? 'FAIL' : 'PASS'}\n`)
writeFileSync(join(dir, 'exit_code.txt'), String(code))
console.log(lines.join('\n'))
process.exit(code)
