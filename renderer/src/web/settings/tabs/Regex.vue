<!--
  設定 › 正則:Poe Regex 面板(WP5,renderer/src/web/regex/)+ 書籤快捷存取(第 33 步;第 39 步從「熱鍵與視窗」搬來)。
  快捷存取卡片:設定視窗旁的書籤列開關(兩種模式都有:overlay 浮在設定視窗旁、window 模式排在內容區)與快速面板熱鍵(唯讀,
  在「熱鍵」總表編輯;熱鍵只在 overlay 模式註冊 → 不是 overlay 時不列)。個別書籤的熱鍵在書籤列表(RegexBookmarks.vue)。
-->
<template>
  <RegexPanel />
  <section class="card" data-setting="regex-quick">
    <div class="card-head">
      <span class="label">{{ t('ppz.regex.quick_section') }}</span>
      <help-tip id="regex-quick" :text="t('ppz.regex.quick_section_hint')" />
    </div>
    <div class="chk-row">
      <label class="chk"><input v-model="config.regexBookmarkBar" type="checkbox" data-setting="regex-bookmark-bar"><span>{{ t('ppz.regex.quick_bar_toggle') }}</span></label>
    </div>
    <div v-if="config.overlayMode" class="srow">
      <span class="k">{{ t('ppz.regex.quick_hotkey') }}</span>
      <div class="ctl">
        <button class="hk-ref" data-goto="hotkeys" data-setting="regex-quick-hotkey-ref" @click="gotoHotkeys">
          <span class="hk-ref-key num" :class="{ unset: !config.hotkeyRegexQuick }">{{ config.hotkeyRegexQuick || t('ppz.hk.unset') }}</span>
          <span class="hk-ref-text">{{ t('ppz.hk.edit_in', { page: t('ppz.tab_hotkeys') }) }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import RegexPanel from '@/web/regex/RegexPanel.vue'
import { AppConfig } from '@/web/Config'
import HelpTip from '../HelpTip.vue'
import { settingsTab } from '../tabState'

export default defineComponent({
  components: { RegexPanel, HelpTip },
  setup () {
    const { t } = useI18n()
    return {
      t,
      config: AppConfig(),
      gotoHotkeys () { settingsTab.value = 'hotkeys' }
    }
  }
})
</script>
