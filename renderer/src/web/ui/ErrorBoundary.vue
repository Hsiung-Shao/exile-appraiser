<!--
  查價面板的錯誤邊界(2026-10-03):子元件在 setup / 渲染 / watch / 生命週期拋錯時,Vue 只會把那個元件畫成空註解,
  面板就剩標題列與背景圖、使用者看不出原因。這裡攔下(onErrorCaptured,回傳 false 不再往上傳)→ 寫進 main log
  (renderer-errors.ts,含堆疊與元件路徑)→ 改畫錯誤框 + 重試。正常情況只原樣畫出 slot,不多包任何元素,外觀不變。
  只是事件處理(點按鈕、懸停)拋錯:只記 log,不換成錯誤框(面板其他部分照常可用)。
  換物品(`resetKey` 變了)自動清掉錯誤。
-->
<script lang="ts">
import { defineComponent, h, onErrorCaptured, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiErrorBox from './UiErrorBox.vue'
import { componentPath, isEventHandlerError, logRendererError } from '../renderer-errors'

export default defineComponent({
  name: 'ErrorBoundary',
  props: {
    /** 換了就清掉錯誤重畫(App.vue 傳 itemKey) */
    resetKey: { type: [String, Number], default: 0 },
    /** log 裡的位置名稱 */
    where: { type: String, default: 'panel' }
  },
  setup (props, { slots }) {
    const { t } = useI18n()
    const error = shallowRef<string | null>(null)

    watch(() => props.resetKey, () => { error.value = null })

    onErrorCaptured((err, instance, info) => {
      logRendererError(err, `${props.where} ${componentPath(instance)}`, info)
      // 同一輪常連鎖好幾個錯誤(第一個讓資料變 undefined,後面的元件跟著拋):畫面只顯示第一個(根因),log 全記
      if (!isEventHandlerError(info) && error.value == null) {
        error.value = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      }
      return false
    })

    return () => {
      const message = error.value
      if (message == null) return slots.default?.()
      return h(UiErrorBox, { class: 'm-3', 'data-error': 'component' }, {
        name: () => t('ppz.panel_error'),
        default: () => [
          h('p', { class: 'selectable' }, message),
          h('p', { class: 'text-gray-500' }, t('ppz.panel_error_hint'))
        ],
        actions: () => h('button', { class: 'btn sm', 'data-action': 'retry-panel', onClick: () => { error.value = null } }, t('Retry'))
      })
    }
  }
})
</script>
