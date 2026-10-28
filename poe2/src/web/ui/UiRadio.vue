<template>
  <button @click="updateInput" :class="$style['radio']">
    <template v-if="!useBgSelection">
      <i v-if="!isChecked" class="far fa-circle"></i>
      <i v-else class="fas fa-check-circle"></i>
      <slot />
    </template>
    <template v-else>
      <div
        class="rounded-sm px-1 py-0.5"
        :class="{
          'bg-gray-700': isChecked,
        }"
      >
        <slot />
      </div>
    </template>
  </button>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";

export default defineComponent({
  name: "UiRadio",
  emits: ["update:modelValue"],
  props: {
    value: {
      type: null,
      required: true,
    },
    modelValue: {
      type: null,
      required: true,
    },
    useBgSelection: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, ctx) {
    return {
      isChecked: computed(() => {
        return props.modelValue === props.value;
      }),
      updateInput() {
        ctx.emit("update:modelValue", props.value);
      },
    };
  },
});
</script>

<style lang="postcss" module>
@reference "../../../../renderer/src/theme/tailwind.css"; /* exile-appraiser: Tailwind 4 升級(2026-10-24),讓 @apply / theme() 認得 utility */
.radio {
  display: flex;
  @apply gap-x-1;
  align-items: baseline;
  text-align: left;
}
</style>
