// 設定視窗重整旅程(features/settings-ia.md;2026-11-18 方案 B)的斷言:
// 讀 <證據目錄>/state-settings-ia.json(dump-settings-ia.js 逐頁點過後的結果),寫 run.log / exit_code.txt。
// 用法:node .claude/skills/verify/check-settings-ia.mjs <證據目錄>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('用法:node check-settings-ia.mjs <證據目錄>'); process.exit(2) }
const lines = []
let failed = 0
const check = (label, ok, detail = '') => { if (!ok) failed++; lines.push(`${ok ? 'PASS' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`) }
let s = null
try { s = JSON.parse(readFileSync(join(dir, 'state-settings-ia.json'), 'utf8')) } catch (e) { check('讀 state-settings-ia.json', false, e.message) }
if (s) {
  const groups = s.groups.map(g => `${g.label}:${g.tabs.map(x => x.id).join(',')}`)
  check('左選單三組(PoE1:自動辨識不列)', JSON.stringify(groups) === JSON.stringify([
    '設定:general,game,hotkeys,startup',
    '功能:price-check,stash,chat,timer',
    '工具:regex,dust,log,about'
  ]), JSON.stringify(groups))
  check('每個選單項目都有圖示', s.groups.every(g => g.tabs.every(x => x.hasIcon)))
  const want = { general: '一般', game: '遊戲與視窗', hotkeys: '熱鍵', startup: '啟動與更新', 'price-check': '查價', stash: '倉庫', chat: '聊天指令', timer: '計時器', regex: '正則', dust: '拆粉排行', log: '記錄與效能', about: '關於' }
  for (const [id, title] of Object.entries(want)) {
    const p = s.pages[id]
    check(`${id}:頁首 = ${title} + 一句說明`, p?.title === title && !!p?.lead, JSON.stringify(p))
  }
  const has = (id, ds) => s.pages[id]?.settings.includes(ds)
  check('啟動與更新有更新 / 啟動 / 設定資料夾卡片', has('startup', 'startup') && s.pages.startup.about.includes('update'), JSON.stringify(s.pages.startup))
  check('關於頁不再有更新卡片', !s.pages.about?.about.includes('update'), JSON.stringify(s.pages.about?.about))
  check('倉庫頁有顯示方式選項卡、倉庫搜尋、頁籤捲動', ['stash-trigger-mode', 'stash-search', 'stash-scroll-section'].every(d => has('stash', d)), JSON.stringify(s.pages.stash?.settings))
  check('聊天指令頁只有聊天指令(沒有倉庫搜尋)', has('chat', 'chat-commands') && !has('chat', 'stash-search'), JSON.stringify(s.pages.chat?.settings))
  check('計時器頁有計時器卡片;一般頁沒有', has('timer', 'timer') && !has('general', 'timer') && !has('general', 'startup'), JSON.stringify([s.pages.timer?.settings, s.pages.general?.settings]))
  check('功能頁頂端有「這頁的熱鍵」(查價 / 倉庫 / 計時器)', ['price-check', 'stash', 'timer'].every(id => has(id, 'page-hotkeys')))
  check('熱鍵總表每組一張卡片,倉庫價格組連到倉庫頁', s.hotkeyGroups.length >= 6 && s.hotkeyGroups.some(g => g.id === 'scan' && g.goto === 'stash'), JSON.stringify(s.hotkeyGroups))
  check('正則有「產生器 / 書籤與快捷」子分頁', JSON.stringify(s.regexViews) === JSON.stringify(['generator', 'bookmarks']), JSON.stringify(s.regexViews))
  check('從熱鍵總表點「倉庫 ›」跳到倉庫頁並出現返回連結', s.jump?.hash === '#tab=stash' && s.jump?.back === true, JSON.stringify(s.jump))
}
writeFileSync(join(dir, 'run.log'), lines.join('\n') + '\n')
writeFileSync(join(dir, 'exit_code.txt'), String(failed ? 1 : 0))
console.log(lines.join('\n'))
process.exit(failed ? 1 : 0)
