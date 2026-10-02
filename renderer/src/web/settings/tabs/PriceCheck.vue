<!-- 設定 › 查價:搜尋條件(容差、預設通貨、API 延遲)與掛單/剪貼簿(賣家、帳號、還原剪貼簿)。 -->
<template>
  <section class="card">
    <span class="label">{{ t('ppz.section_search') }}</span>
    <div class="srow">
      <span class="k">{{ t('ppz.stat_range') }}</span>
      <div class="ctl">
        <select v-model.number="pc.searchStatRange" class="select sm" data-setting="stat-range">
          <option v-for="v in [0, 5, 10, 15, 20, 30, 50]" :key="v" :value="v">±{{ v }}%</option>
        </select>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.default_currency') }}</span>
      <div class="ctl">
        <div class="seg" data-setting="default-currency">
          <button v-for="c in currencies" :key="String(c.value)" :class="{ on: pc.defaultCurrency === c.value }"
            :data-value="String(c.value)" @click="pc.defaultCurrency = c.value">{{ t(c.key) }}</button>
        </div>
      </div>
      <span class="note">{{ t('ppz.default_currency_hint') }}</span>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.api_latency') }}</span>
      <div class="ctl">
        <input v-model.number="pc.apiLatencySeconds" type="number" min="0" max="10" step="1"
          class="input sm num latency-input" data-setting="api-latency">
      </div>
    </div>
  </section>

  <section class="card">
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
    <!-- 第 24 步:查價面板通貨價格區的每小時成交量(兩代都有);照 Exiled Exchange 2 settings-price-check.vue 的四選一 -->
    <div class="srow">
      <span class="k">{{ t('ppz.currency_volume') }}</span>
      <div class="ctl">
        <div class="seg" data-setting="currency-volume">
          <button v-for="o in volumeOptions" :key="o.value" :class="{ on: pc.currencyVolume === o.value }"
            :data-value="o.value" @click="pc.currencyVolume = o.value">{{ t(o.key) }}</button>
        </div>
      </div>
      <span class="note">{{ t('ppz.currency_volume_hint') }}</span>
    </div>
    <!-- PoE2 才有(poe1 沒有物品浮窗元件);照 Exiled Exchange 2 settings-price-check.vue 的三選一 -->
    <div v-if="showItemHover" class="srow">
      <span class="k">{{ t('ppz.item_hover') }}</span>
      <div class="ctl">
        <div class="seg" data-setting="item-hover-tooltip">
          <button v-for="o in hoverOptions" :key="o.value" :class="{ on: pc.itemHoverTooltip === o.value }"
            :data-value="o.value" @click="pc.itemHoverTooltip = o.value">{{ t(o.key) }}</button>
        </div>
      </div>
      <span class="note">{{ t('ppz.item_hover_hint') }}</span>
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
import { CURRENCY_VOLUME_OPTIONS, HOVER_OPTIONS, hasItemHover } from './price-check-options'

export default defineComponent({
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
      showItemHover: computed(() => hasItemHover(config.game))
    }
  }
})
</script>

<style>
.settings-panel .latency-input {
  flex: 0 0 64px !important;
}
</style>
