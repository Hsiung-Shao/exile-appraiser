/**
 * 2026-10-15 懸浮選單 A 版(指令面板):清單模型、篩選膠囊 / 搜尋、鍵盤(F1–F3);市況列匯率與走勢(F4–F5)。
 * 價格只讀錄製的 poe.ninja 回應(core/test/recordings/ninja/),不連網。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNinjaClient, toSnapshot, type NinjaSnapshot } from '@exile-appraiser/core/ninja'
import type { HttpFetch, HttpResponse } from '@exile-appraiser/core/http'
import type { GroupedBookmarks } from '@exile-appraiser/regex'
import { filterMenuItems, menuItemsOf, menuKey, menuRows, type MenuItem } from '../src/web/overlay/float-menu-items'
import { invertChange, marketRateOf } from '../src/web/overlay/market-rate'

const ROOT = path.resolve(__dirname, '../..')
const t = (k: string) => `T(${k})`
const bm = (name: string, hotkey?: string) => ({ name, page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: [], alt: [], hotkey }) as never
const GROUPS: GroupedBookmarks = {
  headers: true,
  groups: [
    { folder: '地圖', collapsed: false, items: [{ index: 0, b: bm('T17 危險詞綴', 'Ctrl + 1') }, { index: 2, b: bm('高數量 Map') }] },
    { folder: '商店', collapsed: true, items: [{ index: 5, b: bm('6L 商店', 'F6') }] }
  ]
}

describe('F1 選單項目攤平分三類', () => {
  it('順序 = 辨識 → 書籤 → 工具;辨識依目前遊戲、書籤帶資料夾 / 熱鍵 / 索引', () => {
    const items = menuItemsOf({ game: 'poe1', bookmarks: GROUPS, t })
    expect(items.map(i => i.kind)).toEqual(['scan', 'scan', 'scan', 'bookmark', 'bookmark', 'bookmark', 'tool', 'tool', 'tool'])
    expect(items.filter(i => i.kind === 'scan').map(i => i.toggle)).toEqual(['stashPricesEnabled', 'stashReadQuantity', 'stashShowNames'])
    expect(items[0].label).toBe('T(ppz.menu.tg_stash)')
    const b = items.filter(i => i.kind === 'bookmark')
    expect(b.map(i => [i.label, i.folder, i.index, i.hotkey ?? null, i.collapsed])).toEqual([
      ['T17 危險詞綴', '地圖', 0, 'Ctrl + 1', false], ['高數量 Map', '地圖', 2, null, false], ['6L 商店', '商店', 5, 'F6', true]
    ])
    expect(items.filter(i => i.kind === 'tool').map(i => i.tool)).toEqual(['settings', 'sheet', 'dust'])
    // id 不重複(v-for key / 選取都靠它)
    expect(new Set(items.map(i => i.id)).size).toBe(items.length)
  })
  it('PoE2 辨識 = 褻瀆 / 符文;沒有資料夾標題時不理收合', () => {
    const items = menuItemsOf({ game: 'poe2', bookmarks: { headers: false, groups: [{ folder: '', collapsed: true, items: [{ index: 1, b: bm('碑牌') }] }] }, t })
    expect(items.filter(i => i.kind === 'scan').map(i => i.toggle)).toEqual(['revealAutoEnabled', 'runeshapeEnabled'])
    expect(items.find(i => i.kind === 'bookmark')!.collapsed).toBe(false)
  })
})

describe('F2 篩選膠囊與搜尋', () => {
  const items = menuItemsOf({ game: 'poe1', bookmarks: GROUPS, t })
  const labels = (xs: MenuItem[]) => xs.map(i => i.label)
  it('膠囊只留該類;全部 = 原清單', () => {
    expect(filterMenuItems(items, 'all', '')).toEqual(items)
    expect(filterMenuItems(items, 'bookmark', '').every(i => i.kind === 'bookmark')).toBe(true)
    expect(filterMenuItems(items, 'scan', '')).toHaveLength(3)
    expect(filterMenuItems(items, 'tool', '')).toHaveLength(3)
  })
  it('名稱 / 資料夾比對,大小寫與全形不影響', () => {
    expect(labels(filterMenuItems(items, 'all', 'map'))).toEqual(['高數量 Map'])
    expect(labels(filterMenuItems(items, 'all', 'ＭＡＰ'))).toEqual(['高數量 Map'])
    expect(labels(filterMenuItems(items, 'all', 't17'))).toEqual(['T17 危險詞綴'])
    // 資料夾名命中 → 整個資料夾的書籤
    expect(labels(filterMenuItems(items, 'all', '商店'))).toEqual(['6L 商店'])
    expect(labels(filterMenuItems(items, 'bookmark', '  地圖  '))).toEqual(['T17 危險詞綴', '高數量 Map'])
    // 膠囊與關鍵字同時成立
    expect(filterMenuItems(items, 'tool', 'map')).toEqual([])
  })
  it('收合資料夾的書籤:沒搜尋時不在可選列;搜尋時照樣列出', () => {
    expect(labels(menuRows(filterMenuItems(items, 'bookmark', ''), ''))).toEqual(['T17 危險詞綴', '高數量 Map'])
    expect(labels(menuRows(filterMenuItems(items, 'all', '6l'), '6l'))).toEqual(['6L 商店'])
  })
})

describe('F3 鍵盤上下與 Enter', () => {
  it('↑↓ 循環、Home / End、Enter 回傳選取', () => {
    expect(menuKey({ key: 'ArrowDown' }, 3, 0)).toEqual({ sel: 1, run: false })
    expect(menuKey({ key: 'ArrowDown' }, 3, 2)).toEqual({ sel: 0, run: false })
    expect(menuKey({ key: 'ArrowUp' }, 3, 0)).toEqual({ sel: 2, run: false })
    expect(menuKey({ key: 'ArrowUp' }, 3, -1)).toEqual({ sel: 2, run: false })
    expect(menuKey({ key: 'Home' }, 3, 2)).toEqual({ sel: 0, run: false })
    expect(menuKey({ key: 'End' }, 3, 0)).toEqual({ sel: 2, run: false })
    expect(menuKey({ key: 'Enter' }, 3, 1)).toEqual({ sel: 1, run: true })
    // 選取超出(清單被篩掉)→ Enter 夾回最後一列
    expect(menuKey({ key: 'Enter' }, 3, 7)).toEqual({ sel: 2, run: true })
  })
  it('沒有選取(sel = -1)時 Enter 不攔也不執行', () => {
    expect(menuKey({ key: 'Enter' }, 3, -1)).toBeNull()
  })
  it('搜尋框有字時 Home / End 不攔,留給輸入框移游標;空時照常選列', () => {
    expect(menuKey({ key: 'Home' }, 3, 1, false)).toBeNull()
    expect(menuKey({ key: 'End' }, 3, 1, false)).toBeNull()
    expect(menuKey({ key: 'Home' }, 3, 1, true)).toEqual({ sel: 0, run: false })
    expect(menuKey({ key: 'End' }, 3, 1, true)).toEqual({ sel: 2, run: false })
    expect(menuKey({ key: 'ArrowDown' }, 3, 0, false)).toEqual({ sel: 1, run: false })
  })
  it('1–9、← →、Tab、Esc 不攔(交給輸入框 / 瀏覽器 / main);空清單不動作', () => {
    for (const key of ['1', '9', 'ArrowLeft', 'ArrowRight', 'Tab', 'Escape', 'a']) expect(menuKey({ key }, 3, 0)).toBeNull()
    expect(menuKey({ key: 'Enter' }, 0, 0)).toBeNull()
    expect(menuKey({ key: 'ArrowDown' }, 0, 0)).toBeNull()
  })
})

// ---- 市況列(錄製檔 → 快照) ----
const REC = 'core/test/recordings/ninja'
function response (body: string): HttpResponse {
  return { ok: true, status: 200, headers: new Headers(), json: async () => JSON.parse(body), text: async () => body }
}
function recHttp (dir: string): HttpFetch {
  return async (url) => {
    const u = new URL(url)
    const kind = u.pathname.includes('/exchange/') ? 'exchange' : 'item'
    const file = path.join(ROOT, dir, kind + '_' + u.searchParams.get('type') + '.json')
    if (!fs.existsSync(file)) return { ...response('not found'), ok: false, status: 404 }
    return response(fs.readFileSync(file, 'utf8'))
  }
}
async function snapshotOf (game: 'poe1' | 'poe2'): Promise<NinjaSnapshot> {
  const client = createNinjaClient({
    http: recHttp(game === 'poe1' ? REC : REC + '/poe2'), game, league: game === 'poe1' ? 'Allflame' : 'Forbidden Rites', sleep: async () => {}, now: () => 1
  })
  return toSnapshot(await client.fetchAll(game === 'poe1' ? { exchange: ['Currency'], item: [] } : { exchange: ['Currency'], item: [] }))
}

describe('F4 PoE1 匯率與走勢', () => {
  it('1 div = N c(divineRate);走勢取 Divine Orb 列、漲跌取 totalChange', async () => {
    const snap = await snapshotOf('poe1')
    const r = marketRateOf(snap, { game: 'poe1', league: 'Allflame' })!
    expect(r).toMatchObject({ game: 'poe1', to: 'chaos', rate: snap.divineRate, change: 1.02, tone: 'up' })
    expect(r.text).toBe(String(Math.round(snap.divineRate!)))
    expect(r.points).toEqual([0.22, -0.15, -0.83, 0.05, 0.9, 3.98, 1.02])
    expect(r.drawMin).toBeLessThan(-0.83)
    expect(r.drawMax).toBeGreaterThan(3.98)
  })
})

describe('F5 PoE2 匯率與走勢反向', () => {
  it('1 div = divineRate / exaltedRate ex;走勢由 Exalted Orb 列逐點反算(崇高跌 = 神聖漲)', async () => {
    const snap = await snapshotOf('poe2')
    const r = marketRateOf(snap, { game: 'poe2', league: 'Forbidden Rites' })!
    expect(r.to).toBe('exa')
    expect(r.rate).toBeCloseTo(610.9, 6)
    expect(r.text).toBe('611')
    const ex = snap.prices['currency|Exalted Orb'].s!.filter((p): p is number => p != null)
    expect(r.points).toHaveLength(ex.length)
    r.points.forEach((p, i) => { expect(p).toBeCloseTo((1 / (1 + ex[i] / 100) - 1) * 100, 9) })
    // 錄製時崇高石 −20.17% → 神聖石以崇高計 +25.27%;方向畫反 = 漲跌顏色與數字都錯
    expect(r.change!).toBeCloseTo(25.27, 2)
    expect(r.tone).toBe('up')
  })
  it('invertChange:0 不變、+100% ↔ −50%', () => {
    expect(invertChange(0)).toBe(0)
    expect(invertChange(100)).toBeCloseTo(-50, 9)
    expect(invertChange(-50)).toBeCloseTo(100, 9)
  })
})

describe('F6(純函式部分)沒快取 / 台服 / 換聯盟中', () => {
  it('沒快照、沒目標(台服 / 私人聯盟)、快照是別的聯盟 → null(畫面顯示尚無資料)', async () => {
    const snap = await snapshotOf('poe1')
    expect(marketRateOf(null, { game: 'poe1', league: 'Allflame' })).toBeNull()
    expect(marketRateOf(snap, null)).toBeNull()
    expect(marketRateOf(snap, { game: 'poe1', league: 'Standard' })).toBeNull()
    expect(marketRateOf(snap, { game: 'poe2', league: 'Allflame' })).toBeNull()
  })
  it('PoE2 沒有崇高匯率 → null;沒有走勢 → 有匯率、沒有圖', async () => {
    const snap = await snapshotOf('poe2')
    expect(marketRateOf({ ...snap, exaltedRate: null }, { game: 'poe2', league: 'Forbidden Rites' })).toBeNull()
    const prices = { ...snap.prices }
    delete prices['currency|Exalted Orb']
    const r = marketRateOf({ ...snap, prices }, { game: 'poe2', league: 'Forbidden Rites' })!
    expect(r.points).toEqual([])
    expect(r.change).toBeNull()
    expect(r.tone).toBe('const')
  })
})

describe('F8(純函式部分)限流點', () => {
  it('429 等待中 = wait 顯示秒數;排隊 = busy;其他 = ok;數字取用量最高的規則', async () => {
    const { rateDotOf } = await import('../src/web/overlay/float-menu-items')
    const rules = [{ active: 1, max: 5, queue: 0 }, { active: 3, max: 8, queue: 0 }]
    expect(rateDotOf(rules, 0)).toEqual({ tone: 'ok', text: '3 / 8' })
    expect(rateDotOf([...rules, { active: 1, max: 1, queue: 2 }], 0)).toEqual({ tone: 'busy', text: '1 / 1' })
    expect(rateDotOf(rules, 12)).toEqual({ tone: 'wait', text: '12s' })
    // 沒有限流規則可讀(例如還沒建立 session)→ 只看 429
    expect(rateDotOf([], 0)).toEqual({ tone: 'ok', text: '' })
    expect(rateDotOf([], 3)).toEqual({ tone: 'wait', text: '3s' })
  })
})
