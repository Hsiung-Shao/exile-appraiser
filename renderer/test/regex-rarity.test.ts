// 第 40 步:稀有度 | 汙染條件列(片段 / 接線 / 往返的語意在 regex/test/rarity.test.ts、strict-fragments.test.ts ③)。
// 這裡守:字串兩語(不含 vue-i18n 特殊字元)、RegexAlgoList 的 `rarity` 分支(兩組 .seg + 分隔線、多選 / 二選一可取消)、
// 條件區用自己的標題與說明、物品詞綴數值頁頂端也掛條件區。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

describe('條件列字串', () => {
  const zh = JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz.regex
  const en = JSON.parse(read('renderer/src/i18n/en.json')).ppz.regex
  it('條件區標題 / 說明兩語都有;數值區說明改寫後不含 vue-i18n 特殊字元', () => {
    for (const k of ['section_title_cond', 'section_hint_cond', 'section_hint']) {
      expect(typeof zh[k], `cmn-Hant ${k}`).toBe('string')
      expect(typeof en[k], `en ${k}`).toBe('string')
      expect(zh[k] + en[k], k).not.toMatch(/[|@$]/)
    }
  })
})

describe('條件列接線', () => {
  const algo = read('renderer/src/web/regex/RegexAlgoList.vue')
  const sec = read('renderer/src/web/regex/RegexNumericSection.vue')
  const panel = read('renderer/src/web/regex/RegexPanel.vue')
  it('RegexAlgoList:rarity 分支兩組 .seg(稀有度多選 / 汙染二選一),中間分隔線,點擊走 toggle 函式', () => {
    // 欄寬與其他列相同(每列各自一個 grid,另設欄寬會對不齊)
    expect(algo).not.toMatch(/\.rx-algo-row\.cond/)
    const i = algo.indexOf(`v-else-if="r.e.input.kind === 'rarity'"`)
    expect(i).toBeGreaterThan(0)
    const block = algo.slice(i, algo.indexOf('</template>', i))
    expect(block).toMatch(/data-regex="`algo-rarity-\$\{r\.e\.id\}`"/)
    expect(block).toMatch(/:class="\{ on: rarityOf\(r\.e\)\.rarity\.includes\(o\.id\) \}"/)
    expect(block).toMatch(/toggleRarityIn\(valueOf\(page\.id, r\.e\)\.choice, o\.id\)/)
    expect(block).toMatch(/class="rx-algo-sep"/)
    expect(block).toMatch(/data-regex="`algo-corruption-\$\{r\.e\.id\}`"/)
    expect(block).toMatch(/:class="\{ on: rarityOf\(r\.e\)\.corruption === o\.id \}"/)
    expect(block).toMatch(/toggleCorruptionIn\(/)
    expect(block.match(/:aria-pressed=/g)?.length).toBe(2)
  })
  it('條件區:標題 / 說明換成條件區的鍵', () => {
    expect(sec).toMatch(/t\(condSection \? 'ppz\.regex\.section_title_cond' : 'ppz\.regex\.section_title'\)/)
    expect(algo).toMatch(/condSection \? 'ppz\.regex\.section_hint_cond' : 'ppz\.regex\.section_hint'/)
    expect(sec).toMatch(/isConditionSectionId\(props\.section\.id\)/)
  })
  it('物品詞綴數值頁頂端掛條件區(在 RegexItemModList 之前)', () => {
    const i = panel.indexOf('<template v-else-if="itemPage">')
    expect(i).toBeGreaterThan(0)
    const block = panel.slice(i, panel.indexOf('</template>', i))
    expect(block.indexOf('<RegexNumericSection v-if="section"')).toBeGreaterThan(0)
    expect(block.indexOf('<RegexItemModList')).toBeGreaterThan(block.indexOf('<RegexNumericSection'))
  })
  it('設定視窗內新樣式不用 rem', () => {
    const style = algo.slice(algo.indexOf('<style>'))
    expect(style.slice(style.indexOf('.rx-algo-sep'), style.indexOf('}', style.indexOf('.rx-algo-sep')))).not.toMatch(/rem/)
  })
})
