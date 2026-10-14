// 查價面板 B 改版(2026-10-14 使用者實機):詞綴列範圍膠囊「最小 / 最大」提示字與「–」調亮,背景圖模式也要清楚。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = fs.readFileSync(path.resolve(__dirname, '../src/web/price-panel/ModRange.vue'), 'utf8')

describe('範圍膠囊提示字顏色', () => {
  it('「–」用較亮的 --ink-2(不是最暗的 --ink-4)', () => {
    expect(src).toMatch(/\.sep\s*\{[^}]*color:\s*var\(--ink-2\)/)
  })
  it('placeholder 選擇器寫成 :slotted(input)::placeholder 且用 --ink-2', () => {
    expect(src).toMatch(/:slotted\(input\)::placeholder\s*\{[^}]*color:\s*var\(--ink-2\)/)
    expect(src).not.toMatch(/:slotted\(input::placeholder\)/)
    expect(src).not.toMatch(/--ink-4/)
  })
})
