// 通貨圖示:兩代分開。PoE1 用 /images/<key>.png;PoE2 用自己的圖 /images/poe2/<key>.png
// (來源與 sha256 見 renderer/public/images/poe2/SOURCE.json,由 scripts/fetch-poe2-currency-icons.mjs 產生)。
export type CurrencyIconKey = 'exa' | 'divine' | 'chaos' | 'annul' | 'wisdom'

export function currencyIcon (game: 'poe1' | 'poe2', key: CurrencyIconKey): string {
  return game === 'poe2' ? `/images/poe2/${key}.png` : `/images/${key}.png`
}
