import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'

/**
 * M7 英文客戶端 3.30 地圖。⚠ 合成文字、沒有實機樣本:以 `fixtures/en/map-rare-01.txt` 為底,
 * 加一行 `Atlas Drops: +49% (augmented)`、把 `More Scarabs` 換成 `More Threads`(2026-11-16)。
 */
const BASE = fs.readFileSync(path.resolve(__dirname, 'fixtures/en/map-rare-01.txt'), 'utf8')

function synth (): string {
  const text = BASE
    .replace(/^Item Quantity: .*$/m, 'Atlas Drops: +49% (augmented)\nItem Quantity: +84% (augmented)')
    .replace(/^More Scarabs: .*$/m, 'More Threads: +35% (augmented)')
  // 底稿必須真的被換到,否則下面的斷言會是在測沒變的底稿
  expect(text).toContain('Atlas Drops: +49%')
  expect(text).toContain('More Threads: +35%')
  expect(text).not.toContain('More Scarabs')
  return text
}

describe('M7 英文客戶端 3.30 地圖(合成文字)', () => {
  beforeAll(async () => { await init('en') }, 180_000)

  // 失敗代表:英文的 Atlas Drops / More Threads 行沒被讀
  it('讀到輿圖掉落物 49 與更多綢帶 35', () => {
    const result = parseClipboard(synth())
    if (result.isErr()) throw new Error(`解析失敗:${result.error}`)
    expect((result.value as any).areaAtlasDrops).toBe(49)
    expect(result.value.mapMoreScarabs).toBe(35)
  })

  it('舊的 More Scarabs 英文字串仍讀成更多聖甲蟲', () => {
    const result = parseClipboard(BASE)
    if (result.isErr()) throw new Error(`解析失敗:${result.error}`)
    expect(result.value.mapMoreScarabs).toBe(53)
  })
})
