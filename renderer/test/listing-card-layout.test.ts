// 查價面板 B 改版修正(2026-10-14):掛單卡被壓扁守門。
// 根因:CheckedItem 是 `.layout-column`(height: 100%)→ 高度 = 面板捲動區;掛單根節點 / 掛單卡帶 `min-h-0` 會被 flex 壓縮到 22px,
// 內層 `overflow-y-auto` 再把 20 列掛單裁掉。掛單要完整顯示、跟著面板(`.price-main`)一起捲動。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const LISTING_FILES = [
  'poe1/src/web/price-check/trade/TradeListing.vue',
  'poe1/src/web/price-check/trade/TradeBulk.vue',
  'poe2/src/web/price-check/trade/TradeListing.vue',
  'poe2/src/web/price-check/trade/TradeBulk.vue'
]

function template (src: string): string {
  const m = /<template>([\s\S]*)<\/template>/.exec(src)
  return m ? m[1] : ''
}

/** 某條 CSS 規則的宣告區塊(選擇器完全相符) */
function ruleBody (css: string, selector: string): string | undefined {
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
  return re.exec(css)?.[2]
}

describe('掛單卡不被壓扁(兩代 TradeListing / TradeBulk)', () => {
  for (const f of LISTING_FILES) {
    it(`${f}:根節點與掛單卡不帶 min-h-0 / layout-column、內層不另開捲動區`, () => {
      const tpl = template(read(f))
      const root = /<div v-if="!error"[^>]*>/.exec(tpl)?.[0] ?? ''
      expect(root).toContain('listing-root')
      expect(root).not.toMatch(/min-h-0|layout-column/)
      const cards = tpl.match(/<div class="listing-card[^"]*"/g) ?? []
      expect(cards.length).toBeGreaterThan(0)
      for (const c of cards) expect(c).not.toMatch(/min-h-0|layout-column/)
      expect(tpl).not.toMatch(/overflow-y-auto/)
      expect(tpl).toContain('class="listing-body"')
    })
  }

  it('共用樣式:根節點與掛單卡不縮(flex: none)、卡片沒有 min-height: 0、內層不是捲動容器', () => {
    const css = read('renderer/src/web/price-panel/ListingLayoutToggle.vue')
    const rootRule = ruleBody(css, '.listing-root')
    const cardRule = ruleBody(css, '.listing-card')
    const bodyRule = ruleBody(css, '.listing-body')
    expect(rootRule).toMatch(/flex:\s*none/)
    expect(cardRule).toMatch(/flex:\s*none/)
    expect(cardRule).not.toMatch(/min-height:\s*0/)
    expect(bodyRule).toBeDefined()
    expect(bodyRule).not.toMatch(/overflow(-y)?:\s*(auto|scroll|hidden)/)
    expect(bodyRule).not.toMatch(/overflow-x:\s*hidden/)
  })
})
