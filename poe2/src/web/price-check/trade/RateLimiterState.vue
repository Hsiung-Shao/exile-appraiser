<template>
  <div :class="[$style.wrap, align === 'end' ? $style.alignEnd : $style.alignStart]" v-bind="$attrs">
    <button class="btn ghost sm" :class="{ [$style.limited]: isLimited }"
      @click="showRateLimitState = !showRateLimitState">{{ t('ppz.rate_limit_state') }}</button>
    <div v-if="showRateLimitState" class="card" :class="$style.panel">
      <div v-for="limit in limits" :key="limit.policy" :class="$style.policy">
        <div :class="limit.hasQueue ? $style.queued : $style.name">{{ limit.policy }}</div>
        <div v-for="(rule, idx) in limit.rules" :key="idx" class="num">
          <span>{{ rule.active }} / {{ rule.max }} over {{ rule.window }}s</span>
          <span v-if="rule.queue" class="pl-1">(queue: {{ rule.queue }})</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// exile-appraiser: 這一份直接沿用 poe1 package 的改寫版(E 的原版依賴 Vue 響應式 RateLimiter,核心已抽到 core);
// 讀的是 poe2 自己的 tradeSession(./common)。
// exile-appraiser: 版面改動見 <style> 註解;按鈕字串走 i18n(ppz.rate_limit_state)。
// exile-appraiser: RATE_LIMIT_RULES 改成 tradeSession(realm).limits;core 的 RateLimiter 沒有 Vue 響應式,
// 改用 subscribe() 推進 tick 計數器讓 computed 重算;realm 變更時重新訂閱,面板顯示中每秒重新對齊
// (限流器集合會被 adjustRateLimits 增刪,新加入的實例要補訂閱)。
import { computed, defineComponent, shallowRef, watch, onUnmounted, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { tradeSession } from './common'
import { RateLimiter } from './RateLimiter'
import { PriceCheckWidget } from '@/web/overlay/interfaces'
import { AppConfig } from '@/web/Config'

export default defineComponent({
  inheritAttrs: false,
  props: {
    /** exile-appraiser: 狀態面板貼齊按鈕的哪一側(App.vue 依面板位置決定)。 */
    align: { type: String as PropType<'start' | 'end'>, default: 'start' }
  },
  setup () {
    const { t } = useI18n()
    const widget = computed(() => AppConfig<PriceCheckWidget>('price-check')!)

    const tick = shallowRef(0)
    const subscriptions = new Map<RateLimiter, () => void>()

    function currentLimits () {
      return tradeSession(AppConfig().realm).limits
    }

    function syncSubscriptions () {
      const rules = currentLimits()
      const live = new Set<RateLimiter>([...rules.SEARCH, ...rules.EXCHANGE, ...rules.FETCH])
      for (const [rl, unsub] of subscriptions) {
        if (!live.has(rl)) { unsub(); subscriptions.delete(rl) }
      }
      for (const rl of live) {
        if (!subscriptions.has(rl)) {
          subscriptions.set(rl, rl.subscribe(() => { tick.value += 1 }))
        }
      }
    }

    function unsubscribeAll () {
      for (const unsub of subscriptions.values()) unsub()
      subscriptions.clear()
    }

    watch(() => AppConfig().realm, () => {
      unsubscribeAll()
      syncSubscriptions()
      tick.value += 1
    }, { immediate: true })

    watch(tick, () => { syncSubscriptions() })

    let poll: ReturnType<typeof setInterval> | null = null
    watch(() => widget.value.showRateLimitState, (shown) => {
      if (poll) { clearInterval(poll); poll = null }
      if (shown) {
        poll = setInterval(() => { syncSubscriptions(); tick.value += 1 }, 1000)
      }
    }, { immediate: true })

    onUnmounted(() => {
      if (poll) clearInterval(poll)
      unsubscribeAll()
    })

    const limits = computed(() => {
      void tick.value
      const RATE_LIMIT_RULES = currentLimits()
      const LIMITS = [
        { policy: 'trade-search-request-limit', rules: RATE_LIMIT_RULES.SEARCH },
        { policy: 'trade-exchange-request-limit', rules: RATE_LIMIT_RULES.EXCHANGE },
        { policy: 'trade-fetch-request-limit', rules: RATE_LIMIT_RULES.FETCH }
      ]

      return LIMITS.map((limit) => ({
        policy: limit.policy,
        hasQueue: Array.from(limit.rules).some(rl => rl.queue.value),
        rules: Array.from(limit.rules).map(rl => ({
          max: rl.max,
          window: rl.window,
          active: rl.stack.length,
          queue: rl.queue.value
        }))
      }))
    })

    const isLimited = computed(() => limits.value.some(limit => limit.hasQueue))

    const showRateLimitState = computed<boolean>({
      get () {
        return widget.value.showRateLimitState
      },
      set (value) {
        widget.value.showRateLimitState = value
      }
    })

    return {
      t,
      limits,
      showRateLimitState,
      isLimited
    }
  }
})
</script>

<style lang="postcss" module>
/* exile-appraiser: 按鈕不再 absolute 蓋在面板底部;由 App.vue 放位置(視窗模式:底列右側;overlay:面板外側)。
   狀態面板改 .card,從按鈕上方彈出、依 align 貼齊按鈕的左或右緣,不蓋住查價面板。 */
.wrap {
  position: relative;
  display: inline-flex;
}
.panel {
  position: absolute;
  bottom: calc(100% + 6px);
  z-index: 30;
  width: max-content;
  max-width: 22rem;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--fs-2xs);
  color: var(--ink-1);
  box-shadow: var(--shadow-float);
}
.alignStart .panel {
  left: 0;
}
.alignEnd .panel {
  right: 0;
}
.name {
  color: var(--ink-2);
}
.queued {
  color: var(--bad);
}

.limited {
  color: var(--bad) !important;
  border-color: var(--bad) !important;

  /* Animate.css */
  :global {
    animation: shakeX;
    animation-duration: 1s;
  }
}
</style>
