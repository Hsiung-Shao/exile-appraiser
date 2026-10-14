/**
 * exile-appraiser(2026-10-14 查價面板 B 改版):PoE2 一般物品價格區(renderer `price-panel/PriceHero.vue`)的換算器。
 * 掛單原幣 → divine:與 `trade/pathofexile-trade.ts` 結果列 `normalizedPrice` 同一條路(`getCurrencyDetailsId` →
 * poe.ninja `primaryValue`),只是不先四捨五入成字串;顯示照 `autoCurrency`(≥ 1 div 神聖石,否則崇高石)。
 * 沒有價格表(台服 / 沒注入價格源)→ 不給 `toBase`,摘要改用原幣別。
 */
import { usePoeninja } from "@/web/background/Prices";
import { getCurrencyDetailsId } from "./trends/getDetailsId";

export interface HeroMoney {
  amount: number;
  unit: string;
}

export function poe2HeroConverters(): {
  toBase?: (amount: number, currency: string) => number | undefined;
  show: (divine: number) => HeroMoney;
} {
  const ninja = usePoeninja();
  const show = (divine: number): HeroMoney => {
    const v = ninja.autoCurrency(divine);
    return { amount: v.min, unit: v.currency };
  };
  if (ninja.xchgRate.value === undefined) return { show };
  return {
    toBase(amount, currency) {
      const entry = ninja.findPriceByQuery(getCurrencyDetailsId(currency));
      return entry ? amount * entry.primaryValue : undefined;
    },
    show,
  };
}
