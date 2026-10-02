// WP-S:揭露面板 OCR 徽章的純邏輯(renderer/src/web/overlay/ocr-reveal.ts)
import { describe, expect, it } from 'vitest'
import {
  BADGE_GAP_PX, BADGE_STACK_GAP_PX, LAST_ITEM_TTL_MS, badgeMetrics, closeRegionPicker, estimateBadgeHeight, guessNote, guessNoteKey, layoutBadges,
  openRegionPicker, profileHint, regionPickerClosed, regionPickerOpen, rejectedHintLog, returnsToSettings, stackBadges, tierText, type BadgeFormat, type BadgeView
} from '../src/web/overlay/ocr-reveal'
import zhHant from '../src/i18n/cmn-Hant.json'
import en from '../src/i18n/en.json'

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

  it('client 實體像素 → CSS px(overlay 150% 縮放:client 1920 寬 = CSS 1280);左緣對齊所有組右緣的最大值 + 14、上緣 = 組中心 − 半高', () => {
    const v = layoutBadges(result, { w: 1920, h: 1080 }, { w: 1280, h: 720 }, fmt)
    expect(v).toHaveLength(3)
    const left = Math.round((341 + 249) * (1280 / 1920) + BADGE_GAP_PX) // 第 2 組右緣最大
    expect(v.map(b => b.left)).toEqual([left, left, left])
    expect(v[0].anchorY).toBeCloseTo((529 + 30) * (720 / 1080))
    const h0 = estimateBadgeHeight(v[0])
    expect(v[0].top).toBe(Math.round(v[0].anchorY - h0 / 2))
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

describe('第 13 步:徽章防碰撞與多候選收合', () => {
  const cand = (tier: number, lo: number, fuzzy = false) =>
    ({ tier, tierRange: [tier, tier] as [number, number], pool: 'normal' as const, ranges: [[lo, lo + 5]] as Array<[number, number]>, fuzzy, entryIds: [`e${tier}`] })
  /** 使用者回報的樣子:5 組各一行、行距只有 29 px(物品浮窗被當成面板時),一組 3 個候選 */
  const crowded = {
    ok: true as const,
    profileExact: false,
    profileSource: 'all' as const,
    groups: [434, 464, 493, 522, 547].map((y, i) => ({
      lines: [line(`詞 綴 ${i}`, y)],
      rect: { x: 1200 + i * 40, y, w: 250 - i * 30, h: 20 },
      partial: false,
      candidates: i === 2 ? [cand(2, 2, true), cand(3, 2), cand(4, 2)] : [cand(2, 30 + i)]
    }))
  }
  const noOverlap = (v: BadgeView[], heights: number[]) => {
    const order = v.map((_, i) => i).sort((a, b) => v[a].top - v[b].top)
    for (let k = 1; k < order.length; k++) {
      const a = order[k - 1]
      const b = order[k]
      expect(v[b].top - (v[a].top + heights[a])).toBeGreaterThanOrEqual(2)
    }
  }

  it('依組中心由上而下推開:相鄰兩枚至少隔 2 px(預設 4 px),左緣全部對齊', () => {
    const v = layoutBadges(crowded, { w: 1920, h: 1080 }, { w: 1920, h: 1080 }, fmt)
    expect(new Set(v.map(b => b.left)).size).toBe(1)
    expect(v[0].left).toBe(Math.round(Math.max(...crowded.groups.map(g => g.rect.x + g.rect.w)) + BADGE_GAP_PX))
    noOverlap(v, v.map(b => estimateBadgeHeight(b)))
    // 順序與組的上下順序相同
    expect(v.map(b => b.top)).toEqual([...v.map(b => b.top)].sort((a, b) => a - b))
    expect(BADGE_STACK_GAP_PX).toBeGreaterThanOrEqual(2)
  })

  it('預設一組只列最可能的一個(第一個非模糊)+「+N」;顯示全部候選時全列,仍不重疊', () => {
    const v = layoutBadges(crowded, { w: 1920, h: 1080 }, { w: 1920, h: 1080 }, fmt)
    expect(v[2].rows.map(r => r.text)).toEqual(['T3? · 一般 · 2–7'])
    expect(v[2].more).toBe(2)
    expect(v.filter((_, i) => i !== 2).every(b => b.more === 0 && b.rows.length === 1)).toBe(true)
    const all = layoutBadges(crowded, { w: 1920, h: 1080 }, { w: 1920, h: 1080 }, fmt, { showAll: true })
    expect(all[2].rows.map(r => r.text)).toEqual(['≈ T2? · 一般 · 2–7', 'T3? · 一般 · 2–7', 'T4? · 一般 · 2–7'])
    expect(all[2].more).toBe(0)
    noOverlap(all, all.map(b => estimateBadgeHeight(b)))
  })

  it('超出視窗下緣 → 整體上移(間距不變);擠不下時第一枚貼齊上緣、不壓縮間距', () => {
    const v0 = layoutBadges(crowded, { w: 1920, h: 1080 }, { w: 1920, h: 1080 }, fmt)
    const hs = v0.map(() => 40)
    const near = v0.map((b, i) => ({ ...b, anchorY: 1040 + i * 5 }))
    const s = stackBadges(near, hs, 1080)
    noOverlap(s, hs)
    expect(Math.max(...s.map((b, i) => b.top + hs[i]))).toBeLessThanOrEqual(1080)
    const tiny = stackBadges(near, hs, 150)
    expect(Math.min(...tiny.map(b => b.top))).toBe(0)
    noOverlap(tiny, hs)
  })

  it('量到的實際高度不同時重排(OcrBadges 畫出來後):仍不重疊', () => {
    const v = layoutBadges(crowded, { w: 1920, h: 1080 }, { w: 1920, h: 1080 }, fmt, { metrics: badgeMetrics(18) })
    const measured = v.map((_, i) => 30 + i * 7)
    noOverlap(stackBadges(v, measured, 1080), measured)
  })

  it('「?」說明:profile 來源 all(交集為空)用「依全部可能底材推算」;交集 / 類別維持原文案;精確不顯示', () => {
    expect(guessNoteKey({ profileExact: false, profileSource: 'all' })).toBe('ppz.ocr.guess_title_all')
    expect(guessNoteKey({ profileExact: false, profileSource: 'intersection' })).toBe('ppz.ocr.guess_title')
    expect(guessNoteKey({ profileExact: false, profileSource: 'category' })).toBe('ppz.ocr.guess_title')
    expect(guessNoteKey({ profileExact: true, profileSource: 'refName' })).toBeNull()
  })

  it('「?」說明:最近查價的物品與面板不符(hint-rejected)→ 註明那件物品;log 記否決原因;未否決時說明與 log 不變', () => {
    const hint = { refName: 'Militant Bow', hintSource: 'refName' as const, hintNoMatch: 2, fallback: 'intersection' as const, fallbackNoMatch: 0, groups: 3 }
    const r = { profileExact: false, profileSource: 'hint-rejected' as const, rejectedHint: hint }
    expect(guessNoteKey(r)).toBe('ppz.ocr.guess_title_hint')
    expect(guessNote(r)).toEqual({ key: 'ppz.ocr.guess_title_hint', args: { item: 'Militant Bow' } })
    expect(guessNoteKey({ ...r, rejectedHint: { ...hint, fallback: 'all' } })).toBe('ppz.ocr.guess_title_hint_all')
    expect(guessNote({ ...r, rejectedHint: { ...hint, refName: undefined, category: 'Bow', hintSource: 'category' } })!.args).toEqual({ item: 'Bow' })
    expect(rejectedHintLog(r)).toBe('最近查價的物品(Militant Bow,精確底材)與面板不符:3 組中 2 組此底材擲不出 → 改依共同的可能底材推算(仍對不上 0 組)')
    expect(guessNote({ profileExact: false, profileSource: 'intersection' })).toEqual({ key: 'ppz.ocr.guess_title' })
    expect(guessNote({ profileExact: true, profileSource: 'refName' })).toBeNull()
    expect(rejectedHintLog({})).toBe('')
    // 兩種語言都有這兩個鍵,且都帶 {item}
    for (const lang of [zhHant, en]) {
      expect(lang.ppz.ocr.guess_title_hint).toContain('{item}')
      expect(lang.ppz.ocr.guess_title_hint_all).toContain('{item}')
    }
  })
})
