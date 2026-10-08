<!--
  就地回報按鈕(2026-10-08,renderer/src/web/report-inline.ts)。移植的 poe1 / poe2 元件以 `@/web/ui/ReportInline.vue` 使用:
  - mode="summary":未解析詞綴清單上方的物品層級提示(條數 + 金色「回報問題」)
  - mode="mod":單條未解析詞綴旁的「回報這條」
  - mode="trade":查價錯誤框 actions 裡的「回報問題」
  沒有 provide(REPORT_INLINE_KEY)時整個不畫(CLI / 測試 / 其他宿主)。
-->
<template>
  <template v-if="reporter">
    <div v-if="mode === 'summary'" class="report-summary" data-report="summary">
      <svg class="report-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3z" /><path d="M12 10v5" /><path d="M12 18h.01" /></svg>
      <div class="report-summary-text">
        <div>{{ t('ppz.report.unknown_summary', { n: count ?? 0 }) }}</div>
        <div class="report-sub">{{ t('ppz.report.unknown_sub') }}</div>
      </div>
      <button type="button" class="btn sm primary" data-action="report-unknown-all" @click.prevent="report('item')">{{ t('ppz.report.problem') }} ↗</button>
    </div>
    <button v-else-if="mode === 'mod'" type="button" class="report-mod-btn" data-action="report-unknown-mod"
      @click.prevent="report('mod')">{{ t('ppz.report.this_mod') }} ↗</button>
    <button v-else type="button" class="btn report-trade-btn" data-action="report-trade-error"
      @click.prevent="report('trade')">{{ t('ppz.report.problem') }} ↗</button>
  </template>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { REPORT_INLINE_KEY } from '../report-inline'

const props = defineProps<{
  mode: 'summary' | 'mod' | 'trade'
  detail?: string
  count?: number
}>()

const reporter = inject(REPORT_INLINE_KEY, null)
const { t } = useI18n()

function report (kind: 'item' | 'mod' | 'trade') {
  reporter?.report(kind, props.detail)
}
</script>

<!-- 移植的 UnknownModifier 根元素加 class ppz-unknown-mod(2026-10-08 使用者回報「自貼邊沒有間隔」):左右留白 + 淡黃底,與上方提示框同語彙 -->
<style>
.ppz-unknown-mod {
  padding-left: 0.6em;
  padding-right: 0.6em;
  background: color-mix(in srgb, var(--warn) 7%, transparent);
}
</style>

<style scoped>
.report-summary {
  display: flex;
  align-items: center;
  gap: 0.6em;
  margin: 0.6em 0 0.75em;
  padding: 0.6em 0.75em;
  border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
  border-radius: var(--radius-m);
  background: color-mix(in srgb, var(--warn) 12%, var(--surface-1));
  color: var(--ink-0);
  font-size: var(--fs-sm);
  line-height: 1.4;
}
.report-icon {
  width: 1.2em;
  height: 1.2em;
  flex-shrink: 0;
  fill: none;
  stroke: var(--warn);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.report-summary-text {
  flex: 1;
  min-width: 0;
}
.report-sub {
  color: var(--ink-1);
  font-size: var(--fs-xs);
}
.report-mod-btn {
  font: inherit;
  font-size: var(--fs-xs);
  line-height: 1.2;
  color: var(--warn);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--warn) 55%, transparent);
  border-radius: var(--radius-s);
  padding: 0.2em 0.6em;
  cursor: pointer;
  white-space: nowrap;
}
.report-mod-btn:hover {
  background: color-mix(in srgb, var(--warn) 14%, transparent);
}
.report-trade-btn {
  color: var(--bad);
  border-color: color-mix(in srgb, var(--bad) 55%, transparent);
}
</style>
