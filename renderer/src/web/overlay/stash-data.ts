/**
 * PoE1 倉庫價格疊層的資料:固定版面(`./data/poe1/stash/layouts.json`)與版面上物品的繁中名稱
 * (`./data/poe1/cmn-Hant/items.ndjson`,以 refName 對接;不經查價資料繫結 → 不受「依物品文字自動判斷語言」切換影響)。
 * 第一次收到 `show` 才載入,之後常駐;失敗可重試。
 */
import { shallowRef } from 'vue'
import { parseStashLayouts, STASH_SUBTABS, type StashLayoutFile } from '../../../../core/src/stash/layout'

export interface StashData {
  file: StashLayoutFile
  /** refName → 繁中名(只收版面上出現的物品) */
  zh: Map<string, string>
}

export const stashData = shallowRef<StashData | null>(null)
let loading: Promise<StashData | null> | null = null

async function fetchText (url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return await res.text()
}

/** 版面上出現的 refName → 繁中名(namespace ITEM,每個 refName 取第一筆) */
export function zhNamesFor (file: StashLayoutFile, ndjson: string): Map<string, string> {
  const want = new Set(STASH_SUBTABS.flatMap(s => file.subtabs[s].map(c => c.refName)))
  const out = new Map<string, string>()
  for (const line of ndjson.split('\n')) {
    if (!line.includes('"ITEM"')) continue
    let o: { name?: unknown, refName?: unknown, namespace?: unknown }
    try { o = JSON.parse(line) } catch { continue }
    if (o.namespace !== 'ITEM' || typeof o.refName !== 'string' || typeof o.name !== 'string') continue
    if (want.has(o.refName) && !out.has(o.refName)) out.set(o.refName, o.name)
  }
  return out
}

export function loadStashData (): Promise<StashData | null> {
  if (stashData.value) return Promise.resolve(stashData.value)
  if (loading) return loading
  loading = (async () => {
    try {
      const [layouts, zh] = await Promise.all([
        fetchText('./data/poe1/stash/layouts.json'),
        fetchText('./data/poe1/cmn-Hant/items.ndjson')
      ])
      const file = parseStashLayouts(JSON.parse(layouts))
      stashData.value = { file, zh: zhNamesFor(file, zh) }
      console.log(`[stash] 版面載入:${STASH_SUBTABS.map(s => `${s} ${file.subtabs[s].length}`).join(' / ')},繁中名 ${stashData.value.zh.size}`)
      return stashData.value
    } catch (e) {
      console.error('[stash] 版面載入失敗', e)
      return null
    } finally {
      loading = null
    }
  })()
  return loading
}
