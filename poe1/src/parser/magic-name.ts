import { ITEM_BY_TRANSLATED } from '@/assets/data'

/**
 * ⚠ 本檔取自上游**尚未合併**的 PR。
 *
 *   https://github.com/SnosMe/awakened-poe-trade/pull/1890  (commit 488d2cb)
 *   "Fix: magic items price check failed in chinese"
 *
 * 背景:baseline(`18a401e`)的版本用 `name.split(' ')` 切詞,對沒有空格的
 * 中文/韓文物品名只會產生「整個帶詞綴的名字」這一個候選,永遠查不到基底,
 * 整件物品回 `item.unknown`。實測 47 件繁中 fixture 中有 9 件因此失敗。
 *
 * 本專案原本自己寫了一版(詞組合優先、查不到再退回逐字元),行為與這個 PR
 * 對整個 corpus **逐件相同**,但這版只有 5 行改動。既然等價就採用上游的,
 * 把偏離面積壓到最小 —— 將來 PR 合併時這個檔案可以直接對上。
 *
 * 若上游在合併前改了這個 PR,`npm run check-upstream` 會報出來。
 */
function substrings (name: string, separator: string): string[] {
  const words = name.split(separator)

  return words.flatMap((_, start) =>
    Array(words.length - start).fill(undefined)
      .map((_, idx) => words
        .slice(start, start + idx + 1)
        .join(separator)
      )
  )
}

/**
 * 上面的 `substrings` 是把上游 PR 的組合邏輯抽成函式(行為不變);
 * 兩種切法合併則是本 fork 的追加。
 *
 * 上游版只拿一種分隔字元,而 3.29 的凋落地圖把底材名寫成「凋落的 地圖」
 * (中間有空格),詞綴卻黏在前面不加空格:「傾斜之凋落的 地圖」。
 * 按空格切只會得到「傾斜之凋落的」、「地圖」,真正的底材跨過了空格、永遠拼不出來,
 * 於是退回「地圖」 —— 物品看似解析成功,交易站卻改成查普通地圖、
 * 漏掉 blighted 條件,是不會報錯的錯價。
 *
 * 兩邊的候選合併後依舊取最長的合法底材,英文、俄文、韓文不受影響:
 * 它們的詞綴本就用空格分開,字元切法產不出「比詞彙邊界版更長」的合法底材名。
 */
export function magicBasetype (name: string) {
  // Chinese and Japanese don't use spaces to separate words, so fallback to characters
  const perm: string[] = name.includes(' ')
    ? [...new Set([...substrings(name, ' '), ...substrings(name, '')])]
    : substrings(name, '')

  const result = perm
    .map(name => {
      const result = ITEM_BY_TRANSLATED('ITEM', name)
      return { name, found: (result && result[0].craftable) }
    })
    .filter(res => res.found)
    .sort((a, b) => b.name.length - a.name.length)

  return result.length ? result[0].name : undefined
}
