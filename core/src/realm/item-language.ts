/**
 * 查價時依物品文字判斷語言(第 27 步)。
 *
 * 使用者回報:客戶端語言設繁中、遊戲改英文後,英文複製文字全部解析失敗(`item.wrong_language`)。
 * 國際服的查詢一律用語言無關鍵(stat id / refName),所以只要用「文字本身的語言」的資料集解析,
 * 結果與客戶端語言設對時完全相同 —— 國際服就自動改用文字的語言;台服只支援繁中客戶端,維持現行。
 *
 * 判斷只看名牌區開頭幾行的**標頭字串**,字串一律取自各語系 `client_strings.js` 的
 * `ITEM_CLASS`(`Item Class: ` / `物品種類: `)與 `RARITY`(`Rarity: ` / `稀有度: `),不在這裡自行翻譯。
 * 判斷不出來(沒有標頭、兩種語言都對不上)→ undefined,呼叫端照現行用客戶端語言解析(該報錯就照舊報錯)。
 */
import type { Language, Realm } from './config'

/** 某語系複製文字名牌區的標頭(`client_strings` 原值,結尾通常是 `: `)。 */
export interface ItemTextMarkers {
  itemClass: string
  rarity: string
}

export type LanguageMarkers = Partial<Record<Language, ItemTextMarkers>>

/** 從 `client_strings.js` 的 default export 取標頭;缺欄位 → undefined(該語系不參與判斷)。 */
export function markersFromClientStrings (strings: unknown): ItemTextMarkers | undefined {
  if (!strings || typeof strings !== 'object') return undefined
  const s = strings as Record<string, unknown>
  const itemClass = s.ITEM_CLASS
  const rarity = s.RARITY
  if (typeof itemClass !== 'string' || typeof rarity !== 'string') return undefined
  if (!labelStem(itemClass) || !labelStem(rarity)) return undefined
  return { itemClass, rarity }
}

/**
 * 標頭去掉結尾的冒號 / 空白,比對時接受半形 `:` 與全形 `：`(PoE1 parser 的 `normalizeLabelPunctuation`
 * 會把 `物品種類：` 正規化成 `物品種類: `,這裡比照)。
 */
function labelStem (label: string): string {
  return label.replace(/[\s:：]+$/u, '')
}

function lineHasLabel (line: string, label: string): boolean {
  const stem = labelStem(label)
  if (!stem || !line.startsWith(stem)) return false
  const next = line.charAt(stem.length)
  return next === ':' || next === '：'
}

/** 名牌區最多看幾行(物品種類、稀有度、「你無法使用這個物品」、名稱)。 */
const HEADER_LINES = 4

/**
 * 物品文字的語言。先比 `ITEM_CLASS`(第一順位,最穩定),都沒有再比 `RARITY`
 * (PoE2 meta 技能寶石沒有物品種類行)。兩種語言同時命中(實際不會發生,保險)或都沒命中 → undefined。
 */
export function detectItemTextLanguage (text: string, markers: LanguageMarkers): Language | undefined {
  const lines: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('--------')) break // 名牌區結束
    lines.push(line)
    if (lines.length >= HEADER_LINES) break
  }
  if (!lines.length) return undefined

  const langs = Object.keys(markers) as Language[]
  for (const field of ['itemClass', 'rarity'] as const) {
    const hits = langs.filter(lang => {
      const m = markers[lang]
      return m != null && lines.some(line => lineHasLabel(line, m[field]))
    })
    if (hits.length === 1) return hits[0]
    if (hits.length > 1) return undefined
  }
  return undefined
}

/**
 * 這段文字要用哪個語系的資料集解析:
 * - 國際服:判斷得出文字語言 → 用文字的語言;判斷不出 → 客戶端語言(照現行)。
 * - 台服:一律客戶端語言(台服只支援繁中客戶端;英文文字照舊提示語言不符)。
 */
export function chooseParseLanguage (realm: Realm, clientLanguage: Language, detected: Language | undefined): Language {
  if (realm !== 'intl') return clientLanguage
  return detected ?? clientLanguage
}
