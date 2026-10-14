/**
 * 429 Retry-After 倒數秒數(共用):原本在 App.vue(查價面板頂端 --warn 細條),2026-10-15 懸浮選單 A 版
 * 標題列的精簡限流點也要用 → 提升成全域狀態。行為與原本相同:`Host.rateLimitWait` 每次等待換新物件,
 * 收到就重設秒數並每秒減 1 到 0。
 */
import { shallowRef, watch, type Ref } from 'vue'
import { createGlobalState } from '@vueuse/core'
import { Host } from './IPC'

export const useRateLimitWait = createGlobalState((): Ref<number> => {
  const seconds = shallowRef(0)
  let timer: ReturnType<typeof setInterval> | null = null
  watch(Host.rateLimitWait, ({ seconds: s }) => {
    seconds.value = s
    if (timer) clearInterval(timer)
    timer = null
    if (s > 0) {
      timer = setInterval(() => {
        seconds.value = Math.max(0, seconds.value - 1)
        if (seconds.value === 0 && timer) { clearInterval(timer); timer = null }
      }, 1000)
    }
  })
  return seconds
})
