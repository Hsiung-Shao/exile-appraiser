// exile-appraiser:移植自 Awakened PoE Trade `renderer/src/web/item-check/hotkeyable-actions.ts` `openPoedb`(MIT)。
// 只留組網址的部分:開啟交給 renderer `web/poedb-open.ts`(系統瀏覽器);語言只支援本專案的兩種客戶端語言。
import type { ParsedItem } from '@/parser'

const POEDB_LANGS = { en: 'us', 'cmn-Hant': 'tw' } as const

export function poedbUrl (item: ParsedItem, language: keyof typeof POEDB_LANGS): string {
  const slug = encodeURIComponent(item.info.refName.replaceAll("'", '').replaceAll(' ', '_'))
  return `https://poedb.tw/${POEDB_LANGS[language]}/${slug}`
}
