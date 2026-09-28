<template>
  <component :is="tagName" ref="target" v-bind="$attrs">
    <slot name="target" />
  </component>
  <div ref="content">
    <slot name="content" />
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, onBeforeUnmount, ref, PropType } from 'vue'
import tippy, { Instance, Placement } from 'tippy.js'
import 'tippy.js/dist/tippy.css'
import 'tippy.js/themes/light.css'

// exile-appraiser: 全 app 的 tippy(含 poe2 的 Popover.vue、TradeItem 物品提示)共用同一份 tippy.js,
// 這裡設預設:popper 掛 .pob-dark(pobtools.css 的「深色島」)→ 淺色主題下提示框仍是深色、遊戲配色讀得清。
tippy.setDefaultProps({
  onCreate (instance) {
    instance.popper.classList.add('pob-dark')
  }
})

export default defineComponent({
  name: 'UiPopover',
  inheritAttrs: false,
  props: {
    trigger: {
      type: String,
      default: undefined
    },
    boundary: {
      type: String,
      default: undefined
    },
    placement: {
      type: String as PropType<Placement>,
      default: undefined
    },
    arrow: {
      type: Boolean,
      default: true
    },
    delay: {
      type: [Array, Number] as PropType<number | [number | null, number | null]>,
      default: 0
    },
    tagName: {
      type: String,
      default: 'span'
    }
  },
  setup (props) {
    const target = ref<HTMLElement>(null!)
    const content = ref<HTMLElement>(null!)
    let instance: Instance

    onMounted(() => {
      instance = tippy(target.value, {
        content: content.value,
        interactive: true,
        theme: 'light',
        trigger: props.trigger,
        placement: props.placement,
        arrow: props.arrow,
        delay: props.delay,
        maxWidth: 'none',
        popperOptions: {
          modifiers: [
            ...(props.boundary
              ? [{
                  name: 'preventOverflow',
                  options: {
                    boundary: document.querySelector(props.boundary)
                  }
                }]
              : [])
          ]
        }
      })
    })

    onBeforeUnmount(() => {
      instance.destroy()
    })

    return {
      target,
      content
    }
  }
})
</script>

<style lang="postcss">
.tippy-box {
  @apply rounded;
}

/* exile-appraiser: tippy 'light' 主題原本是白底,改成主題 token 的提示框(popper 在 .pob-dark 內,永遠深色) */
.tippy-box[data-theme~='light'] {
  background-color: var(--surface-2-c);
  color: var(--ink-0);
  border: 1px solid var(--edge-1);
  box-shadow: var(--shadow-float);
}
.tippy-box[data-theme~='light'][data-placement^='top'] > .tippy-arrow::before { border-top-color: var(--surface-2-c); }
.tippy-box[data-theme~='light'][data-placement^='bottom'] > .tippy-arrow::before { border-bottom-color: var(--surface-2-c); }
.tippy-box[data-theme~='light'][data-placement^='left'] > .tippy-arrow::before { border-left-color: var(--surface-2-c); }
.tippy-box[data-theme~='light'][data-placement^='right'] > .tippy-arrow::before { border-right-color: var(--surface-2-c); }

.tippy-content {
  @apply p-1;
}
</style>
