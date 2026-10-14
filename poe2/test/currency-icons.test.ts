// P1 通貨圖示兩代分開:PoE2 圖檔存在且是 PNG;poe2/src 不再引用 PoE1 的通貨圖。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '../src')
const ICONS = path.resolve(HERE, '../../renderer/public/images/poe2')

function walk (dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
}

describe('PoE2 通貨圖示', () => {
  it('Q2 五個圖檔都存在且是 PNG', () => {
    for (const k of ['exa', 'divine', 'chaos', 'annul', 'wisdom']) {
      const buf = fs.readFileSync(path.join(ICONS, `${k}.png`))
      expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    }
  })

  it('Q3 poe2/src 不再引用 PoE1 通貨圖 /images/(exa|chaos|divine|annul|wisdom|div).png', () => {
    const bad = walk(SRC)
      .filter(f => /\.(ts|vue)$/.test(f))
      .filter(f => /\/images\/(exa|chaos|divine|annul|wisdom|div)\.png/.test(fs.readFileSync(f, 'utf8')))
    expect(bad).toEqual([])
  })
})
