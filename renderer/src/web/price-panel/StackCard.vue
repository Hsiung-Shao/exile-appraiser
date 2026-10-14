<!--
  2026-10-14 查價面板 B 改版:「你的這一疊」卡(設計稿 PricePanelBCurrency)。兩代 StackValue.vue 組好 `StackView` 傳進來。
-->
<template>
  <section class="ph-card" data-stack-value>
    <div class="ph-h">{{ t('ppz.hero.stack_title') }}</div>
    <div class="ph-stats" :style="{ gridTemplateColumns: stack.oneStack ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)' }">
      <div class="ph-stat" data-stack-have>
        <span>{{ t('ppz.hero.stack_have', [stack.have.count]) }}</span>
        <b>= {{ fmtAmount(stack.have.value.amount) }}<img v-if="icon(stack.have.value.unit)" :src="icon(stack.have.value.unit)" :alt="stack.have.value.unit"><template v-else>&nbsp;{{ unitShort(stack.have.value.unit) }}</template></b>
      </div>
      <div v-if="stack.oneStack" class="ph-stat" data-stack-max>
        <span>{{ t('ppz.hero.stack_max', [stack.oneStack.count]) }}</span>
        <b>= {{ fmtAmount(stack.oneStack.value.amount) }}<img v-if="icon(stack.oneStack.value.unit)" :src="icon(stack.oneStack.value.unit)" :alt="stack.oneStack.value.unit"><template v-else>&nbsp;{{ unitShort(stack.oneStack.value.unit) }}</template></b>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { fmtAmount, unitIconFor, unitShort, type Game, type StackView } from './price-hero'

const props = defineProps({
  game: { type: String as PropType<Game>, required: true },
  stack: { type: Object as PropType<StackView>, required: true }
})

const { t } = useI18n()
const icon = (unit: string) => unitIconFor(props.game, unit)
</script>

<style src="./price-panel.css"></style>
