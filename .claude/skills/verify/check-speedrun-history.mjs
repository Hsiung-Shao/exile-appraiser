// speedrun 紀錄旅程(features/speedrun-history.md)的斷言:讀 <證據目錄>/state-history.json,寫 run.log 與 exit_code.txt
import fs from 'node:fs'
import path from 'node:path'
const dir = process.argv[2]
const s = JSON.parse(fs.readFileSync(path.join(dir, 'state-history.json'), 'utf8'))
const fails = []
const ok = (c, msg) => { if (!c) fails.push(msg) }
const st = s.settings
ok(st.listOrder.join() === 'rD,rC,rB,rA', '清單要新到舊')
ok(!st.setPbDisabled.rA && st.setPbDisabled.rC && st.setPbDisabled.rD, '未跑完 / 中途開始不能設 PB,跑完的可以')
ok(st.afterActions.compare === 'rB' && st.afterActions.name === '弓箭手 3.30' && st.afterActions.pbTotal === 6000000, '改名 / 比較 / 設 PB 要寫進存檔')
ok(st.afterDelete.compare === null && !st.afterDelete.ids.includes('rB') && st.afterDelete.pbTotal === 6000000, '刪比較對象 → compare null、PB 不變')
ok(st.afterDelete.detailRows === 10, '各段展開 10 列')
ok(st.afterReload.saved.includes('rA:慢的那次'), '重新整理後名稱保留')
const w = s.widget
ok(w.idleCompare === '比較:弓箭手 3.30', '計時器顯示比較對象名稱')
ok(/^第 1 章 \+0\.\d /.test(w.row0AfterSplit), '差值要跟比較對象(每章 1 秒)比,不是跟 PB(11 分)比')
ok(w.savedHistory.length === 2 && /:1:false$/.test(w.savedHistory[1]), '分一段就新增一筆未跑完的紀錄')
ok(w.pbFirst === 660000, '比較對象不影響 PB')
const log = fails.length ? `FAIL\n${fails.join('\n')}\n` : 'PASS 10 項\n'
fs.writeFileSync(path.join(dir, 'run.log'), log)
fs.writeFileSync(path.join(dir, 'exit_code.txt'), String(fails.length ? 1 : 0))
process.stdout.write(log)
process.exit(fails.length ? 1 : 0)
