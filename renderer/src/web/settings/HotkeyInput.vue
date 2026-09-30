<!--
  exile-appraiser: 熱鍵擷取欄。移植自 apt-patched `renderer/src/web/settings/HotkeyInput.vue`(MIT):
  把 e.code 轉成 APT 的熱鍵字串(`Ctrl + Shift + F`,ipc/KeyToCode 的 hotkeyToString),
  F12 保留給開發者工具不收。改動:
  - Backspace / Delete / Esc 清除(上游只有 Backspace);`required` 時不清除
  - 樣式改 pobtools 的 .input(置中、等寬),空值時 placeholder 用 --bad 提示
  - `noModKeys`:只收單鍵(快速查價的主鍵;修飾鍵另由「按住」下拉決定)
  - 在非修飾鍵 keydown 時組字串(上游是 keyup:先放開 Alt 再放開 D 會變 `Ctrl + D`);keyup 只補沒有 keydown 的鍵
    (PrintScreen)。純邏輯在 hotkey-capture.ts。
  - keydown / keyup 一律 preventDefault:單按 Alt 不讓 Electron 切選單列、不進 Windows 選單模式
  - 取得焦點時設 `hotkeyCaptureActive`:App.vue 擷取中不因按住 Alt 隱藏 overlay(否則欄位失焦收不到 Ctrl+Alt+D)
-->
<template>
  <input
    class="input hotkey-input num"
    :class="{ 'is-empty': !modelValue }"
    readonly
    :value="modelValue || ''"
    :placeholder="modelValue || t('ppz.hotkey_none')"
    :title="t('ppz.hotkey_capture_hint')"
    @keydown="handleKeydown"
    @keyup="handleKeyup"
    @focus="onFocus"
    @blur="onBlur">
</template>

<script lang="ts">
import { defineComponent, onUnmounted, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { hotkeyCaptureActive, isClearKey, keyEventToHotkey } from './hotkey-capture'

export default defineComponent({
  emits: ['update:modelValue'],
  props: {
    modelValue: {
      type: String as PropType<string | null>,
      default: null
    },
    noModKeys: {
      type: Boolean,
      default: false
    },
    required: {
      type: Boolean,
      default: false
    }
  },
  setup (props, ctx) {
    const { t } = useI18n()
    /** 已在 keydown 處理過的鍵(keyup 時略過) */
    const handledDown = new Set<string>()
    let focused = false

    function apply (e: KeyboardEvent) {
      if (isClearKey(e.code)) {
        if (!props.required) ctx.emit('update:modelValue', '')
        return
      }
      const hotkey = keyEventToHotkey(e, props.noModKeys)
      if (hotkey) ctx.emit('update:modelValue', hotkey)
    }

    function release () {
      handledDown.clear()
      if (focused) {
        focused = false
        hotkeyCaptureActive.value = false
      }
    }
    onUnmounted(release)

    return {
      t,
      handleKeydown (e: KeyboardEvent) {
        e.preventDefault()
        handledDown.add(e.code)
        apply(e)
      },
      handleKeyup (e: KeyboardEvent) {
        e.preventDefault()
        e.stopPropagation()
        if (handledDown.delete(e.code)) return
        apply(e)
      },
      onFocus () {
        focused = true
        hotkeyCaptureActive.value = true
      },
      onBlur: release
    }
  }
})
</script>

<style>
.hotkey-input {
  text-align: center;
  cursor: pointer;
  caret-color: transparent;
}
.hotkey-input.is-empty::placeholder {
  color: var(--bad);
}
</style>
