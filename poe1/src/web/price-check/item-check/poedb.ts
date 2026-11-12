// exile-appraiser:移植自 Awakened PoE Trade `renderer/src/web/item-check/hotkeyable-actions.ts` `openPoedb`(MIT)。
// 只留組網址的部分:開啟交給 renderer `web/poedb-open.ts`(系統瀏覽器);語言只支援本專案的兩種客戶端語言。
import type { ParsedItem } from '@/parser'

const POEDB_LANGS = { en: 'us', 'cmn-Hant': 'tw' } as const

export function poedbUrl (item: ParsedItem, language: keyof typeof POEDB_LANGS): string {
  const slug = encodeURIComponent(item.info.refName.replaceAll("'", '').replaceAll(' ', '_'))
  return `https://poedb.tw/${POEDB_LANGS[language]}/${slug}`
}

/** 2026-11-13(移植 APT `openWiki`,MIT):物品 → poewiki.net 頁(只有英文,頁名用 refName) */
export function wikiUrl (item: ParsedItem): string {
  return `https://www.poewiki.net/wiki/${encodeURIComponent(item.info.refName.replaceAll(' ', '_'))}`
}
