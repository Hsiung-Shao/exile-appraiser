<!--
  設定 › 計時器(2026-11-18 設定重整:從「一般」搬出成一頁)。
  2026-11-09 計時器(移植 APT 碼表)、2026-11-10 改成 speedrun 式(SpeedrunSection.vue:分段 / 自動分段 / 紀錄,docs/speedrun-timer.md)。
  只在 overlay 模式 → 設定不是 overlay 時整頁只顯示 OverlayGate;五個熱鍵在熱鍵總表編輯,頁頂唯讀列出。
-->
<template>
  <overlay-gate v-if="!config.overlayMode" />
  <template v-else>
    <page-hotkeys :ids="['timerToggle', 'timerReset', 'timerPause', 'timerUndo', 'timerSkip']" />
    <section class="card" data-setting="timer">
      <span class="label">{{ t('ppz.timer.section') }}</span>
      <p class="lead">{{ t('ppz.timer.lead') }}</p>
      <div class="srow">
        <span class="k">{{ t('ppz.timer.display') }}</span>
        <div class="ctl">
          <div class="seg" data-setting="timer-display">
            <button v-for="d in timerDisplays" :key="d" :class="{ on: config.timerDisplay === d }" :data-value="d"
              @click="config.timerDisplay = d">{{ timerDisplayLabel[d] }}</button>
          </div>
          <button v-if="config.timerPos" class="btn sm" data-action="timer-reset-pos" @click="config.timerPos = null">{{ t('ppz.timer.reset_pos') }}</button>
        </div>
      </div>
      <!-- 2026-11-10 speedrun:分段 / 自動分段 / 紀錄(計時器關閉時不顯示) -->
      <speedrun-section v-if="config.timerDisplay !== 'off'" />
    </section>
  </template>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '@/web/Config'
import SpeedrunSection from '../SpeedrunSection.vue'
import OverlayGate from '../OverlayGate.vue'
import PageHotkeys from '../PageHotkeys.vue'
import { TIMER_DISPLAYS } from '@/web/overlay/timer-display'

export default defineComponent({
  components: { SpeedrunSection, OverlayGate, PageHotkeys },
  setup () {
    const { t } = useI18n()
    return {
      t,
      config: AppConfig(),
      timerDisplays: TIMER_DISPLAYS,
      timerDisplayLabel: computed(() => ({ active: t('ppz.timer.display_active'), always: t('ppz.timer.display_always'), off: t('ppz.timer.display_off') }))
    }
  }
})
</script>
