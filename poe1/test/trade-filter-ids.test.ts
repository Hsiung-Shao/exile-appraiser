import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

// 查詢寫進 `X_filters.filters.Y` 的每個欄位都要在交易站 /api/trade/data/filters 存檔裡(trade-catalog-3.30.json `filters`);
// 2026-11-19 雕刻補 `ultimatum_output` 時,這個 id 只靠一份 scratchpad 存檔確認,改成在 repo 守住
const ROOT = path.resolve(__dirname, '..')
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/docs/trade-catalog-3.30.json'), 'utf8')) as { filters: string[] }
const src = fs.readFileSync(path.join(ROOT, 'src/web/price-check/trade/pathofexile-trade.ts'), 'utf8')

describe('查詢用到的篩選欄位', () => {
  const used = [...new Set([...src.matchAll(/'([a-z_]+_filters)\.filters\.([a-z_]+)/g)].map(m => `${m[1]}.${m[2]}`))]

  // 失敗代表:有 propSet 改用反引號 / 變數組路徑,上面的 regex 會靜默漏掉
  it('每個 propSet(query.filters, …) 都是單引號字面路徑', () => {
    const calls = src.match(/propSet\(query\.filters,/g)?.length ?? 0
    expect(calls).toBeGreaterThan(50)
    expect([...src.matchAll(/propSet\(query\.filters, '[a-z_]+_filters\.filters\.[a-z_]+/g)].length).toBe(calls)
  })

  // 失敗代表:抓不到欄位(寫法改了),守門形同虛設
  it('程式裡找得到雕刻四個欄位', () => {
    for (const id of ['ultimatum_challenge', 'ultimatum_reward', 'ultimatum_input', 'ultimatum_output']) {
      expect(used).toContain(`ultimatum_filters.${id}`)
    }
  })

  // 2026-11-19 第一次跑就有的(原有程式,未處理):哨兵已移除;海圖硫磺沒有對應欄位。只能變少
  // (foulborn_item 已改成 mutated)
  const KNOWN_MISSING = ['map_filters.chart_sulphur', 'sentinel_filters.sentinel_durability']

  // 失敗代表:送了交易站沒有的篩選欄位(拼錯或已被移除)
  it('每個欄位都在交易站存檔裡(已知缺口除外)', () => {
    expect(used.filter(id => !catalog.filters.includes(id)).sort()).toEqual(KNOWN_MISSING)
  })
})
