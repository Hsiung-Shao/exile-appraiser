<!--
  設定 › 查價(第 39 步整理):搜尋條件(容差、預設通貨、API 延遲)/ 面板顯示(通貨成交量、相關物品大小、滑鼠懸停顯示物品)/ 掛單與剪貼簿(賣家、帳號、還原剪貼簿)。
  只對某遊戲 / 伺服器有效的項目不符條件就不顯示:預設價格通貨只影響 PoE1、通貨成交量 / 相關物品大小只有國際服(poe.ninja)、懸停物品只有 PoE2;
  面板顯示卡片沒有任何一項時整張不顯示。
-->
<template>
  <section class="card" data-setting="search-section">
    <span class="label">{{ t('ppz.section_search') }}</span>
    <div class="srow">
      <span class="k">{{ t('ppz.stat_range') }}</span>
      <div class="ctl">
        <select v-model.number="pc.searchStatRange" class="select sm" data-setting="stat-range">
          <option v-for="v in [0, 5, 10, 15, 20, 30, 50]" :key="v" :value="v">±{{ v }}%</option>
        </select>
      </div>
    </div>
    <div v-if="showDefaultCurrency" class="srow">
      <span class="k">{{ t('ppz.default_currency') }}</span>
      <div class="ctl">
        <div class="seg" data-setting="default-currency">
          <button v-for="c in currencies" :key="String(c.value)" :class="{ on: pc.defaultCurrency === c.value }"
            :data-value="String(c.value)" @click="pc.defaultCurrency = c.value">{{ t(c.key) }}</button>
        </div>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.api_latency') }}</span>
      <div class="ctl">
        <input v-model.number="pc.apiLatencySeconds" type="number" min="0" max="10" step="1"
          class="input sm num latency-input" data-setting="api-latency">
      </div>
    </div>
  </section>

  <section v-if="showVolume || showItemHover" class="card" data-setting="panel-section">
    <span class="label">{{ t('ppz.section_panel') }}</span>
    <!-- 第 24 步:查價面板通貨價格區的每小時成交量(兩代都有;只有國際服有 poe.ninja);照 Exiled Exchange 2 settings-price-check.vue 的四選一 -->
    <div v-if="showVolume" class="srow">
      <span class="k">{{ t('ppz.currency_volume') }}</span>
      <div class="ctl">
        <div class="seg" data-setting="currency-volume">
          <button v-for="o in volumeOptions" :key="o.value" :class="{ on: pc.currencyVolume === o.value }"
            :data-value="o.value" @click="pc.currencyVolume = o.value">{{ t(o.key) }}</button>
        </div>
      </div>
      <span class="note">{{ t('ppz.currency_volume_hint') }}</span>
    </div>
    <!-- 2026-10-06:查價面板旁「相關物品」的大小(只有國際服顯示相關物品;related-items-scale.ts) -->
    <div v-if="showVolume" class="srow">
      <span class="k">{{ t('ppz.related_items_scale') }}</span>
      <div class="ctl" data-setting="related-items-scale">
        <input v-model.number="config.relatedItemsScale" class="slider" type="range" :min="relMin" :max="relMax" step="5">
        <button class="btn ghost sm" :disabled="config.relatedItemsScale <= relMin" @click="config.relatedItemsScale = Math.max(relMin, config.relatedItemsScale - 10)">−</button>
        <span class="num fs-val">{{ config.relatedItemsScale }}%</span>
        <button class="btn ghost sm" :disabled="config.relatedItemsScale >= relMax" @click="config.relatedItemsScale = Math.min(relMax, config.relatedItemsScale + 10)">+</button>
        <button class="btn ghost sm" :disabled="config.relatedItemsScale === relDefault" @click="config.relatedItemsScale = relDefault">{{ t('ppz.font_size_reset') }}</button>
      </div>
      <span class="note">{{ t('ppz.related_items_scale_hint') }}</span>
    </div>
    <!-- PoE2 才有(poe1 沒有物品浮窗元件);照 Exiled Exchange 2 settings-price-check.vue 的三選一 -->
    <div v-if="showItemHover" class="srow">
      <span class="k">{{ t('ppz.item_hover') }} <help-tip id="item-hover" :text="t('ppz.item_hover_help')" /></span>
      <div class="ctl">
        <div class="seg" data-setting="item-hover-tooltip">
          <button v-for="o in hoverOptions" :key="o.value" :class="{ on: pc.itemHoverTooltip === o.value }"
            :data-value="o.value" @click="pc.itemHoverTooltip = o.value">{{ t(o.key) }}</button>
        </div>
      </div>
      <span class="note">{{ t('ppz.item_hover_hint') }}</span>
    </div>
  </section>

  <section class="card" data-setting="listing-section">
    <span class="label">{{ t('ppz.section_listing') }}</span>
    <div class="srow">
      <span class="k">{{ t('ppz.show_seller') }}</span>
      <div class="ctl">
        <div class="seg" data-setting="show-seller">
          <button v-for="s in sellers" :key="String(s.value)" :class="{ on: pc.showSeller === s.value }"
            @click="pc.showSeller = s.value">{{ t(s.key) }}</button>
        </div>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.account_name') }}</span>
      <div class="ctl">
        <input v-model.lazy.trim="config.accountName" class="input sm" data-setting="account-name">
      </div>
    </div>
    <div class="chk-row">
      <label class="chk">
        <input v-model="config.restoreClipboard" type="checkbox" data-setting="restore-clipboard">
        <span>{{ t('ppz.restore_clipboard') }}</span>
      </label>
    </div>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '@/web/Config'
import { CURRENCY_VOLUME_OPTIONS, HOVER_OPTIONS, hasCurrencyVolume, hasDefaultCurrency, hasItemHover } from './price-check-options'
import HelpTip from '../HelpTip.vue'
import { RELATED_SCALE_DEFAULT, RELATED_SCALE_MAX, RELATED_SCALE_MIN } from '../../related-items-scale'

export default defineComponent({
  components: { HelpTip },
  setup () {
    const { t } = useI18n()
    const config = AppConfig()
    return {
      t,
      config,
      pc: config.priceCheck,
      // GGG 交易站 trade_filters.price.option 的值(null = 不指定)
      currencies: [
        { value: null, key: 'ppz.currency_any' },
        { value: 'chaos', key: 'ppz.currency_chaos' },
        { value: 'divine', key: 'ppz.currency_divine' }
      ] as Array<{ value: string | null, key: string }>,
      sellers: [
        { value: false, key: 'ppz.show_seller_no' },
        { value: 'account', key: 'ppz.show_seller_account' },
        { value: 'ign', key: 'ppz.show_seller_ign' }
      ] as Array<{ value: false | 'account' | 'ign', key: string }>,
      hoverOptions: HOVER_OPTIONS,
      volumeOptions: CURRENCY_VOLUME_OPTIONS,
      relMin: RELATED_SCALE_MIN,
      relMax: RELATED_SCALE_MAX,
      relDefault: RELATED_SCALE_DEFAULT,
      showItemHover: computed(() => hasItemHover(config.game)),
      showDefaultCurrency: computed(() => hasDefaultCurrency(config.game)),
      showVolume: computed(() => hasCurrencyVolume(config.realm))
    }
  }
})
</script>

<style>
.settings-panel .latency-input {
  flex: 0 0 64px !important;
}
</style>
