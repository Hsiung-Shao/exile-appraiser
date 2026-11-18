// exile-appraiser:移植自 Awakened PoE Trade `renderer/src/web/map-check/prepare-map-stats.ts`(MIT)。
// 耦合點:多帶 stat `ref`(標記鍵);`roundRoll` 的相對路徑改成本目錄的位置。
import { StatCalculated, statSourcesTotal, translateStatWithRoll } from '@/parser/modifiers'
import { roundRoll } from '../filters/util'

export interface PreparedStat {
  ref: string // exile-appraiser
  matcher: string
  roll?: number
}

export function prepareMapStat (calc: StatCalculated): PreparedStat {
  const roll = statSourcesTotal(calc.sources)
  const translation = translateStatWithRoll(calc, roll)

  const prepared = {
    ref: calc.stat.ref, // exile-appraiser
    matcher: translation.string,
    roll: roll && roundRoll(roll.value, translation.dp ?? false)
  }

  if (translation.negate) {
    if (prepared.roll != null) {
      prepared.roll = -1 * prepared.roll
    }
  }

  return prepared
}
