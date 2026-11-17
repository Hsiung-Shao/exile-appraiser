<!--
  設定 › 地圖詞綴(2026-11-18,只在 PoE1;移植 APT「地圖檢查」設定頁,MIT):事先替地圖詞綴標「危險 / 警告 / 好」,
  在遊戲裡對地圖按地圖詞綴檢查熱鍵(熱鍵總表)時依這些標記上色。清單本體在 poe1 `map-check/settings-maps.vue`。
  熱鍵只在 overlay 註冊 → 不是 overlay 時整頁換成 OverlayGate。
-->
<template>
  <overlay-gate v-if="!config.overlayMode" />
  <section v-else class="card" data-setting="map-check">
    <span class="label">{{ t('ppz.tab_map_check') }}</span>
    <p class="lead">{{ t('ppz.map_check.lead') }}</p>
    <settings-maps :config="config.mapCheck" />
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsMaps from '@poe1/map-check/settings-maps.vue'
import { AppConfig } from '@/web/Config'
import OverlayGate from '../OverlayGate.vue'

export default defineComponent({
  components: { SettingsMaps, OverlayGate },
  setup () {
    const { t } = useI18n()
    return { t, config: AppConfig() }
  }
})
</script>
