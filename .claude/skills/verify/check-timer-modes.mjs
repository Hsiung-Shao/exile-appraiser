// 計時器三種模式旅程(features/timer-modes.md)的斷言:讀 <證據目錄>/state-timer.json,寫 run.log / exit_code.txt
import fs from 'node:fs'
import path from 'node:path'
const dir = process.argv[2]
const s = JSON.parse(fs.readFileSync(path.join(dir, 'state-timer.json'), 'utf8'))
const out = []
let ok = true
const check = (name, cond) => { out.push(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) ok = false }
check('設定頁有模式分段鈕', s.settings.modeSeg === true)
check('倒數模式顯示時長 / 試聽、不顯示 speedrun 區', s.settings.countdownMin === '1' && s.settings.countdownSec === '30' && s.settings.soundTest && !s.settings.speedrun)
check('倒數時長存檔 = 90 秒', s.settings.savedSec === 90 && s.settings.savedMode === 'countdown')
check('碼表開始後在走、暫停後停住', /0:01\.\d\d/.test(s.stopwatch.running) && s.stopwatch.paused1 === s.stopwatch.paused2)
check('倒數未開始顯示設定時長 1:30.00', s.countdown.idle.includes('1:30.00'))
check('倒數跑著在減少', /1:2\d\.\d\d/.test(s.countdown.running))
check('倒數歸零顯示 0:00.00 且紅色', s.countdown.done.includes('0:00.00') && s.countdown.doneClass.includes('bad'))
check('倒數歸零有播音效記錄', s.countdown.log.includes('[timer] 倒數歸零:播放音效'))
out.push(ok ? 'RESULT PASS' : 'RESULT FAIL')
fs.writeFileSync(path.join(dir, 'run.log'), out.join('\n') + '\n')
fs.writeFileSync(path.join(dir, 'exit_code.txt'), ok ? '0' : '1')
console.log(out.join('\n'))
process.exit(ok ? 0 : 1)
