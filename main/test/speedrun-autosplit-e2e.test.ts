// 2026-11-18 使用者回報「過章節不會自動分段」:用使用者本機真實 Client.txt 行(繁中客戶端,PoE1 3.30 開季劇情 / PoE2)
// 走完整條路:GameLogWatcher → parseAreaLine → autoAction → run。假記憶體檔 + 手動觸發 watch,不碰真檔案。
import { describe, expect, it } from 'vitest'
import { GameLogWatcher, type LogFile } from '../src/game-log'
import { autoAction } from '../../core/src/speedrun/autosplit'
import { presetRoute, type SpeedrunGame } from '../../core/src/speedrun/routes'
import { createRun } from '../../core/src/speedrun/run'

// 2026-11-14 PoE1 3.30 劇情(節錄,含回頭進前一章城鎮與中文聊天 / 進入提示行)
const POE1 = [
  '2026/11/14 03:08:36 784596937 1186a803 [DEBUG Client 35540] Generating level 1 area "1_1_1" with seed 930780934',
  '2026/11/14 03:11:40 784780000 1186a803 [DEBUG Client 35540] Generating level 13 area "1_1_town" with seed 1',
  '2026/11/14 03:11:41 784780500 cffb06be [INFO Client 35540] : 你已進入：獅眼守望。',
  '2026/11/14 03:46:31 786871765 1186a803 [DEBUG Client 35540] Generating level 23 area "1_2_town" with seed 1',
  '2026/11/14 04:08:37 788198156 1186a803 [DEBUG Client 35540] Generating level 13 area "1_1_town" with seed 1',
  '2026/11/14 04:10:50 788330906 1186a803 [DEBUG Client 35540] Generating level 23 area "1_2_town" with seed 1',
  '2026/11/14 04:34:58 789778375 1186a803 [DEBUG Client 35540] Generating level 33 area "1_3_town" with seed 1'
]
const POE2 = [
  '2026/08/28 13:43:43 88398828 2caa2332 [DEBUG Client 5400] Generating level 1 area "G1_1" with seed 578348401',
  '2026/09/10 17:10:24 104031500 2caa229f [DEBUG Client 30460] Generating level 15 area "G1_town" with seed 1',
  '2026/09/10 21:34:45 119892656 2caa229f [DEBUG Client 6824] Generating level 32 area "G2_town" with seed 1'
]

function memFile () {
  let data = Buffer.alloc(0)
  const file: LogFile = {
    size: async () => data.length,
    read: async (buf, position) => {
      if (position >= data.length) return 0
      const n = Math.min(buf.length, data.length - position)
      data.copy(buf, 0, position, position + n)
      return n
    },
    close: async () => {}
  }
  return { file, append: (s: string) => { data = Buffer.concat([data, Buffer.from(s, 'utf8')]) } }
}

async function play (game: SpeedrunGame, lines: string[]) {
  const route = { ...presetRoute(game, 'cmn-Hant'), autoStart: true, autoSplit: true }
  let t = 0
  const run = createRun(route, () => t)
  const mem = memFile()
  let poke = () => {}
  const w = new GameLogWatcher({
    open: async () => mem.file,
    watch: (_p, _i, onChange) => { poke = onChange; return () => {} },
    onArea: (e) => {
      const act = autoAction(run, route, e.area)
      if (act === 'start') run.start()
      else if (act === 'split') run.split()
    }
  })
  await w.setTarget('Client.txt')
  for (const l of lines) {
    t += 1000
    mem.append(l + '\r\n') // 遊戲寫 CRLF
    poke()
    await new Promise(r => setTimeout(r, 0))
  }
  return run
}

describe('真實 Client.txt 行 → 自動開始 / 自動分段', () => {
  it('PoE1:進第 2 章城鎮分第 1 段、第 3 章城鎮分第 2 段,回頭進舊城鎮不多分', async () => {
    const run = await play('poe1', POE1)
    expect(run.phase).toBe('running')
    expect(run.index).toBe(2)
    expect(run.splitTimes.slice(0, 2)).toEqual([3000, 6000])
  })
  it('PoE2:進 G2_town 分第 1 段', async () => {
    const run = await play('poe2', POE2)
    expect(run.phase).toBe('running')
    expect(run.index).toBe(1)
  })
  it('使用者關掉自動分段 → 進城不分段', async () => {
    const route = { ...presetRoute('poe1', 'cmn-Hant'), autoSplit: false }
    const run = createRun(route, () => 0)
    run.start()
    expect(autoAction(run, route, '1_2_town')).toBeNull()
  })
})
