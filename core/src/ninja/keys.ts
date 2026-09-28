/**
 * poe.ninja 價格表的鍵(語言無關:全部用英文名)。格式與 PobTools `host/warehouse_pricing.cpp` 的
 * `Ninja*Key` 逐字相同,兩邊的快取與價格表可以互相對照。
 *
 * - `currency|<name>`:exchange 各類(通貨、碎片、聖甲蟲、油、精髓、化石…);
 * - `card|<name>`:命運卡(exchange `DivinationCard`);
 * - `gem|<name>|<lvl>|<q>[|c]`:技能寶石,等級/品質歸到 ninja 的級距(1/20/21、0/20/23);
 * - `unique|<name>|<baseType>[|6L]`:傳奇(含傳奇地圖,傳奇地圖不帶連結);
 * - `map|<name>|T<tier>`:一般地圖。
 */

export function currencyKey (name: string): string {
  return 'currency|' + name
}

export function cardKey (name: string): string {
  return 'card|' + name
}

/** poe.ninja 只在這些等級出價:1 / 20 / 21;其他等級視為下一個較低的級距(同網站上的人工判讀)。 */
export function gemLevelBucket (level: number): number {
  if (level >= 21) return 21
  if (level >= 20) return 20
  return 1
}

/** 品質級距 0 / 20 / 23。 */
export function gemQualityBucket (quality: number): number {
  if (quality >= 23) return 23
  if (quality >= 20) return 20
  return 0
}

export function gemKey (name: string, level: number, quality: number, corrupted: boolean): string {
  let k = `gem|${name}|${gemLevelBucket(level)}|${gemQualityBucket(quality)}`
  if (corrupted) k += '|c'
  return k
}

export function uniqueKey (name: string, baseType: string, links = 0): string {
  let k = `unique|${name}|${baseType}`
  if (links >= 6) k += '|6L'
  return k
}

export function mapKey (name: string, tier: number): string {
  return `map|${name}|T${tier}`
}
