<!--
  exile-appraiser(2026-10-01):自訂背景圖層。放在 `.bg-host` 容器(查價面板 #price-window、設定視窗)的第一個子元素;
  沒有背景(<html> 沒有 data-bg)時 display: none。樣式在 theme/pobtools.css(.bgimg 圖 + 亮度 / 霧面、.bgtint 面板底色 × 面板不透明度),
  兩層都是 position: absolute; inset: 0; z-index: -1,容器以 isolation: isolate 自成堆疊,所以只畫在容器裡、內容永遠在圖上面;
  overlay 的其他區域(透明全螢幕視窗)不受影響。
-->
<template>
  <div class="bgimg" aria-hidden="true" data-bg-layer="image" />
  <div class="bgtint" aria-hidden="true" data-bg-layer="tint" />
</template>

<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({})
</script>
