import { beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * 開季自動化的純函式測試(依賴全部以參數注入,不連網、不讀真實資料檔)。
 * 實作:`scripts/season/lib.mjs`。
 */

// 動態 import 在 poe1 的 vitest 解析不到 repo 根的 scripts/(既有測試都用靜態 import)
import * as libModule from '../../scripts/season/lib.mjs'
const lib: any = libModule
const load = async (): Promise<void> => {}

describe('untilStable(S5 S6)', () => {
  beforeAll(load)

  it('第 2 輪前後相同就停,回傳 2 輪且 round 依序 1、2', async () => {
    // hash 呼叫順序:R1 before=a, R1 after=b, R2 before=b, R2 after=b
    const seq = ['a', 'b', 'b', 'b']
    let i = 0
    const rounds: number[] = []
    const r = await lib.untilStable({
      run: async (n: number) => { rounds.push(n) },
      hash: async () => seq[i++]
    })
    expect(r).toEqual({ rounds: 2, stable: true })
    expect(rounds).toEqual([1, 2])
  })

  it('每輪都變動則跑滿 5 輪、stable 為 false 且不 throw', async () => {
    let h = 0
    let runs = 0
    const r = await lib.untilStable({
      run: async () => { runs++ },
      hash: async () => String(h++),
      maxRounds: 5
    })
    expect(r).toEqual({ rounds: 5, stable: false })
    expect(runs).toBe(5)
  })

  it('第 1 輪就沒變動時只跑 1 輪', async () => {
    let runs = 0
    const r = await lib.untilStable({ run: async () => { runs++ }, hash: async () => 'same' })
    expect(r).toEqual({ rounds: 1, stable: true })
    expect(runs).toBe(1)
  })
})

describe('precheck(S7 S8)', () => {
  beforeAll(load)

  const okCounts = { ggpk_stat: 10, ggpk_cell: 10, ggpk_row: 10, rel: 10 }
  const two = [
    { id: 3, gameVersion: '3.29.3', complete: 1 },
    { id: 5, gameVersion: '3.30.0d', complete: 1 }
  ]
  const base = { dockerOk: async () => true, tableCounts: async () => okCounts }

  it('poe1 全部正常:ok、old/new 為最新兩個版本', async () => {
    const r = await lib.precheck({ game: 'poe1', versions: two, ...base })
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.old.id).toBe(3)
    expect(r.new.id).toBe(5)
  })

  it('poe1 的 rel 表為 0 時 ok 為 false,錯誤同時提到 rel 與 PobTools', async () => {
    const r = await lib.precheck({
      game: 'poe1', versions: two, ...base,
      tableCounts: async () => ({ ...okCounts, rel: 0 })
    })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e: string) => e.includes('rel') && e.includes('PobTools'))).toBe(true)
  })

  it('poe2 只有一個 complete 版本:ok 為 true、警告含「沒有舊版」、old 等於 new', async () => {
    const r = await lib.precheck({
      game: 'poe2', versions: [{ id: 7, gameVersion: '0.5.5e', complete: 1 }], ...base
    })
    expect(r.ok).toBe(true)
    expect(r.warnings.some((w: string) => w.includes('沒有舊版'))).toBe(true)
    expect(r.old.id).toBe(r.new.id)
  })

  it('poe1 只有一個 complete 版本時 ok 為 false', async () => {
    const r = await lib.precheck({
      game: 'poe1', versions: [{ id: 5, gameVersion: '3.30.0d', complete: 1 }], ...base
    })
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it('兩個版本但其中一個 complete 為 0 時,poe1 判 error(不算進去)', async () => {
    const r = await lib.precheck({
      game: 'poe1',
      versions: [{ id: 3, gameVersion: '3.29.3', complete: 1 }, { id: 5, gameVersion: '3.30.0d', complete: 0 }],
      ...base
    })
    expect(r.ok).toBe(false)
  })

  it('沒有任何 complete 版本時 ok 為 false(poe2 也一樣)', async () => {
    const r = await lib.precheck({
      game: 'poe2', versions: [{ id: 7, gameVersion: '0.5.5e', complete: 0 }], ...base
    })
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it('docker 不可用時 ok 為 false', async () => {
    const r = await lib.precheck({ game: 'poe1', versions: two, ...base, dockerOk: async () => false })
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it('任一表列數為 0 時錯誤訊息含該表名與 PobTools', async () => {
    const r = await lib.precheck({
      game: 'poe1', versions: two, ...base,
      tableCounts: async () => ({ ...okCounts, ggpk_cell: 0 })
    })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e: string) => e.includes('ggpk_cell') && e.includes('PobTools'))).toBe(true)
  })
})

describe('setGameVersion(S9)', () => {
  beforeAll(load)

  const lf = "export const SUPPORTED_GAME_VERSIONS = {\n  poe1: '3.30.0',\n  poe2: '0.5.5e'\n} as const\n"
  const crlf = lf.replace(/\n/g, '\r\n')

  it('只改 poe1 那一行,poe2 行與其餘位元組不變', () => {
    const out = lib.setGameVersion(lf, 'poe1', '3.30.0d')
    expect(out).toBe("export const SUPPORTED_GAME_VERSIONS = {\n  poe1: '3.30.0d',\n  poe2: '0.5.5e'\n} as const\n")
  })

  it('只改 poe2 時 poe1 行不變', () => {
    const out = lib.setGameVersion(lf, 'poe2', '0.6.0')
    expect(out).toBe("export const SUPPORTED_GAME_VERSIONS = {\n  poe1: '3.30.0',\n  poe2: '0.6.0'\n} as const\n")
  })

  it('同版本再呼叫一次結果完全相同(冪等)', () => {
    const once = lib.setGameVersion(lf, 'poe1', '3.30.0d')
    expect(lib.setGameVersion(once, 'poe1', '3.30.0d')).toBe(once)
  })

  it('CRLF 來源輸出仍是 CRLF 且沒有多出裸 LF', () => {
    const out = lib.setGameVersion(crlf, 'poe1', '3.30.0d')
    expect(out).toBe(crlf.replace("'3.30.0'", "'3.30.0d'"))
    expect(out.replace(/\r\n/g, '')).not.toMatch(/\n/)
  })

  it('找不到該遊戲那一行時 throw', () => {
    expect(() => lib.setGameVersion("export const X = {\n  poe1: '1'\n}\n", 'poe2', '1')).toThrow()
  })
})

describe('bumpVersion(S10)', () => {
  beforeAll(load)

  const pkg = '{\n  "name": "x",\n  "version": "0.3.19",\n  "dependencies": {\n    "x": {\n      "version": "1.0.0"\n    }\n  }\n}\n'

  it('只改頂層 version,巢狀依賴裡的 version 與其餘位元組不動', () => {
    const out = lib.bumpVersion(pkg, '0.3.20')
    expect(out).toBe(pkg.replace('"0.3.19"', '"0.3.20"'))
    expect(out).toContain('"version": "1.0.0"')
  })

  it('CRLF 與結尾換行保留', () => {
    const c = pkg.replace(/\n/g, '\r\n')
    expect(lib.bumpVersion(c, '0.3.20')).toBe(c.replace('"0.3.19"', '"0.3.20"'))
  })

  it.each(['0.3', 'v0.3.20', '0.3.20-beta'])('不合格版號 %s 會 throw', (v) => {
    expect(() => lib.bumpVersion(pkg, v)).toThrow()
  })
})

describe('renamedEntryIds(S4)', () => {
  beforeAll(load)

  it('舊 id 消失且 en[0] 在新版唯一對到別的 id 時加入對照,含 | 的 id 不加,existing 保留', () => {
    const out = lib.renamedEntryIds({
      before: [{ id: 'stat_1', en: ['A'] }, { id: 'stat_2', en: ['B'] }, { id: 'stat_9|C', en: ['C'] }],
      after: [{ id: 'indexable_support_5', en: ['A'] }, { id: 'stat_2', en: ['B'] }, { id: 'stat_9', en: ['C'] }],
      existing: { old: 'x' }
    })
    expect(out).toEqual({ old: 'x', stat_1: 'indexable_support_5' })
  })

  it('新版有多個同 en[0] 的項目時不加(無法唯一對應)', () => {
    const out = lib.renamedEntryIds({
      before: [{ id: 'stat_1', en: ['A'] }],
      after: [{ id: 'n1', en: ['A'] }, { id: 'n2', en: ['A'] }],
      existing: {}
    })
    expect(out).toEqual({})
  })

  it('existing 已有的鍵不被覆寫', () => {
    const out = lib.renamedEntryIds({
      before: [{ id: 'stat_1', en: ['A'] }],
      after: [{ id: 'n1', en: ['A'] }],
      existing: { stat_1: 'keep' }
    })
    expect(out.stat_1).toBe('keep')
  })

  it('舊句被併進另一列(ref 不同)時靠 aliasOf 對上', () => {
    // PoE1 規則 30:「… Flamewood」那列併進「… Flamewood (Random Support Gem)」,舊句留作 superseded 寫法
    const out = lib.renamedEntryIds({
      before: [{ id: 'stat_285773939', en: ['Socketed Gems are Supported by Level # Flamewood'] }],
      after: [{ id: 'indexable_support_154', en: ['Socketed Gems are Supported by Level # Flamewood (Random Support Gem)'] }],
      aliasOf: (s: string) => s === 'Socketed Gems are Supported by Level # Flamewood' ? ['Socketed Gems are Supported by Level # Flamewood (Random Support Gem)'] : []
    })
    expect(out).toEqual({ stat_285773939: 'indexable_support_154' })
  })

  it('舊 id 在新版仍存在時不加', () => {
    const out = lib.renamedEntryIds({
      before: [{ id: 'stat_2', en: ['B'] }],
      after: [{ id: 'stat_2', en: ['B'] }],
      existing: {}
    })
    expect(out).toEqual({})
  })
})

describe('probeTwinIds(S11)', () => {
  beforeAll(load)

  it('429 後依 retryAfter 秒睡眠再重試同一個 id,結果記 total', async () => {
    const replies = [{ status: 429, retryAfter: 2 }, { status: 200, total: 3 }]
    const sleeps: number[] = []
    const calls: string[] = []
    const out = await lib.probeTwinIds({
      ids: ['A'],
      search: async (id: string) => { calls.push(id); return replies.shift() },
      sleep: async (ms: number) => { sleeps.push(ms) }
    })
    expect(sleeps).toEqual([2000])
    expect(calls).toEqual(['A', 'A'])
    expect(out).toEqual([{ id: 'A', total: 3 }])
  })

  it('連續 429 超過 3 次記 error 429,sleep 恰好 3 次', async () => {
    const sleeps: number[] = []
    const out = await lib.probeTwinIds({
      ids: ['A'],
      search: async () => ({ status: 429, retryAfter: 1 }),
      sleep: async (ms: number) => { sleeps.push(ms) }
    })
    expect(sleeps).toHaveLength(3)
    expect(out).toEqual([{ id: 'A', error: '429' }])
  })

  it('其他 status 記成 error 字串,結果順序同 ids', async () => {
    const out = await lib.probeTwinIds({
      ids: ['A', 'B', 'C'],
      search: async (id: string) => id === 'B' ? { status: 500 } : { status: 200, total: id === 'A' ? 1 : 0 },
      sleep: async () => {}
    })
    expect(out).toEqual([{ id: 'A', total: 1 }, { id: 'B', error: '500' }, { id: 'C', total: 0 }])
  })
})

describe('addLiveTwins(S12)', () => {
  beforeAll(load)

  it('只附加 total > 0 且不在清單的 id,不修改輸入', () => {
    const list = ['x']
    const out = lib.addLiveTwins(list, [
      { id: 'A', total: 5 }, { id: 'B', total: 0 }, { id: 'x', total: 9 }, { id: 'C', error: '500' }
    ])
    expect(out).toEqual(['x', 'A'])
    expect(list).toEqual(['x'])
  })
})

describe('舊賽季版號殘留守門(S15)', () => {
  it('git grep 在 docs/poe1-season 與本檔以外找不到賽季版號檔名引用', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const r = spawnSync('git', [
      'grep', '-n', '-E', 'trade-stat-ids|3\\.30-issue|season-330|trade-(stats|catalog)-3\\.30',
      '--', '.', ':(exclude)docs/poe1-season', ':(exclude)poe1/test/season-automation.test.ts'
    ], { cwd: root, encoding: 'utf8' })
    expect(r.status === 0 ? r.stdout : '').toBe('')
    expect(r.status).toBe(1)
  })
})
