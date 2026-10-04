<!--
  第 39 步:只在 overlay 模式有作用的整頁(倉庫與聊天、自動辨識)在設定不是 overlay 時,改顯示這一句 +「前往遊戲」按鈕
  (取代改版前散在各卡片的「只在 overlay 模式有效」警告;設定值照常保留)。判斷用設定 `overlayMode`
  (Electron 改了會自動重新啟動 = 與實際模式一致;瀏覽器預覽也看得到實際 app 的模式)。
-->
<template>
  <section class="card overlay-gate" data-setting="overlay-gate">
    <p class="lead">{{ t('ppz.overlay_gate') }}</p>
    <div class="btn-row">
      <button class="btn sm" data-action="overlay-gate-go" @click="goGame">{{ t('ppz.overlay_gate_go') }}</button>
    </div>
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { settingsTab } from './tabState'

export default defineComponent({
  setup () {
    const { t } = useI18n()
    return {
      t,
      goGame () { settingsTab.value = 'game' }
    }
  }
})
</script>
