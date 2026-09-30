// WP-S:揭露面板 OCR 徽章的純邏輯(renderer/src/web/overlay/ocr-reveal.ts)
import { describe, expect, it } from 'vitest'
import {
  BADGE_GAP_PX, LAST_ITEM_TTL_MS, closeRegionPicker, layoutBadges, openRegionPicker, profileHint, regionPickerClosed,
  regionPickerOpen, returnsToSettings, tierText, type BadgeFormat
} from '../src/web/overlay/ocr-reveal'

describe('OCR 框選結束後回到設定(設定視窗)', () => {
  it('只有由設定開啟、且使用者自己結束(確認 / 取消 / 清除)才回設定', () => {
    for (const o of ['confirm', 'cancel', 'clear'] as const) expect(returnsToSettings('settings', o)).toBe(true)
    expect(returnsToSettings('settings', 'lost')).toBe(false)
    for (const o of ['confirm', 'cancel', 'clear', 'lost'] as const) expect(returnsToSettings('hotkey', o)).toBe(false)
    expect(returnsToSettings(null, 'confirm')).toBe(false)
  })

  it('closeRegionPicker 在關閉前記下來源與結果', () => {
    openRegionPicker('settings')
    expect(regionPickerOpen.value).toBe(true)
    closeRegionPicker('測試', 'confirm')
    expect(regionPickerOpen.value).toBe(false)
    expect(regionPickerClosed.value).toEqual({ source: 'settings', outcome: 'confirm' })
    openRegionPicker('hotkey')
    closeRegionPicker('測試')
    expect(regionPickerClosed.value).toEqual({ source: 'hotkey', outcome: 'cancel' })
    // 已關閉時再關不覆寫
    closeRegionPicker('再關', 'lost')
    expect(regionPickerClosed.value).toEqual({ source: 'hotkey', outcome: 'cancel' })
  })
})

const fmt: BadgeFormat = {
  tier: tierText,
  pool: c => c.pool === 'normal' ? '一般' : c.pool,
  range: c => c.ranges.map(r => r ? `${r[0]}–${r[1]}` : '?').join(' / ')
}

const line = (text: string, y: number, matched = true) => ({ text, x: 400, y, w: 120, h: 24, match: matched ? { norm: text } : null })

describe('profileHint', () => {
  it('10 分鐘內的物品才算', () => {
    const last = { refName: 'Rogue Armour', category: 'Body Armour', at: 1_000 }
    expect(profileHint(last, 1_000 + LAST_ITEM_TTL_MS)).toEqual({ refName: 'Rogue Armour', category: 'Body Armour' })
    expect(profileHint(last, 1_000 + LAST_ITEM_TTL_MS + 1)).toEqual({})
    expect(profileHint(null)).toEqual({})
  })
})

describe('tierText', () => {
  it('單一 / 範圍', () => {
    expect(tierText({ tier: 4, tierRange: [4, 4] })).toBe('T4')
    expect(tierText({ tier: undefined, tierRange: [3, 5] })).toBe('T3–T5')
    expect(tierText({ tier: undefined, tierRange: [2, 2] })).toBe('T2')
  })
})

describe('layoutBadges', () => {
  const result = {
    ok: true as const,
    profileExact: false,
    profileSource: 'intersection' as const,
    groups: [
      {
        lines: [line('+86 護 甲 值', 529), line('+79 閃 避 值', 565)],
        rect: { x: 408, y: 529, w: 116, h: 60 },
        partial: false,
        candidates: [{ tier: 4, tierRange: [4, 4] as [number, number], pool: 'normal' as const, ranges: [[86, 102], [79, 94]] as Array<[number, number]>, fuzzy: false, entryIds: ['a'] }]
      },
      {
        lines: [line('增 加 25 % 護 甲 值 和 閃 避', 637), line('@@ 看 不 懂', 673, false)],
        rect: { x: 341, y: 637, w: 249, h: 60 },
        partial: true,
        candidates: [{ tier: undefined, tierRange: [3, 5] as [number, number], pool: 'normal' as const, ranges: [[21, 26]] as Array<[number, number]>, fuzzy: true, entryIds: ['b'] }]
      },
      {
        lines: [line('+17 護 甲 值', 727)],
        rect: { x: 408, y: 727, w: 115, h: 23 },
        partial: false,
        candidates: []
      }
    ]
  }

  it('client 實體像素 → CSS px(overlay 150% 縮放:client 1920 寬 = CSS 1280)', () => {
    const v = layoutBadges(result, { w: 1920, h: 1080 }, { w: 1280, h: 720 }, fmt)
    expect(v).toHaveLength(3)
    expect(v[0].left).toBe(Math.round((408 + 116) * (1280 / 1920) + BADGE_GAP_PX))
    expect(v[0].top).toBe(Math.round((529 + 30) * (720 / 1080)))
  })

  it('徽章文字:Tier(profile 不精確加 ?)· 詞綴池 · 範圍;模糊命中加 ≈;對不上的行列原文;沒候選標 empty', () => {
    const v = layoutBadges(result, { w: 1920, h: 1080 }, { w: 1920, h: 1080 }, fmt)
    expect(v[0].rows.map(r => r.text)).toEqual(['T4? · 一般 · 86–102 / 79–94'])
    expect(v[1].rows.map(r => r.text)).toEqual(['≈ T3–T5? · 一般 · 21–26'])
    expect(v[1].rows[0].fuzzy).toBe(true)
    expect(v[1].unmatched).toEqual(['@@看不懂'])
    expect(v[2].empty).toBe(true)
    expect(v.every(b => b.guess)).toBe(true)
  })

  it('profile 精確時不加 ?', () => {
    const v = layoutBadges({ ...result, profileExact: true }, { w: 1920, h: 1080 }, { w: 1920, h: 1080 }, fmt)
    expect(v[0].rows[0].text).toBe('T4 · 一般 · 86–102 / 79–94')
  })
})
