/**
 * 2026-10-15 H2 倉庫「本頁價值」卡拖曳並記住位置(D1)與 H3-1 徽章不壓數字帶的兩個候選幾何(Q1)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest, hostConfigOf } from '../src/web/Config'
import { floatMenuPlace, floatMenuPosOf, overlayPlace, overlayPosOf } from '../src/web/overlay/float-menu-geom'
import {
  STASH_BADGE_PLACEMENT, STASH_MASK_PAD_CSS_PX, layoutStashBadges, stashBadgeBandOverlaps, stashBadgeBox, stashValueCardPlace
} from '../src/web/overlay/stash-view'
import { parseStashLayouts } from '../../core/src/stash/layout'

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const VIEW = { w: 2560, h: 1440 }
const DEF = { left: 24, top: 1066, maxWidth: 840, maxHeight: 80 }
const BOX = { w: 300, h: 40 }

describe('D1 價值卡位置往返與夾回', () => {
  it('舊設定檔 / 壞值 → null;合法值往返;不進 host-config', () => {
    for (const raw of [null, '{"game":"poe1"}', '{"stashValueCard":{"x":1.5,"y":0}}', '{"stashValueCard":"x"}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.stashValueCard).toBeNull()
      expect(JSON.parse(serialized)).toMatchObject({ stashValueCard: null })
    }
    const r = _roundTripForTest('{"stashValueCard":{"x":0.4,"y":0.7}}')
    expect(r.config.stashValueCard).toEqual({ x: 0.4, y: 0.7 })
    expect(JSON.parse(r.serialized)).toMatchObject({ stashValueCard: { x: 0.4, y: 0.7 } })
    const h = hostConfigOf(r.config, []) as unknown as Record<string, unknown>
    expect('stashValueCard' in h).toBe(false)
  })

  it('null = 面板底部預設原樣(不夾、不改大小上限)', () => {
    expect(stashValueCardPlace(DEF, null, VIEW, BOX)).toEqual(DEF)
  })

  it('有位置 → 比例換成 px;超出畫面夾回(至少留 4 px),大小上限沿用預設', () => {
    expect(stashValueCardPlace(DEF, { x: 0.5, y: 0.25 }, VIEW, BOX)).toEqual({ left: 1280, top: 360, maxWidth: 840, maxHeight: 80 })
    expect(stashValueCardPlace(DEF, { x: 0.99, y: 0.99 }, VIEW, BOX)).toEqual({ left: 2560 - 300 - 4, top: 1440 - 40 - 4, maxWidth: 840, maxHeight: 80 })
    // 換小解析度:同一比例夾回
    expect(stashValueCardPlace(DEF, { x: 0.99, y: 0.99 }, { w: 1280, h: 720 }, BOX)).toMatchObject({ left: 1280 - 300 - 4, top: 720 - 40 - 4 })
  })

  it('拖曳放開的 px → 比例(先夾回),再顯示回到同一位置', () => {
    const pos = overlayPosOf({ left: 900, top: 300 }, VIEW, BOX)
    expect(stashValueCardPlace(DEF, pos, VIEW, BOX)).toMatchObject({ left: 900, top: 300 })
    expect(overlayPosOf({ left: 9999, top: -50 }, VIEW, BOX)).toEqual(overlayPosOf({ left: 2560 - 300 - 4, top: 4 }, VIEW, BOX))
  })

  it('懸浮選單的舊名照舊(通用版的包裝)', () => {
    expect(floatMenuPlace({ x: 0.5, y: 0.5 }, VIEW, BOX)).toEqual(overlayPlace({ x: 0.5, y: 0.5 }, VIEW, BOX, { left: 0, top: 0 }))
    expect(floatMenuPosOf({ left: 10, top: 10 }, VIEW, BOX)).toEqual(overlayPosOf({ left: 10, top: 10 }, VIEW, BOX))
  })

  it('接線:App.vue 把懸浮選單開著傳給倉庫疊層;選單有提示與還原位置;字串兩語', () => {
    const app = read('renderer/src/web/App.vue')
    expect(app).toMatch(/<stash-prices v-if="isOverlay" :interactive="floatMenuOpen"/)
    const menu = read('renderer/src/web/overlay/FloatMenu.vue')
    expect(menu).toContain("t('ppz.menu.stash_card_hint')")
    expect(menu).toContain('config.stashValueCard = null')
    for (const lang of ['cmn-Hant', 'en']) {
      const j = JSON.parse(read(`renderer/src/i18n/${lang}.json`))
      expect(j.ppz.menu.stash_card_hint).toBeTruthy()
      expect(j.ppz.menu.stash_card_reset).toBeTruthy()
      expect(j.ppz.stash.value_drag).toBeTruthy()
    }
  })
})

describe('Q1 徽章不進數字帶(兩候選的幾何)', () => {
  // 原生 2560×1440 擷取:格子 rect 與擷取當下的徽章遮罩(影像像素 = client px;遮罩 = 徽章框外擴 3 px)
  const NT = JSON.parse(read('core/test/stash/fixtures/qty-native/truth.json')) as {
    sets: Array<{ tab: string, masks: Array<{ x: number, y: number, w: number, h: number }>, cells: Array<{ rect: { x: number, y: number, w: number, h: number } }> }>
  }
  const pad = STASH_MASK_PAD_CSS_PX
  const setOf = (tab: string) => {
    const s = NT.sets.find(x => x.tab === tab)!
    const cells = s.cells.map(c => c.rect)
    // 每格的徽章大小 = 那格的遮罩去掉外擴(遮罩底 = 格子下緣 + 外擴、水平中心在格內)
    const badges = cells.map(r => {
      const m = s.masks.find(m => m.x + m.w / 2 >= r.x && m.x + m.w / 2 <= r.x + r.w && Math.abs(m.y + m.h - (r.y + r.h + pad)) <= 3)!
      expect(m).toBeTruthy()
      return { w: m.w - pad * 2, h: m.h - pad * 2 }
    })
    return { cells, badges }
  }

  it('main 遮罩外擴常數與 renderer 一致', () => {
    expect(read('main/src/ocr/scan-mask.ts')).toMatch(new RegExp(`MASK_PAD_CSS_PX = ${STASH_MASK_PAD_CSS_PX}\\b`))
  })

  it('預設擺法為使用者選定的往下移(below)', () => {
    expect(STASH_BADGE_PLACEMENT).toBe('below')
  })

  it('現況:聖甲蟲頁每格徽章都蓋進自己的數字帶;候選 a / b 徽章框 0 格', () => {
    const { cells, badges } = setOf('scarabs')
    expect(stashBadgeBandOverlaps(cells, badges, 'current').own).toBe(115)
    expect(stashBadgeBandOverlaps(cells, badges, 'fit').own).toBe(0)
    expect(stashBadgeBandOverlaps(cells, badges, 'below').own).toBe(0)
    // b 往下長:不蓋到其他格的數字帶
    expect(stashBadgeBandOverlaps(cells, badges, 'below').others).toBe(0)
  })

  it('含遮罩外擴 3 px:b 自己的數字帶 0 格(擦到不規則排列的他格數字帶下緣 12 格,鎖數字);a(× 0.33)只剩約 2 px 擦邊', () => {
    const { cells, badges } = setOf('scarabs')
    expect(stashBadgeBandOverlaps(cells, badges, 'current', pad).own).toBe(115)
    // 他格:聖甲蟲頁有錯位的列(y 161 / 188 / 193…),往下長的徽章碰到下方格子數字帶(0.65 高)的下緣;實際數字列(readCellQuantity band)0 格被蓋
    expect(stashBadgeBandOverlaps(cells, badges, 'below', pad)).toEqual({ own: 0, others: 12 })
    // a:框上緣 = 下緣 − 0.33 高;外擴後與數字帶(0.65 高)重疊 (0.33 + 0.65 − 1) × 45 + 3 ≈ 2.1 px(擦邊,落在數字列下方 2 px 留白)
    const c = cells[0]
    const b = stashBadgeBox(c, badges[0], 'fit')
    expect((c.y + c.h * 0.65) - (b.y - pad)).toBeCloseTo(2.1, 5)
  })

  it('一般頁(格高 60)現況就不交疊,候選不讓它變差', () => {
    const { cells, badges } = setOf('general')
    for (const mode of ['current', 'fit', 'below'] as const) expect(stashBadgeBandOverlaps(cells, badges, mode)).toEqual({ own: 0, others: 0 })
  })

  it('layoutStashBadges:current 不帶擺法欄位;fit 帶 maxHeight、below 把 top 移到數字帶下緣;省略 = below', () => {
    const file = parseStashLayouts(JSON.parse(read('data/poe1/stash/layouts.json')))
    const base = {
      file, subtab: 'scarabs' as const, yOffset: 0, client: { w: 2560, h: 1440 }, viewport: { w: 2560, h: 1440 },
      names: () => undefined, priceOf: () => ({ status: 'no-price' as const }), divineRate: undefined,
      thresholds: { low: 1, high: 10 } as never, hover: null
    }
    const cur = layoutStashBadges({ ...base, placement: 'current' })
    expect(layoutStashBadges(base)[0]).toEqual(layoutStashBadges({ ...base, placement: 'below' })[0])
    expect(cur.length).toBeGreaterThan(0)
    expect(cur.every(b => b.placement === undefined && b.maxHeight === undefined)).toBe(true)
    const fit = layoutStashBadges({ ...base, placement: 'fit' })
    expect(fit[0].maxHeight).toBeGreaterThan(0)
    expect(fit[0].top).toBe(cur[0].top)
    const below = layoutStashBadges({ ...base, placement: 'below' })
    expect(below[0].placement).toBe('below')
    expect(below[0].top).toBeLessThan(cur[0].top)
  })
})
