// 物品詞綴數值頁:仲裁檔(item-mod-forms.json)沒載入時的降級行為。
//   S1 保留存檔鍵:`item-mod-keep.ts` `mergeKeptKeys`(純函式)+ store 接線守門
//   S2 降級提示:RegexItemModList.vue `data-regex="imv-forms-missing"`(以 formsMissing 為條件)+ i18n 兩語
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8')
const readOr = (p: string): string => { try { return read(p) } catch { return '' } }

type Keys = { keys: string[], alt?: string[] }
type Merge = (current: Keys, kept: Keys | undefined) => { keys: string[], alt: string[] }

async function loadMerge (): Promise<Merge | null> {
  try {
    const mod: Record<string, unknown> = await import('../src/web/regex/item-mod-keep')
    return typeof mod.mergeKeptKeys === 'function' ? mod.mergeKeptKeys as Merge : null
  } catch {
    return null
  }
}

describe('S1 仲裁檔沒載入時保留存檔鍵', () => {
  it('S1a mergeKeptKeys 存在於 item-mod-keep.ts', async () => {
    expect(await loadMerge(), 'renderer/src/web/regex/item-mod-keep.ts 應匯出 mergeKeptKeys').toBeTypeOf('function')
  })

  it('S1b kept 接在 current 後面、alt 依同索引對應', async () => {
    const merge = await loadMerge()
    expect(merge, 'mergeKeptKeys').toBeTypeOf('function')
    const r = merge!({ keys: ['a', 'b'], alt: ['x', 'y'] }, { keys: ['c', 'd'], alt: ['z', 'w'] })
    expect(r).toEqual({ keys: ['a', 'b', 'c', 'd'], alt: ['x', 'y', 'z', 'w'] })
  })

  it('S1c 去重且 current 優先(重複鍵保留 current 的位置與 alt)', async () => {
    const merge = await loadMerge()
    expect(merge, 'mergeKeptKeys').toBeTypeOf('function')
    const r = merge!({ keys: ['a', 'b'], alt: ['x', 'y'] }, { keys: ['b', 'c', 'a'], alt: ['B', 'C', 'A'] })
    expect(r).toEqual({ keys: ['a', 'b', 'c'], alt: ['x', 'y', 'C'] })
  })

  it('S1d kept 缺 alt 時補空字串', async () => {
    const merge = await loadMerge()
    expect(merge, 'mergeKeptKeys').toBeTypeOf('function')
    const r = merge!({ keys: ['a'], alt: ['x'] }, { keys: ['c', 'd'] })
    expect(r).toEqual({ keys: ['a', 'c', 'd'], alt: ['x', '', ''] })
  })

  it('S1e kept 為 undefined 時原樣回傳;current 缺 alt 補成同長度空字串', async () => {
    const merge = await loadMerge()
    expect(merge, 'mergeKeptKeys').toBeTypeOf('function')
    expect(merge!({ keys: ['a', 'b'], alt: ['x', 'y'] }, undefined)).toEqual({ keys: ['a', 'b'], alt: ['x', 'y'] })
    expect(merge!({ keys: ['a', 'b'] }, undefined)).toEqual({ keys: ['a', 'b'], alt: ['', ''] })
    expect(merge!({ keys: [] }, undefined)).toEqual({ keys: [], alt: [] })
  })

  it('S1f 不改動輸入陣列', async () => {
    const merge = await loadMerge()
    expect(merge, 'mergeKeptKeys').toBeTypeOf('function')
    const cur = { keys: ['a'], alt: ['x'] }
    const kept = { keys: ['c'], alt: ['z'] }
    merge!(cur, kept)
    expect(cur).toEqual({ keys: ['a'], alt: ['x'] })
    expect(kept).toEqual({ keys: ['c'], alt: ['z'] })
  })

  it('S1g store.ts 接線:含 formsMissing、syncCurrent 內呼叫 mergeKeptKeys', () => {
    const src = read('renderer/src/web/regex/store.ts')
    expect(src, 'store.ts 應使用 mergeKeptKeys(').toContain('mergeKeptKeys(')
    expect(src, 'store.ts 應含 formsMissing').toContain('formsMissing')
    const start = src.indexOf('function syncCurrent')
    expect(start, 'store.ts 應有 syncCurrent 函式').toBeGreaterThanOrEqual(0)
    const end = src.indexOf('\n}\n', start)
    const body = src.slice(start, end < 0 ? undefined : end)
    expect(body, 'syncCurrent 內應呼叫 mergeKeptKeys').toContain('mergeKeptKeys(')
  })
})

describe('S2 仲裁檔沒載入的降級提示', () => {
  it('S2a RegexItemModList.vue 有 imv-forms-missing 提示且以 formsMissing 為條件', () => {
    const vue = readOr('renderer/src/web/regex/RegexItemModList.vue')
    const at = vue.indexOf('data-regex="imv-forms-missing"')
    expect(at, '元件應含 data-regex="imv-forms-missing"').toBeGreaterThanOrEqual(0)
    // 該元素的開始標籤內要有 v-if / v-show 以 formsMissing 為條件
    const open = vue.lastIndexOf('<', at)
    const close = vue.indexOf('>', at)
    const tag = vue.slice(open, close + 1)
    expect(tag, `提示元素應以 formsMissing 為條件:${tag}`).toMatch(/v-(if|show)="[^"]*formsMissing[^"]*"/)
    expect(vue, '元件應使用 ppz.regex.imv_forms_missing').toContain('ppz.regex.imv_forms_missing')
  })

  it('S2b i18n 兩語都有非空的 ppz.regex.imv_forms_missing', () => {
    const zh = JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz.regex
    const en = JSON.parse(read('renderer/src/i18n/en.json')).ppz.regex
    for (const [name, t] of [['cmn-Hant', zh], ['en', en]] as const) {
      expect(typeof t.imv_forms_missing, `${name} imv_forms_missing`).toBe('string')
      expect((t.imv_forms_missing as string).trim().length, `${name} imv_forms_missing 非空`).toBeGreaterThan(0)
      expect(t.imv_forms_missing, `${name} 不含 vue-i18n 特殊字元`).not.toMatch(/[|@$]/)
    }
  })
})
