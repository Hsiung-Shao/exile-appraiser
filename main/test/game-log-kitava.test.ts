// 基塔弗系統訊息行 → GameLogWatcher 觸發分段(端到端:假記憶體檔 + 手動觸發 watch,不碰真檔案、不送輸入)。
import { describe, expect, it } from 'vitest'
import { GameLogWatcher, type LogFile } from '../src/game-log'
import { autoAction } from '../../core/src/speedrun/autosplit'
import { presetRoute } from '../../core/src/speedrun/routes'
import { createRun } from '../../core/src/speedrun/run'

const HEAD = '2026/07/25 07:34:27 123456 cffb06be [INFO Client 1234]'
const ZH_CRUEL = `${HEAD} : 你永久性的受到奇塔弗的殘酷影響。你現在 -30% 最大抗性。`
const EN_CRUEL = `${HEAD} : You have been permanently weakened by Kitava's cruel affliction. You now have -30% to all Resistances.`
const ZH_MERCILESS = `${HEAD} : 你永久性的受到奇塔弗的無情影響。你的角色將減少 60% 所有抗性。`
const CHAT = `${HEAD} #某玩家: 你永久性的受到奇塔弗的殘酷影響。你現在 -30% 最大抗性。`
const area = (id: string) => `2026/07/25 07:34:30 123457 1186a803 [DEBUG Client 1234] Generating level 45 area "${id}" with seed 1`

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

// 先把 run 推到第 n 段(index = n),再依序餵 Client.txt 行
async function play (advanceTo: number, lines: string[]) {
  const route = { ...presetRoute('poe1', 'cmn-Hant'), autoStart: true, autoSplit: true }
  let t = 0
  const run = createRun(route, () => t)
  run.start()
  for (let i = 0; i < advanceTo; i++) { t += 1000; run.split() }
  const areas: string[] = []
  const mem = memFile()
  let poke = () => {}
  const w = new GameLogWatcher({
    open: async () => mem.file,
    watch: (_p, _i, onChange) => { poke = onChange; return () => {} },
    onArea: (e) => {
      areas.push(`${e.area}:${e.level}`)
      const act = autoAction(run, route, e.area)
      if (act === 'start') run.start()
      else if (act) { if (act.split > run.index) run.jumpTo(act.split); run.split() }
    }
  })
  await w.setTarget('Client.txt')
  for (const l of lines) {
    t += 1000
    mem.append(l + '\r\n') // 遊戲寫 CRLF
    poke()
    await new Promise(r => setTimeout(r, 0))
  }
  return { run, areas }
}

describe('基塔弗訊息行 → 自動分段', () => {
  it('T1 第 5 章那段收到繁中 -30% 訊息 → 分段(index 4 → 5)', async () => {
    const { run, areas } = await play(4, [ZH_CRUEL])
    expect(run.index).toBe(5)
    expect(areas).toEqual(['2_6_town:0'])
  })
  it('T1 第 5 章那段收到英文 cruel 訊息 → 分段(index 4 → 5)', async () => {
    const { run } = await play(4, [EN_CRUEL])
    expect(run.index).toBe(5)
  })
  it('T3 訊息分段後又進 2_6_town 區域行 → 不重複分段', async () => {
    const { run } = await play(4, [ZH_CRUEL, area('2_6_town')])
    expect(run.index).toBe(5)
  })
  it('T4 沒有訊息行、只進 2_6_town 區域行 → 仍分段(退路)', async () => {
    const { run } = await play(4, [area('2_6_town')])
    expect(run.index).toBe(5)
  })
  it('T2 最後一段收到 -60% 訊息 → 結束,之後再進 2_11_endgame_town 不出錯', async () => {
    const { run } = await play(9, [ZH_MERCILESS])
    expect(run.phase).toBe('finished')
    const after = await play(9, [ZH_MERCILESS, area('2_11_endgame_town')])
    expect(after.run.phase).toBe('finished')
  })
  it('T5 第 5 章那段看到玩家聊天行(內文相同)→ 不分段、不觸發 onArea', async () => {
    const { run, areas } = await play(4, [CHAT])
    expect(run.index).toBe(4)
    expect(areas).toEqual([])
  })
})
