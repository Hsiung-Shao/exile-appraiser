<!--
  設定 › 計時器:一般計時器 / 倒數計時(2026-11-28)。倒數時長(分 + 秒)、一般計時器提醒間隔、音效(內建 / 匯入一個檔)+ 音量 + 試聽。
  尺寸只用 em / --fs-*(設定視窗獨立字級)。
-->
<template>
  <div class="st" data-setting="simple-timer">
    <p class="lead">{{ t('ppz.timer.mode_note_simple') }}</p>
    <div v-if="config.timerMode === 'countdown'" class="srow">
      <span class="k">{{ t('ppz.timer.countdown_len') }}</span>
      <div class="ctl st-len">
        <!-- 包一層 span:`.srow > .ctl > .input` 會把直接子層的輸入框撐滿 -->
        <span class="st-pair"><input class="input sm num st-num" type="number" min="0" max="1440" :value="mins" data-setting="countdown-min"
          :aria-label="t('ppz.timer.countdown_min')" @change="setLen(($event.target as HTMLInputElement).valueAsNumber, secs)">{{ t('ppz.timer.countdown_min') }}</span>
        <span class="st-pair"><input class="input sm num st-num" type="number" min="0" max="59" :value="secs" data-setting="countdown-sec"
          :aria-label="t('ppz.timer.countdown_sec')" @change="setLen(mins, ($event.target as HTMLInputElement).valueAsNumber)">{{ t('ppz.timer.countdown_sec') }}</span>
      </div>
    </div>
    <div v-else class="srow">
      <span class="k">{{ t('ppz.timer.alert_every') }}</span>
      <div class="ctl st-len">
        <span class="st-pair"><input class="input sm num st-num" type="number" min="0" max="600" :value="config.timerAlertMin" data-setting="alert-min"
          @change="setAlert(($event.target as HTMLInputElement).valueAsNumber)">{{ t('ppz.timer.alert_min_unit') }}</span>
        <span class="st-note">{{ t('ppz.timer.alert_every_note') }}</span>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.timer.sound') }}</span>
      <div class="ctl st-len">
        <select class="select sm" :value="config.timerSound.file" data-setting="timer-sound" @change="config.timerSound.file = ($event.target as HTMLSelectElement).value">
          <option value="">{{ t('ppz.timer.sound_builtin') }}</option>
          <option v-if="imported" :value="imported">{{ imported }}</option>
        </select>
        <button v-if="canPick" class="btn ghost sm" data-action="sound-pick" :title="t('ppz.timer.sound_pick_note')" @click="pick">{{ t('ppz.timer.sound_pick') }}</button>
        <button class="btn ghost sm" data-action="sound-test" @click="playTimerSound(config.timerSound.file, config.timerSound.volume)">{{ t('ppz.timer.sound_test') }}</button>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.timer.sound_volume') }}</span>
      <div class="ctl st-len">
        <input v-model.number="volPct" class="slider" type="range" min="0" max="100" step="5" data-setting="timer-volume">
        <span class="num">{{ volPct }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import { playTimerSound } from '@/web/overlay/timer-sound'
import { clampInt } from '@/web/overlay/timer-display'

const { t } = useI18n()
const config = AppConfig()
const canPick = Host.canPickSound
// shortcut: 改回內建後重開設定,下拉就沒有舊匯入檔(檔案還在),要再匯入一次;常有人切來切去再改成列出資料夾
const lastPicked = shallowRef('')
const imported = computed(() => config.timerSound.file || lastPicked.value)

const mins = computed(() => Math.floor(config.timerCountdownSec / 60))
const secs = computed(() => config.timerCountdownSec % 60)
function setLen (m: number, s: number) {
  config.timerCountdownSec = clampInt((Number.isFinite(m) ? m : 0) * 60 + (Number.isFinite(s) ? s : 0), 1, 86400, config.timerCountdownSec)
}
function setAlert (m: number) { config.timerAlertMin = clampInt(m, 0, 600, 0) }
const volPct = computed({
  get: () => Math.round(config.timerSound.volume * 100),
  set: (v: number) => { config.timerSound.volume = Math.min(1, Math.max(0, v / 100)) }
})
async function pick () {
  const f = await Host.soundPick()
  if (f) { lastPicked.value = f; config.timerSound.file = f }
}
</script>

<style scoped>
.st { display: flex; flex-direction: column; gap: 0.4em; }
.st-len { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4em; }
.st-pair { display: inline-flex; align-items: center; gap: 0.35em; }
.st-num { width: 5em; }
.st-note { font-size: var(--fs-2xs); color: var(--ink-3); }
.num { font-family: ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; }
</style>
