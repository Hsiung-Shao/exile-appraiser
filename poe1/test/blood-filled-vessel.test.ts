import { beforeAll, describe, expect, it } from 'vitest'
import { init, ITEM_BY_REF, STAT_BY_REF_V2 } from '@/assets/data'
import { parseClipboard } from '@/parser'

/**
 * 浸血碑器的邊界情形。
 *
 * 為什麼不放進 `test/fixtures/`:那個 corpus 的定義是**真實剪貼簿內容**
 * (見 `.gitattributes`),而下面這些輸入是為了逼出特定分支**組出來的** ——
 * 混進去會讓「這是玩家真的複製出來的東西」這條前提失效。
 *
 * 每一組文字裡的每一個字串仍然都來自 GGPK `clientstrings`,只是排列組合不同:
 *   RitualStoneVarieties / RitualStoneNumOtherMonsters / RitualStoneLevel /
 *   RitualStoneFromArea / RitualBloodVesselBonuses。
 *
 * 主線(3 隻傳奇 + 41 隻非傳奇)在 `fixtures/{cmn-Hant,en}/blood-filled-vessel-01`,
 * 這裡只補 fixture 碰不到的路徑。
 */

const UNIQUE_REF = 'Unique Monsters (Blood-Filled Vessel): #'
const OTHER_REF = 'Non-Unique Monsters (Blood-Filled Vessel): #'

/** 碑器的名牌 + 尾巴是固定的,測試只換中間那一段怪物清單。 */
function vessel (monsterSection: string[], bonuses?: string[]): string {
  return [
    '物品種類: 地圖碎片',
    '稀有度: 普通',
    '浸血碑器',
    '--------',
    ...monsterSection,
    '--------',
    ...(bonuses ?? [
      '祭祀有優化 20% 恩賜獎勵',
      '祭祀產生怪物比平常快 20%',
      '祭祀存活 20% 更多上限怪物'
    ]),
    '--------',
    '可以和地圖同時使用於個人的地圖裝置，將你之前祭祀神壇保存的怪物加入至該地圖的祭祀神壇中。'
  ].join('\r\n') + '\r\n'
}

function parse (text: string) {
  const result = parseClipboard(text)
  if (result.isErr()) throw new Error(`解析失敗:${result.error}`)
  const item = result.value

  const counts = new Map<string, number>()
  const tradeIds = new Map<string, string[]>()
  for (const mod of item.newMods) {
    for (const parsed of mod.stats) {
      if (parsed.roll) counts.set(parsed.stat.ref, parsed.roll.value)
      tradeIds.set(parsed.stat.ref, parsed.stat.trade.ids.pseudo ?? [])
    }
  }
  return { item, counts, tradeIds }
}

beforeAll(async () => {
  await init('cmn-Hant')
}, 120_000)

describe('浸血碑器', () => {
  it('半形冒號的標籤(使用者回報的寫法)也認得', () => {
    // GGPK 的 RitualStoneVarieties 是「怪物：」(全形,冒號寫死在字串裡),
    // 但使用者回報的樣本是「怪物:」。兩種都必須讀得到,否則整段怪物清單無聲消失。
    const { counts } = parse(vessel([
      '怪物:',
      '超然的卡洛斯',
      '焚屍者波莉亞',
      '燃屍者波莉亞',
      '41 其他怪物',
      '怪物等級: 83',
      '來自: 危城廣場'
    ]))
    expect(counts.get(UNIQUE_REF)).toBe(3)
    expect(counts.get(OTHER_REF)).toBe(41)
  })

  it('尾巴兩行是全形冒號也不會被當成怪物名', () => {
    // 「怪物等級」與「來自」是終止行。認不出來的話它們會被算進傳奇怪物數,
    // 而錯的數字比沒有數字更糟 —— 送出去照樣有結果,只是全都不對。
    const { counts } = parse(vessel([
      '怪物：',
      '超然的卡洛斯',
      '41 其他怪物',
      '怪物等級：83',
      '來自：危城廣場'
    ]))
    expect(counts.get(UNIQUE_REF)).toBe(1)
    expect(counts.get(OTHER_REF)).toBe(41)
  })

  it('沒有任何具名怪物時傳奇數是 0', () => {
    const { counts } = parse(vessel([
      '怪物：',
      '41 其他怪物',
      '怪物等級: 83',
      '來自: 危城廣場'
    ]))
    expect(counts.get(UNIQUE_REF)).toBe(0)
    expect(counts.get(OTHER_REF)).toBe(41)
  })

  it('沒有「N 其他怪物」那一行時,不送非傳奇那一條(而不是送 0)', () => {
    const { counts } = parse(vessel([
      '怪物：',
      '超然的卡洛斯',
      '焚屍者波莉亞',
      '怪物等級: 83',
      '來自: 危城廣場'
    ]))
    expect(counts.get(UNIQUE_REF)).toBe(2)
    expect(counts.has(OTHER_REF)).toBe(false)
  })

  it('送出去的是兩服一致的 pseudo id', () => {
    const { tradeIds } = parse(vessel([
      '怪物：', '超然的卡洛斯', '41 其他怪物', '怪物等級: 83', '來自: 危城廣場'
    ]))
    expect(tradeIds.get(UNIQUE_REF)).toEqual(['pseudo.pseudo_ritual_unique_monsters'])
    expect(tradeIds.get(OTHER_REF)).toEqual(['pseudo.pseudo_ritual_other_monsters'])
  })

  it('固定加成那一段被認領,不會變成未知詞綴', () => {
    const { item } = parse(vessel([
      '怪物：', '超然的卡洛斯', '41 其他怪物', '怪物等級: 83', '來自: 危城廣場'
    ]))
    expect(item.unknownModifiers).toEqual([])
  })

  it('加成措辭漂掉一個字仍然被認領', () => {
    // GGPK 寫的是「更多上限怪物」,使用者回報的樣本是「更多上級怪物」。
    // 這一段是每顆碑器逐字相同的說明文字、交易站沒有對應篩選器,所以判定只要
    // 三行裡**任何一行**對得上就整段吃掉 —— 措辭一漂就讓每一位使用者看到一條
    // 假的「未知詞綴」才是真正的缺陷。
    const { item } = parse(vessel(
      ['怪物：', '超然的卡洛斯', '41 其他怪物', '怪物等級: 83', '來自: 危城廣場'],
      [
        '祭祀有優化 20% 恩賜獎勵',
        '祭祀產生怪物比平常快 20%',
        '祭祀存活 20% 更多上級怪物'
      ]))
    expect(item.unknownModifiers).toEqual([])
  })

  it('大小寫陷阱:物品名小寫 f、pseudo 詞綴大寫 F', () => {
    // GGG 自己不一致。任何一邊被「順手改成跟另一邊一樣」,結果都是靜默搜不到,
    // 而型別檢查、lint、建置全部照樣綠 —— 所以在這裡把兩種拼法都釘住。
    expect(ITEM_BY_REF('ITEM', 'Blood-filled Vessel')?.length).toBeGreaterThan(0)
    expect(ITEM_BY_REF('ITEM', 'Blood-Filled Vessel')?.length).toBeFalsy()

    expect(STAT_BY_REF_V2(UNIQUE_REF)).toBeTruthy()
    expect(STAT_BY_REF_V2(OTHER_REF)).toBeTruthy()
    expect(STAT_BY_REF_V2('Unique Monsters (Blood-filled Vessel): #')).toBeFalsy()
  })
})
