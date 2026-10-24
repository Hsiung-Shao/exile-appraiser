// 守門:專案自己的介面字串(renderer/src/i18n/{cmn-Hant,en}.json)兩語系的鍵集合必須一致、值非空。
// 為什麼不經 t() 檢查:i18n.ts 設了 fallbackFormat:true + missingWarn:false,漏翻的鍵會靜默退回英文或鍵名本身,
// 從 UI / t() 輸出看不出缺口(曾讓 315 個漏翻全綠)。直接比對 JSON 才看得到。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type Json = string | { [k: string]: Json }

const load = (lang: string): Json => JSON.parse(readFileSync(fileURLToPath(new URL(`../src/i18n/${lang}.json`, import.meta.url)), 'utf8'))

/** 攤平成 `a.b.c` → 值(只收葉節點) */
function flatten (node: Json, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (typeof node === 'object' && node !== null) {
    for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  } else {
    out[prefix] = node
  }
  return out
}

const zh = flatten(load('cmn-Hant'))
const en = flatten(load('en'))

/** 只有 en 有的例外前綴:RegexPanel.vue 的正則頁說明,中文介面用資料檔內建的中文說明(`p.note`),只有英文介面才用這些鍵覆蓋 */
const EN_ONLY_PREFIXES = ['ppz.regex.page_note.']

describe('I1 介面字串鍵集合守門(不經 t())', () => {
  it('掃描有讀到內容(防止路徑錯誤造成空比對)', () => {
    expect(Object.keys(zh).length).toBeGreaterThan(100)
    expect(Object.keys(en).length).toBeGreaterThan(100)
  })

  it('en 與 cmn-Hant 的鍵集合相同(缺的鍵會被 fallbackFormat 靜默吞掉)', () => {
    const missingInEn = Object.keys(zh).filter(k => !(k in en)).sort()
    const missingInZh = Object.keys(en).filter(k => !(k in zh) && !EN_ONLY_PREFIXES.some(p => k.startsWith(p))).sort()
    expect({ missingInEn, missingInZh }).toEqual({ missingInEn: [], missingInZh: [] })
  })

  it('所有葉節點都是非空字串', () => {
    const bad = (rec: Record<string, unknown>) => Object.entries(rec).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k).sort()
    expect({ zh: bad(zh), en: bad(en) }).toEqual({ zh: [], en: [] })
  })
})
