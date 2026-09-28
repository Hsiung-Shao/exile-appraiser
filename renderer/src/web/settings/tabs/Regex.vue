<!-- 設定 › 正則:Poe Regex 面板(WP5,renderer/src/web/regex/)。 -->
<template>
  <RegexPanel />
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import RegexPanel from '@/web/regex/RegexPanel.vue'

export default defineComponent({
  components: { RegexPanel }
})
</script>
