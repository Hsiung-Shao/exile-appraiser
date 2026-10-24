<template>
  <div :class="[$style.btn, { [$style.active]: !filter.disabled }]">
    <button @click="filter.disabled = !filter.disabled" class="pl-2">{{ name }}</button>
    <input :class="$style.input" step="any" type="number"
      v-model.number="inputMin"
      @focus="inputFocus"
      @blur="inputMinBlur"
      @mousewheel.stop
      :style="{ width: `${1.2 + Math.max(String(inputMin).length, 2)}ch` }"
    >
    <template v-if="'max' in filter">
      <span>–</span>
      <input :class="$style.input" step="any" type="number"
        v-model.number="inputMax"
        @focus="inputFocus"
        @mousewheel.stop
        :style="{ width: `${1.2 + Math.max(String(inputMax).length, 2)}ch` }"
        placeholder="…"
      >
    </template>
  </div>
</template>

<script lang="ts">
// exile-appraiser: 2026-10-14 B 改版:本檔呈現層已重寫(外觀改成物品標頭膠囊;行為不動),記錄在 docs/poe2-port-notes.md「查價面板 B 改版」。
import { defineComponent, PropType, computed, ref, watch } from 'vue'
import { FilterNumeric } from './interfaces'

export default defineComponent({
  emits: [], // mutates filter
  props: {
    filter: {
      type: Object as PropType<FilterNumeric>,
      required: true
    },
    name: {
      type: String,
      required: true
    }
  },
  setup (props) {
    const _inputMin = ref<number | ''>('')
    watch(() => props.filter, (filter) => {
      _inputMin.value = filter.value
    }, { immediate: true })

    const _inputMax = ref<number | ''>('')
    watch(() => props.filter, (filter) => {
      _inputMax.value = filter.max ?? ''
    }, { immediate: true })

    return {
      inputMin: computed<number | ''>({
        get () { return _inputMin.value },
        set (value) {
          _inputMin.value = value
          if (typeof value === 'number') {
            props.filter.value = value
          } else {
            props.filter.value = 0
          }
        }
      }),
      inputMax: computed<number | ''>({
        get () { return _inputMax.value },
        set (value) {
          _inputMax.value = value
          if (typeof value === 'number') {
            props.filter.max = value
          } else {
            props.filter.max = undefined
          }
        }
      }),
      inputFocus (e: FocusEvent) {
        const target = e.target as HTMLInputElement
        target.select()
        props.filter.disabled = false
      },
      inputMinBlur () {
        if (typeof _inputMin.value !== 'number') {
          _inputMin.value = 0
          props.filter.disabled = true
        }
      }
    }
  }
})
</script>

<style lang="postcss" module>
@reference "../../../../../renderer/src/theme/tailwind.css";
.btn {
  /* 2026-10-14 B 改版:物品標頭膠囊 */
  display: flex;
  align-items: center;
  height: 1.85em;
  padding-right: 0.45em;
  border: 1px solid var(--edge-1);
  border-radius: 999px;
  background: var(--surface-1);
  color: var(--ink-2);
  overflow: hidden;

  &.active {
    border-color: var(--gold-dim);
    background: var(--gold-soft);
    color: var(--ink-0);
  }
}

.input {
  @apply text-center;
  @apply bg-transparent;
  @apply text-gray-300;
  @apply select-all;

  &:hover,
  &:focus {
    @apply bg-gray-700;
  }

  &::placeholder {
    @apply text-gray-400;
  }

  &:focus { cursor: none; }
}
</style>
