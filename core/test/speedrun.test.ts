// 競速計時(speedrun):client log 區域行解析、內建路線、分段計時 / PB / 金段、自動分段、時間格式。純函式,假時鐘,不碰檔案。
import { describe, expect, it } from 'vitest'
import { parseAreaLine } from '../src/speedrun/client-log'
import { PRESET_TOWN_AREAS, presetRoute, replaceSplits, type Route } from '../src/speedrun/routes'
import { createRun, deltaAt, formatDelta, formatRunTime, segmentTime, sumOfBest } from '../src/speedrun/run'
import { autoAction } from '../src/speedrun/autosplit'

const clock = () => {
  let t = 1_000_000
  return { now: () => t, advance: (ms: number) => { t += ms } }
}
// 自訂路線:每段名稱 S0、S1…,預設無 PB / 金段
const mk = (areas: Array<string | null>, extra: Partial<Route> = {}): Route => ({
  splits: areas.map((a, i) => ({ name: `S${i}`, area: a })),
  startArea: 'start_area',
  pb: null,
  golds: areas.map(() => null),
  attempts: 0,
  autoStart: true,
  autoSplit: true,
  ...extra
})

describe('parseAreaLine', () => {
  it('S1 真實區域行 → 解析出 area id 與等級', () => {
    expect(parseAreaLine('2025/07/18 22:59:37 2784078 1186a064 [DEBUG Client 28660] Generating level 60 area "2_8_town" with seed 1'))
      .toEqual({ area: '2_8_town', level: 60 })
    expect(parseAreaLine('2026/08/28 07:39:27 66543156 2caa2332 [DEBUG Client 42716] Generating level 65 area "HideoutRacetrack" with seed 1'))
      .toEqual({ area: 'HideoutRacetrack', level: 65 })
  })

  it('S1 行尾帶 \\r(CRLF)照樣解析', () => {
    expect(parseAreaLine('2025/07/18 22:59:37 2784078 1186a064 [DEBUG Client 28660] Generating level 60 area "2_8_town" with seed 1\r'))
      .toEqual({ area: '2_8_town', level: 60 })
  })

  it('S1 聊天行、SCENE 行與空字串 → null', () => {
    expect(parseAreaLine('2025/07/18 22:59:40 2787000 1186a064 [INFO Client 123] @From someone: hi')).toBeNull()
    expect(parseAreaLine('2025/07/18 22:59:40 2787000 1186a064 [INFO Client 28660] [SCENE] Set Source [(unknown)]')).toBeNull()
    expect(parseAreaLine('')).toBeNull()
  })

  it('S1 聊天內容剛好含區域行字樣但不是 Generating 格式 → null', () => {
    expect(parseAreaLine('[INFO Client 1] @From x: area "2_8_town" level 60')).toBeNull()
  })
})

describe('內建路線', () => {
  // 使用者真實 log + GGPK 出現過的 id,寫死當對照
  const KNOWN = new Set([
    '1_1_1', '1_1_town', '1_2_town', '1_3_town', '1_4_town', '1_5_town', '2_6_town', '2_7_town', '2_8_town', '2_9_town',
    '2_10_town', '2_11_endgame_town', 'G1_1', 'G1_town', 'G2_town', 'G3_town', 'G4_town', 'P1_Town', 'P2_Town', 'P3_Town',
    'G_Endgame_Town'
  ])

  it('S2 兩代每段 area 與 startArea 都在實測清單,段數 10 / 7', () => {
    for (const [game, n] of [['poe1', 10], ['poe2', 7]] as const) {
      for (const lang of ['cmn-Hant', 'en'] as const) {
        const r = presetRoute(game, lang)
        expect(r.splits.length, `${game} ${lang}`).toBe(n)
        for (const s of r.splits) expect(KNOWN.has(s.area as string), `${game} ${s.area}`).toBe(true)
        expect(KNOWN.has(r.startArea as string), `${game} startArea ${r.startArea}`).toBe(true)
      }
    }
  })

  it('S2 area 依序與合約相同(順序錯會讓自動分段對錯段)', () => {
    expect(presetRoute('poe1', 'en').splits.map(s => s.area)).toEqual(
      ['1_2_town', '1_3_town', '1_4_town', '1_5_town', '2_6_town', '2_7_town', '2_8_town', '2_9_town', '2_10_town', '2_11_endgame_town'])
    expect(presetRoute('poe1', 'en').startArea).toBe('1_1_1')
    expect(presetRoute('poe2', 'en').splits.map(s => s.area)).toEqual(
      ['G2_town', 'G3_town', 'G4_town', 'P1_Town', 'P2_Town', 'P3_Town', 'G_Endgame_Town'])
    expect(presetRoute('poe2', 'en').startArea).toBe('G1_1')
  })

  it('S2 預設值:自動開始 / 分段開、attempts 0、無 PB、金段全 null、段名非空', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      const r = presetRoute(game, 'cmn-Hant')
      expect(r.autoStart).toBe(true)
      expect(r.autoSplit).toBe(true)
      expect(r.attempts).toBe(0)
      expect(r.pb).toBeNull()
      expect(r.golds).toEqual(r.splits.map(() => null))
      for (const s of r.splits) expect(s.name.trim().length).toBeGreaterThan(0)
    }
  })

  it('S2 PRESET_TOWN_AREAS 的 area 都在實測清單且中英文名非空', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      expect(PRESET_TOWN_AREAS[game].length).toBeGreaterThan(0)
      for (const t of PRESET_TOWN_AREAS[game]) {
        expect(t.area.length).toBeGreaterThan(0)
        expect(t.zh.trim().length).toBeGreaterThan(0)
        expect(t.en.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('分段計時', () => {
  it('S3 start 後 60 秒、再 30 秒各 split:累計 60000 / 90000,段時間 60000 / 30000', () => {
    const c = clock()
    const run = createRun(mk(['a', 'b', 'c']), c.now)
    expect(run.phase).toBe('idle')
    run.start()
    expect(run.phase).toBe('running')
    c.advance(60_000)
    run.split()
    c.advance(30_000)
    run.split()
    expect(run.splitTimes).toEqual([60_000, 90_000, null])
    expect(run.index).toBe(2)
    expect(segmentTime(run, 0)).toBe(60_000)
    expect(segmentTime(run, 1)).toBe(30_000)
    expect(segmentTime(run, 2)).toBeNull()
  })

  it('S3 idle 時 split 不動作(沒開始不能分段)', () => {
    const run = createRun(mk(['a', 'b']), clock().now)
    run.split()
    expect(run.phase).toBe('idle')
    expect(run.index).toBe(0)
    expect(run.splitTimes).toEqual([null, null])
  })

  it('S4 暫停不計時:跑 10 秒、暫停 5 秒、再跑 5 秒 = 15000', () => {
    const c = clock()
    const run = createRun(mk(['a', 'b']), c.now)
    run.start()
    c.advance(10_000)
    run.pause()
    expect(run.phase).toBe('paused')
    c.advance(5_000)
    expect(run.elapsed()).toBe(10_000)
    run.resume()
    expect(run.phase).toBe('running')
    c.advance(5_000)
    expect(run.elapsed()).toBe(15_000)
  })

  it('S4 暫停期間 split 的累計不含暫停時間', () => {
    const c = clock()
    const run = createRun(mk(['a', 'b']), c.now)
    run.start()
    c.advance(10_000)
    run.pause()
    c.advance(5_000)
    run.resume()
    c.advance(5_000)
    run.split()
    expect(run.splitTimes[0]).toBe(15_000)
  })

  it('S5 split 後 undo:回到上一段,該段的累計清掉', () => {
    const c = clock()
    const run = createRun(mk(['a', 'b', 'c']), c.now)
    run.start()
    c.advance(1_000)
    run.split()
    expect(run.index).toBe(1)
    run.undo()
    expect(run.index).toBe(0)
    expect(run.splitTimes[0]).toBeNull()
  })

  it('S5 skip 一段再 split:被跳段 null、下一段累計照算、其段時間 null(前一段是 null)', () => {
    const c = clock()
    const run = createRun(mk(['a', 'b', 'c']), c.now)
    run.start()
    run.skip()
    expect(run.index).toBe(1)
    c.advance(50_000)
    run.split()
    expect(run.splitTimes).toEqual([null, 50_000, null])
    expect(segmentTime(run, 0)).toBeNull()
    expect(segmentTime(run, 1)).toBeNull()
  })

  it('S3 最後一段 split → finished,index = 段數', () => {
    const c = clock()
    const run = createRun(mk(['a', 'b']), c.now)
    run.start()
    c.advance(1_000)
    run.split()
    c.advance(1_000)
    run.split()
    expect(run.phase).toBe('finished')
    expect(run.index).toBe(2)
  })
})

describe('PB 與金段', () => {
  it('S6 與 PB 差值:提早 5 秒 → −5000,慢 10 秒 → +10000', () => {
    const c = clock()
    const route = mk(['a', 'b'], { pb: [60_000, 120_000] })
    const run = createRun(route, c.now)
    run.start()
    c.advance(55_000)
    run.split()
    c.advance(75_000)
    run.split()
    expect(run.splitTimes).toEqual([55_000, 130_000])
    expect(deltaAt(run, route, 0)).toBe(-5_000)
    expect(deltaAt(run, route, 1)).toBe(10_000)
  })

  it('S6 沒有 PB 或該段沒跑到 → null', () => {
    const c = clock()
    const noPb = mk(['a', 'b'])
    const run1 = createRun(noPb, c.now)
    run1.start()
    c.advance(1_000)
    run1.split()
    expect(deltaAt(run1, noPb, 0)).toBeNull()

    const withPb = mk(['a', 'b'], { pb: [60_000, 120_000] })
    const run2 = createRun(withPb, c.now)
    run2.start()
    expect(deltaAt(run2, withPb, 1)).toBeNull()
  })

  it('S7 金段:這次段 55000 比金 60000 快 → 更新,70000 比金慢 → 不動', () => {
    const c = clock()
    const route = mk(['a', 'b'], { golds: [60_000, 60_000] })
    const run = createRun(route, c.now)
    run.start()
    c.advance(55_000)
    run.split()
    c.advance(70_000)
    run.split()
    expect(route.golds).toEqual([55_000, 60_000])
  })

  it('S7 金段是 null(沒紀錄)時第一次跑出來的段時間直接成為金段', () => {
    const c = clock()
    const route = mk(['a', 'b'])
    const run = createRun(route, c.now)
    run.start()
    c.advance(40_000)
    run.split()
    expect(route.golds).toEqual([40_000, null])
  })

  it('S7 前一段被跳過時,下一段不更新金段(段時間不可靠)', () => {
    const c = clock()
    const route = mk(['a', 'b', 'c'])
    const run = createRun(route, c.now)
    run.start()
    run.skip()
    c.advance(50_000)
    run.split()
    expect(route.golds).toEqual([null, null, null])
  })

  it('S7 sumOfBest:金段全有值才加總,有 null → null', () => {
    expect(sumOfBest(mk(['a', 'b'], { golds: [30_000, 40_000] }))).toBe(70_000)
    expect(sumOfBest(mk(['a', 'b'], { golds: [30_000, null] }))).toBeNull()
  })

  it('S8 跑完比 PB 快才換 PB;較慢的一次不換', () => {
    const c = clock()
    const route = mk(['a', 'b'], { pb: [60_000, 130_000] })

    const fast = createRun(route, c.now)
    fast.start()
    c.advance(50_000)
    fast.split()
    c.advance(70_000)
    fast.split()
    expect(route.pb).toEqual([50_000, 120_000])

    const slow = createRun(route, c.now)
    slow.start()
    c.advance(60_000)
    slow.split()
    c.advance(80_000)
    slow.split()
    expect(route.pb).toEqual([50_000, 120_000])
  })

  it('S8 原本沒有 PB 時,跑完的那次直接成為 PB', () => {
    const c = clock()
    const route = mk(['a', 'b'])
    const run = createRun(route, c.now)
    run.start()
    c.advance(30_000)
    run.split()
    c.advance(30_000)
    run.split()
    expect(route.pb).toEqual([30_000, 60_000])
  })

  it('S8 新 PB 是複本:之後 reset 重跑不會改到已存的 PB', () => {
    const c = clock()
    const route = mk(['a', 'b'])
    const run = createRun(route, c.now)
    run.start()
    c.advance(30_000)
    run.split()
    c.advance(30_000)
    run.split()
    const saved = route.pb
    run.reset()
    expect(route.pb).toEqual([30_000, 60_000])
    expect(route.pb).toBe(saved)
    expect(run.splitTimes).toEqual([null, null])
  })

  it('S8 沒跑完就 reset:PB 不動、已更新的金段保留、回到 idle', () => {
    const c = clock()
    const route = mk(['a', 'b'], { pb: [60_000, 130_000] })
    const run = createRun(route, c.now)
    run.start()
    c.advance(40_000)
    run.split()
    run.reset()
    expect(run.phase).toBe('idle')
    expect(run.index).toBe(0)
    expect(run.splitTimes).toEqual([null, null])
    expect(route.pb).toEqual([60_000, 130_000])
    expect(route.golds[0]).toBe(40_000)
  })

  it('S8 每次 start 讓 attempts + 1', () => {
    const c = clock()
    const route = mk(['a'])
    const run = createRun(route, c.now)
    run.start()
    expect(route.attempts).toBe(1)
    run.reset()
    run.start()
    expect(route.attempts).toBe(2)
  })
})

describe('自動開始 / 分段', () => {
  it('S9 idle + autoStart + 進 startArea → start;不是 startArea → null', () => {
    const route = presetRoute('poe1', 'en')
    const run = createRun(route, clock().now)
    expect(autoAction(run, route, '1_1_1')).toBe('start')
    expect(autoAction(run, route, '1_2_town')).toBeNull()
  })

  it('S9 autoStart 關閉 → null', () => {
    const route = { ...presetRoute('poe1', 'en'), autoStart: false }
    const run = createRun(route, clock().now)
    expect(autoAction(run, route, '1_1_1')).toBeNull()
  })

  it('S10 PoE1 跑第 3 段時:進 1_2_town(前面的城)→ null;進 1_4_town → split', () => {
    const c = clock()
    const route = presetRoute('poe1', 'en')
    const run = createRun(route, c.now)
    run.start()
    run.split()
    run.split()
    expect(run.index).toBe(2)
    expect(autoAction(run, route, '1_2_town')).toBeNull()
    expect(autoAction(run, route, '1_4_town')).toBe('split')
  })

  it('S10 autoSplit 關閉 → null', () => {
    const c = clock()
    const route = { ...presetRoute('poe1', 'en'), autoSplit: false }
    const run = createRun(route, c.now)
    run.start()
    run.split()
    run.split()
    expect(autoAction(run, route, '1_4_town')).toBeNull()
  })

  it('S10 跑著時再進 startArea 不會重新 start', () => {
    const route = presetRoute('poe1', 'en')
    const run = createRun(route, clock().now)
    run.start()
    expect(autoAction(run, route, '1_1_1')).toBeNull()
  })

  it('S10 手動分段(area 為 null)的那一段不會被自動分段觸發', () => {
    const route = mk([null, 'x_town'])
    const run = createRun(route, clock().now)
    run.start()
    expect(autoAction(run, route, 'x_town')).toBeNull()
  })

  it('S10 跑完(finished)後不再回 split', () => {
    const route = mk(['a'])
    const run = createRun(route, clock().now)
    run.start()
    run.split()
    expect(run.phase).toBe('finished')
    expect(autoAction(run, route, 'a')).toBeNull()
  })
})

describe('replaceSplits', () => {
  const base = (): Route => mk(['a', 'b', 'c'], { pb: [10, 20, 30], golds: [10, 10, 10], attempts: 5 })

  it('S15 刪一段 → pb null、golds 長度跟新清單且全 null,其餘欄位保留', () => {
    const r = replaceSplits(base(), [{ name: 'S0', area: 'a' }, { name: 'S1', area: 'b' }])
    expect(r.pb).toBeNull()
    expect(r.golds).toEqual([null, null])
    expect(r.splits.length).toBe(2)
    expect(r.attempts).toBe(5)
  })

  it('S15 只改名字 → pb / golds 保留', () => {
    const r = replaceSplits(base(), [{ name: 'X', area: 'a' }, { name: 'Y', area: 'b' }, { name: 'Z', area: 'c' }])
    expect(r.pb).toEqual([10, 20, 30])
    expect(r.golds).toEqual([10, 10, 10])
    expect(r.splits.map(s => s.name)).toEqual(['X', 'Y', 'Z'])
  })

  it('S15 段數不變但某段 area 改了 → 同樣清 PB 與金段', () => {
    const r = replaceSplits(base(), [{ name: 'S0', area: 'a' }, { name: 'S1', area: 'zzz' }, { name: 'S2', area: 'c' }])
    expect(r.pb).toBeNull()
    expect(r.golds).toEqual([null, null, null])
  })

  it('S15 回新物件,不改到傳入的路線', () => {
    const orig = base()
    const r = replaceSplits(orig, [{ name: 'S0', area: 'a' }])
    expect(r).not.toBe(orig)
    expect(orig.splits.length).toBe(3)
    expect(orig.pb).toEqual([10, 20, 30])
  })
})

describe('時間格式', () => {
  it('S17 formatRunTime:百分之一秒無條件捨去、超過一小時加時', () => {
    expect(formatRunTime(0)).toBe('0:00.00')
    expect(formatRunTime(59_994)).toBe('0:59.99')
    expect(formatRunTime(59_999)).toBe('0:59.99')
    expect(formatRunTime(61_000)).toBe('1:01.00')
    expect(formatRunTime(3_600_000)).toBe('1:00:00.00')
    expect(formatRunTime(3_599_990)).toBe('59:59.99')
  })

  it('S17 formatDelta:正數 +、負數用 U+2212,一位小數無條件捨去絕對值', () => {
    expect(formatDelta(1_200)).toBe('+1.2')
    expect(formatDelta(-800)).toBe('−0.8')
    expect(formatDelta(1_999)).toBe('+1.9')
    expect(formatDelta(-1_999)).toBe('−1.9')
    expect(formatDelta(-800).charCodeAt(0)).toBe(0x2212)
  })
})
