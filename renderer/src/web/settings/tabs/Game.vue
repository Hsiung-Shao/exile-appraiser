<!--
  設定 › 遊戲(第 39 步,從「一般」與「熱鍵與視窗」搬來):
  - 遊戲與伺服器:遊戲、伺服器、客戶端語言、聯盟、交易站驗證(原本無標籤的「開啟交易站(解除驗證)」按鈕)。
  - 遊戲視窗與 overlay:兩個視窗標題、自動切換、overlay 模式、點面板外關閉(只在 overlay 模式有作用 → 不是 overlay 時不顯示)。
  設定鍵 / 行為不變;`data-setting` 名稱沿用改版前的。
-->
<template>
  <section class="card" data-setting="game-section">
    <span class="label">{{ t('ppz.section_game') }}</span>
    <div class="srow">
      <span class="k">{{ t('ppz.game') }}</span>
      <div class="ctl">
        <div class="seg" data-setting="game">
          <button v-for="g in games" :key="g.id" :class="{ on: config.game === g.id }" :data-value="g.id"
            :title="g.title" @click="config.game = g.id">{{ g.label }}</button>
        </div>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.realm') }}</span>
      <div class="ctl">
        <div class="seg" data-setting="realm">
          <button v-for="r in realms" :key="r" :class="{ on: config.realm === r }" :data-value="r"
            @click="config.realm = r">{{ r === 'intl' ? t('ppz.realm_intl') : t('ppz.realm_tw') }}</button>
        </div>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.language') }} <help-tip id="language-auto" data-note="language-auto" :text="t('ppz.language_auto_hint')" /></span>
      <div class="ctl">
        <div class="seg" data-setting="language">
          <button v-for="l in languages" :key="l" :class="{ on: config.language === l }" :data-value="l"
            @click="config.language = l">{{ languageLabel(l) }}</button>
        </div>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.league') }}</span>
      <div class="ctl">
        <select v-model="leagueId" class="select sm" data-setting="league" :disabled="leagues.isLoading.value">
          <option v-if="leagues.isLoading.value" :value="leagueId">{{ t('ppz.league_loading') }}</option>
          <option v-for="l in leagues.list.value" :key="l.id" :value="l.id">{{ l.id }}</option>
        </select>
      </div>
      <span v-if="leagues.error.value" class="err">{{ t('ppz.league_failed', { error: leagues.error.value }) }}</span>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.trade_captcha') }} <help-tip id="trade-captcha" :text="t('ppz.trade_captcha_help')" /></span>
      <div class="ctl">
        <button class="btn sm" data-action="open-captcha" @click="openCaptcha">{{ t('ppz.trade_captcha_open') }}</button>
      </div>
    </div>
  </section>

  <section class="card" data-setting="window-section">
    <span class="label">{{ t('ppz.section_window') }}</span>
    <div class="srow">
      <span class="k">{{ t('ppz.window_title_poe1') }}</span>
      <div class="ctl">
        <input v-model.lazy.trim="config.windowTitleBy.poe1" class="input sm" placeholder="Path of Exile" data-setting="window-title-poe1">
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.window_title_poe2') }}</span>
      <div class="ctl">
        <input v-model.lazy.trim="config.windowTitleBy.poe2" class="input sm" placeholder="Path of Exile 2" data-setting="window-title-poe2">
      </div>
    </div>
    <div class="chk-row">
      <label class="chk"><input v-model="config.autoSwitchGame" type="checkbox" data-setting="auto-switch-game"><span>{{ t('ppz.auto_switch_game') }}</span></label>
    </div>
    <div class="chk-row">
      <label class="chk"><input v-model="config.overlayMode" type="checkbox" data-setting="overlay-mode"><span>{{ t('ppz.overlay_mode') }}</span></label>
    </div>
    <div v-if="config.overlayMode" class="chk-row">
      <label class="chk"><input v-model="config.overlayBackgroundClose" type="checkbox" data-setting="background-close"><span>{{ t('ppz.background_close') }}</span></label>
    </div>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import { useLeagues } from '@/web/background/Leagues'
import { REALMS, REALM_IDS, TRADE_PATHS, type Language } from '@exile-appraiser/core/realm'
import HelpTip from '../HelpTip.vue'

export default defineComponent({
  components: { HelpTip },
  setup () {
    const { t } = useI18n()
    const leagues = useLeagues()
    const config = AppConfig()
    return {
      t,
      config,
      leagues,
      realms: REALM_IDS,
      games: [
        { id: 'poe1' as const, label: 'PoE1', title: 'Path of Exile' },
        { id: 'poe2' as const, label: 'PoE2', title: 'Path of Exile 2' }
      ],
      languages: ['cmn-Hant', 'en'] as Language[],
      languageLabel: (l: Language) => l === 'cmn-Hant' ? '繁體中文' : 'English',
      leagueId: computed<string | undefined>({
        get: () => leagues.selectedId.value,
        set: (id) => { leagues.selectedId.value = id }
      }),
      openCaptcha () {
        void Host.openCaptcha(`https://${REALMS[config.realm].host}${TRADE_PATHS[config.game].web}`)
      }
    }
  }
})
</script>
