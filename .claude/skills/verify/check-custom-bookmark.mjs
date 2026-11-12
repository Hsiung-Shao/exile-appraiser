// 實跑驗證的斷言:讀證據目錄裡的 inputs.json 與 state-*.json(dump-regex-bookmarks.js 的輸出),
// 把每條檢查寫進 run.log、結束碼寫進 exit_code.txt(0 = 全過)。
// 用法:node .claude/skills/verify/check-custom-bookmark.mjs <證據目錄>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('用法:node check-custom-bookmark.mjs <證據目錄>'); process.exit(2) }

const lines = []
let failed = 0
const check = (label, ok, detail = '') => {
  if (!ok) failed++
  lines.push(`${ok ? 'PASS' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
}
const load = (name) => {
  try { return JSON.parse(readFileSync(join(dir, name), 'utf8')) } catch (e) { check(`讀 ${name}`, false, String(e.message)); return null }
}

const inputs = load('inputs.json')
const steps = { add: load('state-after-add.json'), edit: load('state-after-edit.json'), reload: load('state-after-reload.json'), del: load('state-after-delete.json') }

if (inputs && Object.values(steps).every(Boolean)) {
  const { name, text, edited } = inputs
  const rowOf = (s) => s.rows.find(r => r.name === name)
  const savedOf = (s) => s.saved.find(b => b.name === name)

  const a = rowOf(steps.add)
  check('新增後:書籤卡片有這一列', !!a)
  check('新增後:是自訂書籤列,說明行含字串', !!a?.custom && a.meta.includes(text), a?.meta)
  check('新增後:有「編輯」、沒有「載入」「更新」', !!a && a.buttons.includes('bm-edit') && !a.buttons.includes('bm-load') && !a.buttons.includes('bm-update'), a?.buttons.join(','))
  check('新增後:改名 / 刪除 / 上下移照常', !!a && ['bm-rename', 'bm-delete', 'bm-up', 'bm-down'].every(b => a.buttons.includes(b)), a?.buttons.join(','))
  check('新增後:設定視窗旁的書籤列出現', steps.add.bar.includes(name), steps.add.bar.join(','))
  check('新增後:對話框已關', steps.add.dialogOpen === false)
  const sa = savedOf(steps.add)
  check('新增後:存檔是 page=@custom、keys=[字串]', sa?.page === '@custom' && sa.keys.length === 1 && sa.keys[0] === text, JSON.stringify(sa))

  check('編輯後:說明行換成新字串', !!rowOf(steps.edit)?.meta.includes(edited), rowOf(steps.edit)?.meta)
  check('編輯後:存檔字串更新', savedOf(steps.edit)?.keys[0] === edited, JSON.stringify(savedOf(steps.edit)))
  check('編輯後:只有一筆(沒有多出一筆)', steps.edit.rows.filter(r => r.name === name).length === 1)

  check('重新載入後:書籤還在且字串不變', !!rowOf(steps.reload)?.custom && savedOf(steps.reload)?.keys[0] === edited, JSON.stringify(savedOf(steps.reload)))

  check('刪除後:書籤卡片沒有這一列', !rowOf(steps.del))
  check('刪除後:存檔也沒有', !savedOf(steps.del))
}

lines.push(failed ? `RESULT: FAIL(${failed} 條)` : 'RESULT: PASS')
writeFileSync(join(dir, 'run.log'), lines.join('\n') + '\n')
writeFileSync(join(dir, 'exit_code.txt'), failed ? '1' : '0')
console.log(lines.join('\n'))
process.exit(failed ? 1 : 0)
