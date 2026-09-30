<!--
  設定視窗(取代 WP2 的查價側欄內細長面板):照 APT `SettingsWindow.vue` 的版面 + PobTools 配色。
  - 版面:標題列(「設定」+ 遊戲/區服徽章 + ✕)→ 左側選單(一般/查價/熱鍵與視窗/正則/拆粉排行/關於,active 用 --gold 左邊條,
    底部「結束程式」)+ 右側可捲動內容。容器寬 < 640px(container query)時左選單收成上方分頁。
  - 拆粉排行分頁(tabs/Dust.vue,2026-09-30 起;原本停靠在查價下方):內容區加 .fill = 不捲動、子元素撐滿,
    表格自己虛擬捲動。查價標題列的 ⚖ 直接開到這一頁。
  - `floating`(overlay):App.vue 把它放在全螢幕暗幕中央,寬 min(50rem, 92vw)、高 min(38rem, 88vh),
    rem 以 APT 的 16px 換算成 --fs-base × 1.23(同 App.vue 的 LEGACY_FS_SCALE),隨字級縮放。
    非 floating(window 模式 / 瀏覽器預覽):填滿視窗內容區;window 模式標題列可拖曳視窗。
  - 即時套用(Config.ts 監看 AppConfig 直接存檔),沒有儲存 / 取消。
  - 根元素保留 `.settings-panel`:各分頁的 unscoped 選擇器(`.settings-panel .xxx`)與關於頁授權 modal
    (position:absolute; inset:0)都以它為範圍 / 定位。列版面 `.srow` 等也定義在本檔。
  - 「結束程式」走 IPC `app-quit`(`preview: false`;瀏覽器預覽 / 純瀏覽器不顯示)。
  - 分頁狀態在 ./tabState.ts(托盤「設定」「關於」、OCR 框選返回直接指定分頁)。
  - 自訂背景圖(2026-10-01):根元素加 `.bg-host`、第一個子元素 BgLayer.vue(圖只畫在視窗裡;pobtools.css「自訂背景圖」)。
-->
<template>
  <div class="settings-panel settings-window bg-host" :class="{ floating }" role="dialog" aria-modal="true"
    aria-labelledby="settings-window-title" data-settings="window">
    <!-- 自訂背景圖(設定 › 一般 › 背景;與查價面板同一張) -->
    <bg-layer />
    <header class="sw-titlebar" :style="dragRegion ? '-webkit-app-region: drag;' : undefined">
      <span id="settings-window-title" class="sw-title"><i class="mark" />{{ t('ppz.settings') }}</span>
      <span class="chip" data-badge="settings-game">{{ gameBadge }}</span>
      <span class="chip" data-badge="settings-realm">{{ realmBadge }}</span>
      <span class="grow" />
      <button class="btn ghost sm icon-btn" :title="t('ppz.close')" :aria-label="t('ppz.close')"
        style="-webkit-app-region: no-drag;" data-action="settings-close" @click="$emit('close')">✕</button>
    </header>
    <slot name="strips" />
    <div class="sw-main">
      <nav class="sw-nav" role="tablist">
        <button v-for="tb in tabs" :key="tb.id" class="sw-nav-item" :class="{ on: tab === tb.id }" role="tab"
          :aria-selected="tab === tb.id" :data-tab="tb.id" @click="tab = tb.id">{{ t(tb.key) }}</button>
        <span class="sw-nav-fill" />
        <button v-if="canQuit" class="sw-quit" data-action="app-quit" @click="quit">{{ t('ppz.quit_app') }}</button>
      </nav>
      <div ref="bodyEl" class="settings-body" :class="{ fill: tab === 'dust' }" role="tabpanel" :data-settings-tab="tab">
        <component :is="tabComponent" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import GeneralTab from './tabs/General.vue'
import PriceCheckTab from './tabs/PriceCheck.vue'
import HotkeysTab from './tabs/Hotkeys.vue'
import RegexTab from './tabs/Regex.vue'
import DustTab from './tabs/Dust.vue'
import AboutTab from './tabs/About.vue'
import { settingsTab as lastTab, type TabId } from './tabState'
import { Host } from '@/web/background/IPC'
import BgLayer from '../ui/BgLayer.vue'

export default defineComponent({
  components: { BgLayer },
  props: {
    /** overlay:置中浮動(App.vue 提供暗幕);否則填滿內容區 */
    floating: { type: Boolean, default: false },
    gameBadge: { type: String, required: true },
    realmBadge: { type: String, required: true }
  },
  emits: ['close'],
  setup (props) {
    const { t } = useI18n()
    const tabs: Array<{ id: TabId, key: string }> = [
      { id: 'general', key: 'ppz.tab_general' },
      { id: 'price-check', key: 'ppz.tab_price_check' },
      { id: 'hotkeys', key: 'ppz.tab_hotkeys' },
      { id: 'regex', key: 'ppz.tab_regex' },
      { id: 'dust', key: 'ppz.tab_dust' },
      { id: 'about', key: 'ppz.tab_about' }
    ]
    const components = {
      general: GeneralTab,
      'price-check': PriceCheckTab,
      hotkeys: HotkeysTab,
      regex: RegexTab,
      dust: DustTab,
      about: AboutTab
    }
    const bodyEl = shallowRef<HTMLElement | null>(null)
    // 換分頁回到頂端(內容區是共用的捲動容器)
    watch(lastTab, () => { if (bodyEl.value) bodyEl.value.scrollTop = 0 })
    return {
      t,
      tabs,
      tab: lastTab,
      bodyEl,
      tabComponent: computed(() => components[lastTab.value]),
      /** window 模式(Electron、非預覽)的標題列可拖曳視窗 */
      dragRegion: computed(() => !props.floating && Host.isElectron && !Host.isPreview),
      canQuit: Host.canQuit,
      quit () {
        console.log('[settings] 結束程式')
        void Host.appQuit()
      }
    }
  }
})
</script>

<style>
/* ---- 視窗外框 ---- */
.settings-window {
  position: relative; /* 關於頁授權 modal 蓋在視窗內 */
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--surface-0);
  container-type: inline-size;
  container-name: settings-window;
}
.settings-window.floating {
  /* APT:max-width 50rem、max-height 38rem(rem = 16px);這裡以 --fs-base × 1.23 當 rem,隨字級縮放 */
  width: min(calc(var(--fs-base) * 61.5), 92vw);
  height: min(calc(var(--fs-base) * 46.75), 88vh);
  border: 1px solid var(--edge-1);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-float);
  overflow: hidden;
  pointer-events: auto;
}

/* 標題列(與查價面板 .titlebar 同高同語彙) */
.sw-titlebar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: calc(var(--fs-base) + 21px);
  padding: 0 6px 0 12px;
  background: var(--surface-1);
  border-bottom: 1px solid var(--edge-0);
  user-select: none;
}
.sw-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 600;
  letter-spacing: 0.05em;
  white-space: nowrap;
  margin-right: 4px;
}
.sw-title .mark {
  width: 10px;
  height: 10px;
  background: var(--gold);
  transform: rotate(45deg);
  border-radius: 2px;
  flex-shrink: 0;
}
.sw-titlebar .grow {
  flex: 1;
}
.sw-titlebar .icon-btn {
  width: 24px;
  padding: 0;
  justify-content: center;
  color: var(--ink-1);
  font-size: var(--fs-md);
  line-height: 1;
}
.sw-titlebar .icon-btn:hover:not(:disabled) {
  color: var(--ink-0);
}

/* 左選單 + 右內容 */
.sw-main {
  flex: 1;
  min-height: 0;
  display: flex;
}
.sw-nav {
  flex: 0 0 auto;
  width: calc(var(--fs-base) * 12.3); /* APT min-width 10rem */
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 0;
  background: var(--surface-1);
  border-right: 1px solid var(--edge-0);
  overflow-y: auto;
}
.sw-nav-item {
  appearance: none;
  border: 0;
  border-left: 3px solid transparent;
  background: none;
  padding: 7px 12px 7px 13px;
  text-align: left;
  color: var(--ink-2);
  font-size: var(--fs-sm);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.sw-nav-item:hover {
  color: var(--ink-0);
  background: var(--surface-hover);
}
.sw-nav-item.on {
  color: var(--ink-0);
  border-left-color: var(--gold);
  background: var(--gold-soft);
}
.sw-nav-item:focus-visible,
.sw-quit:focus-visible {
  outline: 1px solid var(--gold);
  outline-offset: -1px;
}
.sw-nav-fill {
  flex: 1;
}
.sw-quit {
  appearance: none;
  border: 0;
  border-top: 1px solid var(--edge-0);
  background: none;
  margin: 6px 0 -8px;
  padding: 9px 12px 9px 16px;
  text-align: left;
  color: var(--ink-2);
  font-size: var(--fs-xs);
  white-space: nowrap;
  cursor: pointer;
}
.sw-quit:hover {
  color: var(--bad);
  background: color-mix(in srgb, var(--bad) 10%, transparent);
}
.settings-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 拆粉排行:內容區不捲動,子元素(DustPanel)撐滿,表格自己虛擬捲動 */
.settings-body.fill {
  overflow: hidden;
}

/* 窄(< 640px):左選單收成上方分頁,結束程式放在分頁列最右 */
@container settings-window (max-width: 639px) {
  .sw-main {
    flex-direction: column;
  }
  .sw-nav {
    width: auto;
    flex-direction: row;
    align-items: stretch;
    gap: 2px;
    padding: 0 8px;
    border-right: 0;
    border-bottom: 1px solid var(--edge-0);
    overflow-x: auto;
    overflow-y: hidden;
  }
  .sw-nav-item {
    flex-shrink: 0;
    border-left: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    padding: 6px 10px 5px;
    overflow: visible;
  }
  .sw-nav-item:hover {
    background: none;
  }
  .sw-nav-item.on {
    border-bottom-color: var(--gold);
    background: none;
  }
  .sw-quit {
    flex-shrink: 0;
    border-top: 0;
    margin: 0;
    padding: 6px 4px 5px 10px;
  }
  .settings-body {
    padding: 10px 10px 16px;
  }
  .settings-body.fill {
    padding: 6px;
  }
}

/* ---- 列版面(各分頁共用;unscoped,限 .settings-panel 內) ----
   一列:左標籤(固定欄寬)、右控制項延展;窄容器下標籤欄改成約三分之一 */
.settings-panel .srow {
  display: grid;
  grid-template-columns: calc(var(--fs-base) * 12.3) minmax(0, 1fr);
  align-items: center;
  gap: 4px 14px;
  min-height: 30px;
  padding: 2px 0;
}
@container settings-window (max-width: 639px) {
  .settings-panel .srow {
    grid-template-columns: minmax(80px, 34%) minmax(0, 1fr);
    gap: 4px 12px;
  }
}
.settings-panel .srow > .k {
  font-size: var(--fs-xs);
  color: var(--ink-2);
}
.settings-panel .srow > .ctl {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.settings-panel .srow > .ctl > .input,
.settings-panel .srow > .ctl > .select {
  flex: 1;
  min-width: 0;
  max-width: calc(var(--fs-base) * 30);
}
.settings-panel .srow > .note {
  grid-column: 2;
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.settings-panel .srow > .err {
  grid-column: 1 / -1;
  font-size: var(--fs-xs);
  color: var(--bad);
}
.settings-panel .chk-row {
  display: flex;
  min-height: 28px;
  align-items: center;
}
.settings-panel .foot {
  margin-top: 6px;
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.settings-panel .placeholder {
  color: var(--ink-3);
  font-size: var(--fs-sm);
}
</style>
