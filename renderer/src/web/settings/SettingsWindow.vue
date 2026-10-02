<!--
  設定視窗(取代 WP2 的查價側欄內細長面板):照 APT `SettingsWindow.vue` 的版面 + PobTools 配色。
  - 版面:標題列(「設定」+ 遊戲/區服徽章 + ✕)→ 左側選單(一般/查價/熱鍵與視窗/聊天指令/正則/拆粉排行/關於,active 用 --gold 左邊條,
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
  - 大小 / 位置(第 21 步,只在 floating):四邊 + 四角把手(.sw-rz)調整大小、標題列空白處移動(按鈕 / 輸入元件上不觸發);
    pointer events + setPointerCapture,拖曳中只改畫面,放開才寫 `config.settingsWindow`(settings-window-geom.ts
    `createRectDrag`);顯示時以 `clampSettingsRect` 夾進暗幕層(= overlay)範圍,暗幕層大小變了(換解析度 / DPI)自動夾回,
    不回寫設定。最小 480×360。標題列「還原大小」= 設回 null(置中預設)。
  - 獨立字級(第 21 步):`config.settingsFontSize`(null = 跟隨全域 fsBase)→ 根元素 inline `--fs-base` 與整組 `--fs-*`
    + class `fs-own`(font-size: var(--fs-md))。設定視窗內的尺寸幾乎都以 `--fs-*` / em 計(沒有 rem),所以只要在根元素
    重定義變數;查價面板在根元素外,完全不受影響。浮動預設大小改用 `--app-fs-base`(全域字級)= 字級改變不改視窗大小。
    視窗內有焦點時 Ctrl + 滾輪 / Ctrl + = / Ctrl + - / Ctrl + 0(跟隨)快速調整(preventDefault,不觸發 Electron 整頁縮放)。
    `provide(SETTINGS_FS_KEY)` 給虛擬捲動列高與 Teleport 出去的提示框 / 對話框(settings-fs.ts;變數 + `fs-own` class,
    共用控制項補高規則以 `:is(.settings-window, .rx-modal, .rx-tip).fs-own` 一併套到 Teleport 出去的對話框,code review 第 C 批)。
-->
<template>
  <div ref="rootEl" class="settings-panel settings-window bg-host"
    :class="{ floating, 'fs-own': fsVars != null, 'custom-rect': rect != null, dragging }" :style="rootStyle"
    role="dialog" aria-modal="true" tabindex="-1"
    aria-labelledby="settings-window-title" data-settings="window" @keydown="onFsKey" @wheel="onFsWheel">
    <!-- 自訂背景圖(設定 › 一般 › 背景;與查價面板同一張) -->
    <bg-layer host="settings" />
    <header class="sw-titlebar" :class="{ movable: floating }" :style="dragRegion ? '-webkit-app-region: drag;' : undefined"
      @pointerdown="onTitlePointerDown">
      <span id="settings-window-title" class="sw-title"><i class="mark" />{{ t('ppz.settings') }}</span>
      <span class="chip" data-badge="settings-game">{{ gameBadge }}</span>
      <span class="chip" data-badge="settings-realm">{{ realmBadge }}</span>
      <span class="grow" />
      <button v-if="floating && hasSavedRect" class="btn ghost sm icon-btn" :title="t('ppz.settings_window.reset_size')"
        :aria-label="t('ppz.settings_window.reset_size')" data-action="settings-reset-size" @click="resetRect">⟲</button>
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
    <!-- 調整大小把手(只在 overlay 浮動視窗) -->
    <template v-if="floating">
      <div v-for="e in edges" :key="e" class="sw-rz" :class="'rz-' + e" :data-resize="e" :style="{ cursor: cursorOf(e) }"
        @pointerdown="onResizePointerDown($event, e)" />
    </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, onMounted, provide, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import GeneralTab from './tabs/General.vue'
import PriceCheckTab from './tabs/PriceCheck.vue'
import HotkeysTab from './tabs/Hotkeys.vue'
import ChatTab from './tabs/Chat.vue'
import RegexTab from './tabs/Regex.vue'
import DustTab from './tabs/Dust.vue'
import AboutTab from './tabs/About.vue'
import { settingsTab as lastTab, type TabId } from './tabState'
import { Host } from '@/web/background/IPC'
import BgLayer from '../ui/BgLayer.vue'
import { AppConfig } from '@/web/Config'
import {
  RESIZE_EDGES, clampSettingsRect, createRectDrag, edgeCursor, effectiveSettingsFs, isInteractiveTarget,
  settingsFsClass, settingsFsShortcut, settingsFsVars, settingsFsWheel, stepSettingsFs,
  type DragEdge, type SettingsWindowRect, type Size
} from './settings-window-geom'
import { SETTINGS_FS_KEY } from './settings-fs'

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
      { id: 'chat', key: 'ppz.tab_chat' },
      { id: 'regex', key: 'ppz.tab_regex' },
      { id: 'dust', key: 'ppz.tab_dust' },
      { id: 'about', key: 'ppz.tab_about' }
    ]
    const components = {
      general: GeneralTab,
      'price-check': PriceCheckTab,
      hotkeys: HotkeysTab,
      chat: ChatTab,
      regex: RegexTab,
      dust: DustTab,
      about: AboutTab
    }
    const bodyEl = shallowRef<HTMLElement | null>(null)
    // 換分頁回到頂端(內容區是共用的捲動容器)
    watch(lastTab, () => { if (bodyEl.value) bodyEl.value.scrollTop = 0 })

    const config = AppConfig()
    const rootEl = shallowRef<HTMLElement | null>(null)

    // ---- 獨立字級 ----
    const fsVars = computed(() => settingsFsVars(config.settingsFontSize, config.fsBase))
    provide(SETTINGS_FS_KEY, {
      fs: computed(() => effectiveSettingsFs(config.settingsFontSize, config.fsBase) || 13),
      style: fsVars,
      cls: computed(() => settingsFsClass(fsVars.value))
    })
    function applyFs (action: 'inc' | 'dec' | 'reset') {
      const next = stepSettingsFs(config.settingsFontSize, config.fsBase, action)
      if (next !== config.settingsFontSize) {
        config.settingsFontSize = next
        console.log(`[settings] 設定視窗字級 → ${next ?? '跟隨全域'}`)
      }
    }
    function onFsKey (e: KeyboardEvent) {
      // 熱鍵擷取欄(HotkeyInput)會 preventDefault:使用者在錄 Ctrl + = 之類的組合時不搶
      if (e.defaultPrevented) return
      const action = settingsFsShortcut(e)
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      applyFs(action)
    }
    function onFsWheel (e: WheelEvent) {
      const action = settingsFsWheel(e)
      if (!action) return
      e.preventDefault()
      applyFs(action)
    }

    // ---- 大小 / 位置(只在 floating) ----
    /** 暗幕層(= overlay)的 CSS 大小;ResizeObserver 追蹤(視窗縮小、換解析度、切 DPI) */
    const view = shallowRef<Size | null>(null)
    const live = shallowRef<SettingsWindowRect | null>(null)
    const drag = createRectDrag((r) => {
      config.settingsWindow = r
      console.log(`[settings] 設定視窗大小 / 位置 → ${r.w}×${r.h} @ ${r.x},${r.y}`)
    }, (r) => { live.value = r })
    const dragging = computed(() => live.value != null)
    const rect = computed<SettingsWindowRect | null>(() => {
      if (!props.floating) return null
      if (live.value) return live.value
      const saved = config.settingsWindow
      if (!saved || !view.value) return null
      return clampSettingsRect(saved, view.value)
    })
    const rootStyle = computed((): Record<string, string> | undefined => {
      const r = rect.value
      if (!fsVars.value && !r) return undefined
      return {
        ...(fsVars.value ?? {}),
        ...(r ? { position: 'absolute', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` } : {})
      }
    })
    function layerOf (): HTMLElement | null {
      return rootEl.value?.parentElement ?? null
    }
    function measureView () {
      const p = layerOf()
      view.value = p ? { w: p.clientWidth, h: p.clientHeight } : null
    }
    let ro: ResizeObserver | null = null
    onMounted(() => {
      if (!props.floating) return
      measureView()
      const p = layerOf()
      if (p && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(measureView)
        ro.observe(p)
      }
    })
    /** 目前畫面上的矩形(相對暗幕層);從置中預設開始拖時用量的 */
    function currentRect (): SettingsWindowRect | null {
      const el = rootEl.value
      const p = layerOf()
      if (!el || !p) return null
      const a = el.getBoundingClientRect()
      const b = p.getBoundingClientRect()
      return { x: Math.round(a.left - b.left), y: Math.round(a.top - b.top), w: Math.round(a.width), h: Math.round(a.height) }
    }
    let detach: (() => void) | null = null
    function beginDrag (e: PointerEvent, edge: DragEdge) {
      if (!props.floating || e.button !== 0 || drag.active) return
      measureView()
      const start = currentRect()
      if (!start || !view.value) return
      e.preventDefault()
      const target = e.currentTarget as HTMLElement
      try { target.setPointerCapture(e.pointerId) } catch {}
      drag.start(edge, start, e.clientX, e.clientY, view.value)
      const onMove = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) drag.move(ev.clientX, ev.clientY) }
      const onUp = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; cleanup(); drag.end(ev.clientX, ev.clientY) }
      const onCancel = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; cleanup(); drag.cancel() }
      const onLost = () => { if (!drag.active) return; cleanup(); drag.end() }
      function cleanup () {
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
        target.removeEventListener('pointercancel', onCancel)
        target.removeEventListener('lostpointercapture', onLost)
        detach = null
        try { target.releasePointerCapture(e.pointerId) } catch {}
      }
      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
      target.addEventListener('pointercancel', onCancel)
      target.addEventListener('lostpointercapture', onLost)
      detach = () => { cleanup(); drag.cancel() }
    }
    onBeforeUnmount(() => { detach?.(); ro?.disconnect() })

    return {
      rootEl,
      fsVars,
      onFsKey,
      onFsWheel,
      rect,
      rootStyle,
      dragging,
      edges: RESIZE_EDGES,
      cursorOf: edgeCursor,
      hasSavedRect: computed(() => config.settingsWindow != null),
      resetRect () {
        config.settingsWindow = null
        console.log('[settings] 設定視窗大小 / 位置還原為預設')
      },
      onTitlePointerDown (e: PointerEvent) {
        if (!props.floating || isInteractiveTarget(e.target as Element | null)) return
        beginDrag(e, 'move')
      },
      onResizePointerDown (e: PointerEvent, edge: DragEdge) {
        beginDrag(e, edge)
      },
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
.settings-window:focus {
  outline: none;
}
/* 獨立字級(第 21 步):--fs-* 由 inline style 重定義;繼承字級的文字跟著變 */
.settings-window.fs-own {
  font-size: var(--fs-md);
}
/* 預設大小跟著「全域」字級(= 改版前),設定視窗字級改變不改視窗大小 */
.settings-window.floating.fs-own {
  width: min(calc(var(--app-fs-base) * 61.5), 92vw);
  height: min(calc(var(--app-fs-base) * 46.75), 88vh);
}
/* 徽章外觀預覽要呈現遊戲裡的實際大小(徽章跟全域字級),不跟設定視窗字級 */
.settings-window.fs-own .badge-preview {
  --fs-base: var(--app-fs-base);
  --fs-2xs: calc(var(--app-fs-base) - 3px);
  --fs-xs: calc(var(--app-fs-base) - 2px);
  --fs-sm: calc(var(--app-fs-base) - 1px);
  --fs-md: var(--app-fs-base);
  --fs-lg: calc(var(--app-fs-base) + 2px);
  --fs-xl: calc(var(--app-fs-base) + 7px);
  font-size: var(--fs-md);
}
/* 共用控制項(pobtools.css)的高度是固定 px:獨立字級放大時跟著長高,文字不被切掉;字級 ≤ 13 時維持原高度。
   Teleport 到 body 的 Regex 對話框 / 提示框(.rx-modal / .rx-tip,useSettingsFs().cls 給 fs-own)一併套用(code review 第 C 批) */
:is(.settings-window, .rx-modal, .rx-tip).fs-own :is(.btn, .input:not(textarea), .select) { height: max(26px, calc(var(--fs-base) + 13px)); }
:is(.settings-window, .rx-modal, .rx-tip).fs-own .btn.sm { height: max(22px, calc(var(--fs-base) + 9px)); }
:is(.settings-window, .rx-modal, .rx-tip).fs-own :is(.input.sm:not(textarea), .select.sm), :is(.settings-window, .rx-modal, .rx-tip).fs-own .seg button { height: max(24px, calc(var(--fs-base) + 11px)); }
.settings-window.dragging,
.settings-window.dragging * {
  user-select: none;
}
.sw-titlebar.movable {
  cursor: move;
}
.sw-titlebar.movable :is(button, input, select, a, label) {
  cursor: pointer;
}
/* 調整大小把手:貼著內緣(根元素 overflow: hidden),邊 6px、角 12px,疊在內容之上 */
.sw-rz {
  position: absolute;
  z-index: 30;
  touch-action: none;
}
.sw-rz.rz-n { top: 0; left: 12px; right: 12px; height: 6px; }
.sw-rz.rz-s { bottom: 0; left: 12px; right: 12px; height: 6px; }
.sw-rz.rz-w { left: 0; top: 12px; bottom: 12px; width: 6px; }
.sw-rz.rz-e { right: 0; top: 12px; bottom: 12px; width: 6px; }
.sw-rz.rz-nw { top: 0; left: 0; width: 12px; height: 12px; }
.sw-rz.rz-ne { top: 0; right: 0; width: 12px; height: 12px; }
.sw-rz.rz-sw { bottom: 0; left: 0; width: 12px; height: 12px; }
.sw-rz.rz-se { bottom: 0; right: 0; width: 12px; height: 12px; }

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
