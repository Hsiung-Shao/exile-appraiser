<!-- exile-appraiser: 數值 text-white → text-ink-0(淺色主題下白字看不見;token 在深色島裡仍是亮字) -->
<template>
  <span>
    <span v-for="(part, idx) of parts" :key="idx"
      :class="{
        'text-ink-0 font-exo2 font-semibold': part.placeholder,
        'text-gray-200': !part.placeholder
      }"
      >{{ part.text }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed, defineProps } from 'vue'

const props = defineProps<{
  text: string
  roll?: number
}>()

const parts = computed(() => {
  const res = [] as Array<{ text: string, placeholder?: boolean }>
  props.text.split(/(?<![#])[+-]?[#]/gm).forEach((text, idx, parts) => {
    if (text !== '') {
      res.push({ text })
    }
    if (idx !== (parts.length - 1)) {
      if (props.roll == null) {
        res.push({ text: '#' })
      } else {
        res.push({
          text: String(props.roll),
          placeholder: true
        })
      }
    }
  })
  return res
})
</script>
