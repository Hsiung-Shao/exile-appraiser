// 物品類型條件(2026-10-09,使用者回報碑牌頁的「"圍|個瓦"」在商店裡亮了瓦爾珠寶):
// 片段只保證不誤中「同一頁清單裡的其他詞綴」,倉庫 / 商店搜尋卻會掃所有物品(珠寶的「範圍效果」含「圍」)。
// 對整個物品詞綴庫否決代價太大(實驗:碑牌頁可單獨指定 繁中 83 → 42、英文 80 → 28),
// 改成輸出多一段 AND term = 這類物品名稱一定含的字(八種碑牌的基底名都以「碑牌」/「Tablet」結尾,
// `regex/test/tablet-variants.test.ts` 對 items.ndjson 守門)。
// 只有勾選的語料頁**全部**屬於同一個類型時才加(碑牌頁 + 換界石頁一起勾時加了會把換界石擋掉)。
// 使用者裁定先只做碑牌頁。
import type { RegexLang, RegexPage } from './data'

const CLASS_TERMS: Readonly<Record<string, Readonly<Record<RegexLang, string>>>> = {
  'poe2/tablet_mods': { zh: '碑牌', en: 'tablet' }
}

/** 這一頁的物品類型條件(沒有 = null) */
export function classTermOf (page: RegexPage, lang: RegexLang): string | null {
  return CLASS_TERMS[`${page.game}/${page.id}`]?.[lang] ?? null
}

/** 一組有勾選的語料頁共同的物品類型條件:全部同一個才回傳,否則 null */
export function sharedClassTerm (pages: readonly RegexPage[], lang: RegexLang): string | null {
  if (!pages.length) return null
  const first = classTermOf(pages[0], lang)
  if (!first) return null
  return pages.every(p => classTermOf(p, lang) === first) ? first : null
}
