<!--
  exile-appraiser: 熱鍵擷取欄。移植自 apt-patched `renderer/src/web/settings/HotkeyInput.vue`(MIT):
  keyup 時把 e.code 轉成 APT 的熱鍵字串(`Ctrl + Shift + F`,ipc/KeyToCode 的 hotkeyToString),
  F12 保留給開發者工具不收。改動:
  - Backspace / Delete / Esc 清除(上游只有 Backspace);`required` 時不清除
  - 樣式改 pobtools 的 .input(置中、等寬),空值時 placeholder 用 --bad 提示
  - `noModKeys`:只收單鍵(快速查價的主鍵;修飾鍵另由「按住」下拉決定)
-->
<template>
  <input
    class="input hotkey-input num"
    :class="{ 'is-empty': !modelValue }"
    readonly
    :value="modelValue || ''"
    :placeholder="modelValue || t('ppz.hotkey_none')"
    :title="t('ppz.hotkey_capture_hint')"
    @keyup="handleKeyup"
    @keydown.prevent>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { KeyToCode, hotkeyToString } from '@ipc/KeyToCode'

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

    return {
      t,
      handleKeyup (e: KeyboardEvent) {
        e.preventDefault()
        e.stopPropagation()

        if (e.code === 'Backspace' || e.code === 'Delete' || e.code === 'Escape') {
          if (!props.required) {
            ctx.emit('update:modelValue', '')
          }
          return
        }

        let { code } = e
        const { ctrlKey, shiftKey, altKey } = e

        if (code.startsWith('Key')) {
          code = code.slice('Key'.length)
        } else if (code.startsWith('Digit')) {
          code = code.slice('Digit'.length)
        } else if (e.key === 'Cancel' && code === 'Pause') {
          code = 'Cancel'
        }

        if ((KeyToCode as Record<string, number>)[code]) {
          code = hotkeyToString([code], ctrlKey, shiftKey, altKey)
          if (code.includes('F12')) return
          if (props.noModKeys && code.includes('+')) return
          ctx.emit('update:modelValue', code)
        }
      }
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
