<!--
  設定 › 自動辨識(只 PoE2;2026-11-18 設定重整:PoE1 的倉庫價格 OCR 搬到「倉庫」頁,這一頁在 PoE1 不出現在選單):
  - 共用:OcrSharedSection.vue(辨識語言、OCR 語言包狀態、隱私與 CPU 各一句;倉庫頁共用)。
  - 兩張辨識卡片(褻瀆詞綴 / 符文塑形)都是 OcrScanSection.vue(差異在 scan-card-specs.ts);暫停 / 框選熱鍵在「熱鍵」總表,頁頂「這頁的熱鍵」唯讀列出。
  - 徽章外觀:BadgeStyleSection.vue(符文價格顏色的門檻 `runeshapeThresholds`)。
  所有辨識都只在 overlay 模式 → 設定不是 overlay 時整頁只顯示 OverlayGate。設定鍵 / 行為不變。
-->
<template>
  <overlay-gate v-if="!config.overlayMode" />
  <template v-else>
    <page-hotkeys :ids="['ocr', 'region', 'runeshape', 'runeRegion']" />
    <ocr-shared-section />

    <!-- WP-S:靈魂之井褻瀆自動辨識 -->
    <ocr-scan-section v-if="config.game === 'poe2'" kind="reveal">
      <template #extra>
        <div class="chk-row">
          <label class="chk"><input v-model="config.revealShowAllCandidates" type="checkbox" data-setting="reveal-show-all"><span>{{ t('ppz.ocr.show_all_candidates') }}</span></label>
          <help-tip id="reveal-show-all" :text="t('ppz.ocr.show_all_candidates_hint')" />
        </div>
      </template>
    </ocr-scan-section>

    <!-- WP-R2:符文塑形面板自動查價 -->
    <ocr-scan-section v-if="config.game === 'poe2'" kind="runeshape">
      <template #top>
        <p v-if="config.realm === 'tw'" class="foot warn" data-setting="runeshape-tw">{{ t('ppz.runeshape.tw_no_source') }}</p>
      </template>
    </ocr-scan-section>

    <!-- 第 11 步:OCR 徽章外觀(符文與褻瀆共用;第 39 步起符文價格門檻也在這張) -->
    <badge-style-section />
  </template>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '@/web/Config'
import OcrScanSection from '../OcrScanSection.vue'
import OcrSharedSection from '../OcrSharedSection.vue'
import BadgeStyleSection from '../BadgeStyleSection.vue'
import HelpTip from '../HelpTip.vue'
import OverlayGate from '../OverlayGate.vue'
import PageHotkeys from '../PageHotkeys.vue'

export default defineComponent({
  components: { OcrScanSection, OcrSharedSection, BadgeStyleSection, HelpTip, OverlayGate, PageHotkeys },
  setup () {
    return { t: useI18n().t, config: AppConfig() }
  }
})
</script>
