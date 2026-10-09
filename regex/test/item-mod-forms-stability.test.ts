// 物品詞綴數值頁:多種寫法仲裁的穩定性。
//   S3 仲裁不改變舊條目 id(無仲裁的每個 entry 在有仲裁時仍在、ref 相同)
//   S4 交替 > 2 選項且含空字串差異段 → `(機|總機)?`,不得出現 `(|`
// 片段一律只經公開 API `itemModFragment(entry.anchors[lang], 條件)` 取得。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultRegexDataDir } from '../src/node'
import { buildItemModData, itemModFragment, parseItemModForms, parseStatsNdjson, type StatLite } from '../src/pages'

const DATA_DIR = path.resolve(defaultRegexDataDir(), '..')
const FORMS_TEXT = fs.readFileSync(path.join(DATA_DIR, 'regex', 'item-mod-forms.json'), 'utf8')
const GAMES = ['poe1', 'poe2'] as const

function stats (game: string, lang: string): StatLite[] {
  return parseStatsNdjson(fs.readFileSync(path.join(DATA_DIR, game, lang, 'stats.ndjson'), 'utf8'))
}

describe('S3 仲裁不改變舊條目 id', () => {
  for (const g of GAMES) {
    it(`S3 ${g}:無仲裁的每個條目 id 在有仲裁結果裡都存在且 ref 相同`, () => {
      const zh = stats(g, 'cmn-Hant')
      const en = stats(g, 'en')
      const forms = parseItemModForms(FORMS_TEXT, g)
      expect(forms, `${g} 仲裁檔解析`).toBeTruthy()
      const plain = buildItemModData(g, zh, en)
      const arb = buildItemModData(g, zh, en, forms)
      expect(plain.entries.length).toBeGreaterThan(0)
      const byId = new Map(arb.entries.map(e => [e.id, e.ref]))
      const missing: string[] = []
      const changed: string[] = []
      for (const e of plain.entries) {
        if (!byId.has(e.id)) missing.push(`${e.id} (${e.ref})`)
        else if (byId.get(e.id) !== e.ref) changed.push(`${e.id}: ${e.ref} → ${byId.get(e.id)}`)
      }
      expect(missing, `${g} 有仲裁後消失的 id`).toEqual([])
      expect(changed, `${g} 有仲裁後 ref 改變的 id`).toEqual([])
    })
  }
})

describe('S4 交替多於兩個選項且含空字串', () => {
  const STAT_ID = 'stat_990000001'
  const REF = '#% increased Block chance'
  const ZH_FORMS = ['增加#%格擋率', '增加#%格擋機率', '增加#%格擋總機率']
  const EN_FORM = '#% increased Block chance'
  const line = (matchers: string[]): string => JSON.stringify({
    ref: REF,
    better: 1,
    matchers: matchers.map(string => ({ string })),
    trade: { ids: { explicit: [`explicit.${STAT_ID}`] } }
  })
  const zh = parseStatsNdjson(line(ZH_FORMS) + '\n')
  const en = parseStatsNdjson(line([EN_FORM]) + '\n')
  const key = `${STAT_ID}|${REF}`

  it('S4 三種寫法(差異段 空 / 機 / 總機)片段為 `(機|總機)?`、三種都中、其他字不中', () => {
    expect(zh.length, '合成 zh stat 解析').toBe(1)
    expect(en.length, '合成 en stat 解析').toBe(1)
    const data = buildItemModData('poe2', zh, en, { zh: { [key]: ZH_FORMS }, en: {} })
    expect(data.entries.length, `應收錄;排除統計 ${JSON.stringify(data.excluded)}`).toBe(1)
    const e = data.entries[0]
    const f = itemModFragment(e.anchors.zh, { min: 12 })
    expect(f, 'zh 片段').toBeTruthy()
    expect(f!, '片段不得含空選項 `(|`').not.toContain('(|')
    expect(f!, '片段應以 `)?` 表示可省略的差異段').toContain(')?')
    expect(f!, '片段應含 `(機|總機)?`').toContain('(機|總機)?')
    const re = new RegExp(f!)
    for (const form of ZH_FORMS) {
      const text = form.replace('#', '12')
      expect(re.test(text), `${text} 應命中(片段 ${f})`).toBe(true)
    }
    expect(re.test('增加12%格擋其他率'), `增加12%格擋其他率 不應命中(片段 ${f})`).toBe(false)
  })
})
