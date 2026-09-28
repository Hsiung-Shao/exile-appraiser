import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { init, TRADE_ITEM_BY_REF, TRADE_STAT_BY_STAT_ID } from '@/assets/data'
import { setupTests } from './vitest.setup'

/**
 * 守住「移植檔只切耦合點」:src 的 .ts 不得再碰上游的殼層模組(Vue 設定、IPC、overlay、import.meta.env)。
 * tsconfig 為了讓上游測試拿 `Config` 型別,把 `@/web/Config` 指到 test/shims —— 那條 path 對 src 也生效,
 * 所以 src 若又 import 它,型別檢查會「假綠」。這支測試把那個洞補起來。
 * (.vue 不在此列:它們住在 renderer 的世界,@/web/* 由 renderer 提供。)
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')

function listTs (dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? listTs(p) : (p.endsWith('.ts') ? [p] : [])
  })
}

/** 上游本來就是 Vue composable 的三個檔(只給 .vue 用,解析 / 查詢流程不經過它們)。 */
const VUE_COMPOSABLES = new Set(['trade-api.ts', 'bulk-api.ts', 'artificial-slowdown.ts'])

describe('src 耦合點', () => {
  const files = listTs(SRC)

  it('掃到足夠多的檔案', () => {
    expect(files.length).toBeGreaterThan(40)
  })

  it('不 import @/web/Config、@/web/background/IPC、@/web/overlay、@/web/background/Leagues', () => {
    const bad = files.flatMap(f => {
      const text = fs.readFileSync(f, 'utf8')
      return /from\s+["']@\/web\/(Config|background\/IPC|overlay\/|background\/Leagues)/.test(text) ? [path.relative(SRC, f)] : []
    })
    expect(bad).toEqual([])
  })

  it('不用 import.meta.env / 全域 fetch(資料走 DataSource、網路走 ctx.http)', () => {
    // 例外:browser-source.ts 本身就是 DataSource 的瀏覽器實作(fetch 資料檔);cli.ts 是 Node CLI,自己組 HttpFetch 注入
    const bad = files.filter(f => !['browser-source.ts', 'cli.ts'].includes(path.basename(f))).flatMap(f => {
      const code = fs.readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')
      return /import\.meta\.env|(?<![.\w])fetch\(/.test(code) ? [path.relative(SRC, f)] : []
    })
    expect(bad).toEqual([])
  })

  it('只有上游本來的 Vue composable 會 import vue', () => {
    const bad = files.flatMap(f => {
      const text = fs.readFileSync(f, 'utf8')
      return /from\s+["']vue["']/.test(text) && !VUE_COMPOSABLES.has(path.basename(f)) ? [path.relative(SRC, f)] : []
    })
    expect(bad).toEqual([])
  })
})

describe('交易站 data 離線快照(TradeData 取代上游線上載入)', () => {
  it('TRADE_ITEM_BY_REF / TRADE_STAT_BY_STAT_ID 有接上 data/poe2/trade/intl 快照', async () => {
    setupTests()
    await init('en')
    expect(TRADE_ITEM_BY_REF({ baseType: 'Kamasan Tiara' })?.[0].refName).toBe('Kamasan Tiara')
    expect(TRADE_STAT_BY_STAT_ID('explicit.stat_4015621042')).toBe(true)
    expect(TRADE_STAT_BY_STAT_ID('explicit.stat_does_not_exist')).toBe(false)
  })
})
