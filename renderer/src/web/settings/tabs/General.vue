<!-- 設定 › 一般:介面(語言、主題、強調色、字級)、背景(自訂背景圖,2026-10-01)與遊戲(遊戲、區服、客戶端語言、聯盟);最後一張卡是瀏覽器預覽。 -->
<template>
  <section class="card">
    <span class="label">{{ t('ppz.section_interface') }}</span>
    <div class="srow">
      <span class="k">{{ t('ppz.ui_language') }}</span>
      <div class="ctl">
        <div class="seg" data-setting="ui-language">
          <button v-for="l in languages" :key="l" :class="{ on: config.uiLanguage === l }" :data-value="l"
            @click="config.uiLanguage = l">{{ languageLabel(l) }}</button>
        </div>
      </div>
    </div>
    <div class="srow stack">
      <span class="k">{{ t('ppz.theme') }}</span>
      <div class="ctl themes" role="radiogroup" data-setting="theme">
        <button v-for="th in themes" :key="th" class="theme" :class="{ on: config.theme === th }" role="radio"
          :aria-checked="config.theme === th" :data-value="th" @click="config.theme = th">
          <span class="sw" :style="{ background: SWATCH[th][0] }">
            <span class="sw-panel" :style="{ background: SWATCH[th][1] }">
              <span class="sw-line" :style="{ background: SWATCH[th][2] }" />
              <span class="sw-line short" :style="{ background: SWATCH[th][3] }" />
            </span>
          </span>
          <span class="tname">{{ t(`ppz.theme_${th}`) }}</span>
        </button>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.accent') }}</span>
      <div class="ctl accents" data-setting="accent">
        <button class="dot auto" :class="{ on: !config.accent }" data-value="" @click="config.accent = ''">{{ t('ppz.accent_theme') }}</button>
        <button v-for="c in accents" :key="c" class="dot" :class="{ on: config.accent === c }"
          :style="{ background: c }" :title="c" :aria-label="c" :data-value="c" @click="config.accent = c" />
        <label class="dot custom" :class="{ on: isCustomAccent }" :title="t('ppz.accent_custom')">
          <input type="color" :value="config.accent || '#d8aa4b'" :aria-label="t('ppz.accent_custom')"
            @change="setCustomAccent">
        </label>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.font_size') }}</span>
      <div class="ctl" data-setting="font-size">
        <input v-model.number="config.fsBase" class="slider" type="range" :min="fsMin" :max="fsMax" step="1">
        <button class="btn ghost sm" :disabled="config.fsBase <= fsMin" @click="config.fsBase -= 1">−</button>
        <span class="num fs-val">{{ config.fsBase }}px</span>
        <button class="btn ghost sm" :disabled="config.fsBase >= fsMax" @click="config.fsBase += 1">+</button>
        <button class="btn ghost sm" :disabled="config.fsBase === fsDefault" @click="config.fsBase = fsDefault">{{ t('ppz.font_size_reset') }}</button>
      </div>
    </div>
    <!-- 第 21 步:設定視窗獨立字級(null = 跟隨上面的字級;只作用在設定視窗,查價面板不受影響) -->
    <div class="srow">
      <span class="k">{{ t('ppz.settings_window.font_size') }}</span>
      <div class="ctl" data-setting="settings-font-size">
        <input v-model.number="swFsSlider" class="slider" type="range" :min="swFsMin" :max="swFsMax" step="1"
          :class="{ follow: config.settingsFontSize == null }">
        <button class="btn ghost sm" :disabled="swFsSlider <= swFsMin" @click="swFsSlider -= 1">−</button>
        <span class="num fs-val sw-fs-val" data-setting="settings-font-size-value">{{ config.settingsFontSize == null ? t('ppz.settings_window.follow_value', { px: config.fsBase }) : `${config.settingsFontSize}px` }}</span>
        <button class="btn ghost sm" :disabled="swFsSlider >= swFsMax" @click="swFsSlider += 1">+</button>
        <button class="btn ghost sm" data-action="settings-font-follow" :disabled="config.settingsFontSize == null"
          @click="config.settingsFontSize = null">{{ t('ppz.settings_window.follow') }}</button>
      </div>
      <span class="note">{{ t('ppz.settings_window.font_hint') }}</span>
    </div>
    <div class="chk-row">
      <label class="chk"><input v-model="config.startupToast" type="checkbox" data-setting="startup-toast"><span>{{ t('ppz.startup_toast') }}</span></label>
    </div>
  </section>

  <!-- 自訂背景圖(2026-10-01):查價面板與設定視窗;檔案對話框選 png / jpg / webp(main bg-pick 複製到 userData/backgrounds) -->
  <section class="card" data-setting="background">
    <span class="label">{{ t('ppz.bg.section') }}</span>
    <div class="bg-row">
      <div class="bg-thumb" :class="{ empty: !bgThumb }" data-setting="bg-thumb"
        :style="bgThumb ? { backgroundImage: bgThumb, filter: `brightness(${config.bg.bright / 100}) blur(${config.bg.blur / 100 * 4}px)` } : undefined">
        <span v-if="!bgThumb">{{ t('ppz.bg.none') }}</span>
      </div>
      <div class="bg-actions">
        <div class="bg-file" data-setting="bg-file">{{ config.bg.file || t('ppz.bg.none') }}</div>
        <div class="ctl">
          <button v-if="canPickBg" class="btn sm primary" data-action="bg-pick" :disabled="bgBusy" @click="pickBg">{{ t('ppz.bg.pick') }}</button>
          <button class="btn sm" data-action="bg-clear" :disabled="!config.bg.file" @click="config.bg.file = ''">{{ t('ppz.bg.clear') }}</button>
        </div>
        <label class="chk"><input v-model="config.bg.enabled" type="checkbox" data-setting="bg-enabled"><span>{{ t('ppz.bg.enabled') }}</span></label>
      </div>
    </div>
    <p v-if="!canPickBg" class="preview-note" data-setting="bg-pick-unavailable">{{ t('ppz.bg.pick_unavailable') }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.bg.bright') }}</span>
      <div class="ctl" data-setting="bg-bright">
        <input v-model.number="config.bg.bright" class="slider" type="range" min="0" max="100" step="5">
        <span class="num fs-val">{{ config.bg.bright }}%</span>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.bg.panel_opacity') }}</span>
      <div class="ctl" data-setting="bg-panel-opacity">
        <input v-model.number="config.bg.panelOpacity" class="slider" type="range" min="0" max="100" step="5">
        <span class="num fs-val">{{ config.bg.panelOpacity }}%</span>
      </div>
    </div>
    <p class="preview-note" data-setting="bg-readability-hint">{{ t('ppz.bg.readability_hint') }}</p>
    <div class="srow">
      <span class="k">{{ t('ppz.bg.blur') }}</span>
      <div class="ctl" data-setting="bg-blur">
        <input v-model.number="config.bg.blur" class="slider" type="range" min="0" max="100" step="5">
        <span class="num fs-val">{{ config.bg.blur }}%</span>
      </div>
    </div>
    <!-- 第 26 步(2026-10-03):顯示位置與填滿方式,查價面板 / 設定視窗各一組(有圖才顯示;BgLayoutEditor.vue) -->
    <template v-if="bgUrl">
      <span class="sublabel">{{ t('ppz.bg.layout.section') }}</span>
      <div class="bg-layouts" data-setting="bg-layouts">
        <bg-layout-editor host="panel" :url="bgUrl" :bright="config.bg.bright" />
        <bg-layout-editor host="settings" :url="bgUrl" :bright="config.bg.bright" />
      </div>
      <p class="preview-note" data-setting="bg-layout-hint">{{ t('ppz.bg.layout.hint') }}</p>
    </template>
    <p class="preview-note">{{ t('ppz.bg.hint') }}</p>
    <p v-if="bgError" class="err" data-setting="bg-error">{{ bgError }}</p>
  </section>

  <section class="card">
    <span class="label">{{ t('ppz.section_game') }}</span>
    <div class="srow">
      <span class="k">{{ t('ppz.game') }}</span>
      <div class="ctl">
        <div class="seg" data-setting="game">
          <button v-for="g in games" :key="g.id" :class="{ on: config.game === g.id }" :data-value="g.id"
            :title="g.title" @click="config.game = g.id">{{ g.label }}</button>
        </div>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.realm') }}</span>
      <div class="ctl">
        <div class="seg" data-setting="realm">
          <button v-for="r in realms" :key="r" :class="{ on: config.realm === r }" :data-value="r"
            @click="config.realm = r">{{ r === 'intl' ? t('ppz.realm_intl') : t('ppz.realm_tw') }}</button>
        </div>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.language') }}</span>
      <div class="ctl">
        <div class="seg" data-setting="language">
          <button v-for="l in languages" :key="l" :class="{ on: config.language === l }" :data-value="l"
            @click="config.language = l">{{ languageLabel(l) }}</button>
        </div>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.league') }}</span>
      <div class="ctl">
        <select v-model="leagueId" class="select sm" :disabled="leagues.isLoading.value">
          <option v-if="leagues.isLoading.value" :value="leagueId">{{ t('ppz.league_loading') }}</option>
          <option v-for="l in leagues.list.value" :key="l.id" :value="l.id">{{ l.id }}</option>
        </select>
      </div>
      <span v-if="leagues.error.value" class="err">{{ t('ppz.league_failed', { error: leagues.error.value }) }}</span>
    </div>
    <div class="srow">
      <span />
      <div class="ctl">
        <button class="btn sm" @click="openCaptcha">{{ t('ppz.open_captcha') }}</button>
      </div>
    </div>
  </section>

  <section v-if="hasHost" class="card" data-setting="browser-preview">
    <span class="label">{{ t('ppz.preview.section') }}</span>
    <template v-if="isPreview">
      <p class="preview-note" data-preview="active">{{ t('ppz.preview.active') }}</p>
      <p v-if="needsRestart" class="preview-note warn" data-preview="needs-restart">{{ t('ppz.preview.needs_restart') }}</p>
    </template>
    <template v-else>
      <div class="srow">
        <span class="k">{{ t('ppz.preview.open') }}</span>
        <div class="ctl">
          <button class="btn sm" :disabled="previewBusy" data-action="open-preview" @click="openPreview">{{ t('ppz.preview.open') }}</button>
        </div>
      </div>
      <div v-if="previewUrl" class="srow stack">
        <div class="ctl preview-url">
          <input class="input sm" readonly :value="previewUrl" :aria-label="t('ppz.preview.url')" @focus="($event.target as HTMLInputElement).select()">
          <button class="btn ghost sm" data-action="copy-preview-url" @click="copyPreviewUrl">{{ copied ? t('ppz.preview.copied') : t('ppz.preview.copy') }}</button>
        </div>
      </div>
      <p class="preview-note">{{ t('ppz.preview.hint') }}</p>
      <p v-if="previewError" class="err">{{ t('ppz.preview.failed', { error: previewError }) }}</p>
    </template>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig, hotkeyRegistration } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import { useLeagues } from '@/web/background/Leagues'
import { REALMS, REALM_IDS, TRADE_PATHS, type Language } from '@exile-appraiser/core/realm'
import { ACCENTS, THEMES, FS_BASE_MIN, FS_BASE_MAX, DEFAULT_FS_BASE, bgImageUrl, normAccent, normBgFile, type Theme } from '@/web/useTheme'
import { SETTINGS_FS_MAX, SETTINGS_FS_MIN, normSettingsFontSize } from '../settings-window-geom'
import BgLayoutEditor from '../BgLayoutEditor.vue'

/** 主題縮圖:[底, 面板, 字, 強調](同 pob-zh-engine/ui/src/views/SettingsView.svelte 的 SWATCH)。 */
const SWATCH: Record<Theme, [string, string, string, string]> = {
  slate: ['#0e1116', '#192029', '#ece6d8', '#d8aa4b'],
  light: ['#f4f1ea', '#e4dfd4', '#1c1e23', '#946510'],
  contrast: ['#000000', '#1b1b1b', '#ffffff', '#ffc83d'],
  parchment: ['#1a140e', '#2a2117', '#efe2c4', '#e0a94a']
}

export default defineComponent({
  components: { BgLayoutEditor },
  setup () {
    const { t } = useI18n()
    const leagues = useLeagues()
    const config = AppConfig()

    // ---- 瀏覽器預覽(main 的 preview-server;docs/browser-preview.md) ----
    const previewUrl = shallowRef<string | null>(null)
    const previewBusy = shallowRef(false)
    const previewError = shallowRef<string | null>(null)
    const copied = shallowRef(false)
    onMounted(async () => {
      if (!Host.isElectron || Host.isPreview) return
      try { previewUrl.value = await Host.getPreviewUrl() } catch {}
    })

    // ---- 自訂背景圖 ----
    const bgBusy = shallowRef(false)
    const bgError = shallowRef<string | null>(null)
    const bgUrl = computed(() => bgImageUrl(config.bg.file, { electron: Host.isElectron, preview: Host.isPreview, baseURI: document.baseURI }))
    const bgThumb = computed(() => {
      const u = bgUrl.value
      return u ? `url("${u.replace(/["\\]/g, '\\$&')}")` : null
    })
    async function pickBg () {
      bgBusy.value = true
      bgError.value = null
      try {
        const name = normBgFile(await Host.bgPick())
        if (name) {
          config.bg.file = name
          config.bg.enabled = true
        }
      } catch (e) {
        bgError.value = e instanceof Error ? e.message : String(e)
      } finally {
        bgBusy.value = false
      }
    }
    return {
      canPickBg: Host.canPickBg,
      bgBusy,
      bgError,
      bgThumb,
      bgUrl,
      pickBg,
      t,
      leagues,
      config,
      SWATCH,
      realms: REALM_IDS,
      games: [
        { id: 'poe1' as const, label: 'PoE1', title: 'Path of Exile' },
        { id: 'poe2' as const, label: 'PoE2', title: 'Path of Exile 2' }
      ],
      languages: ['cmn-Hant', 'en'] as Language[],
      languageLabel: (l: Language) => l === 'cmn-Hant' ? '繁體中文' : 'English',
      themes: THEMES,
      accents: ACCENTS,
      fsMin: FS_BASE_MIN,
      fsMax: FS_BASE_MAX,
      fsDefault: DEFAULT_FS_BASE,
      swFsMin: SETTINGS_FS_MIN,
      swFsMax: SETTINGS_FS_MAX,
      /** 設定視窗字級滑桿:跟隨時停在全域字級;一動就變成獨立字級 */
      swFsSlider: computed({
        get: () => config.settingsFontSize ?? config.fsBase,
        set: (v: number) => { config.settingsFontSize = normSettingsFontSize(Number(v)) }
      }),
      isCustomAccent: computed(() => !!config.accent && !(ACCENTS as readonly string[]).includes(config.accent)),
      setCustomAccent (e: Event) {
        config.accent = normAccent((e.target as HTMLInputElement).value)
      },
      leagueId: computed<string | undefined>({
        get: () => leagues.selectedId.value,
        set: (id) => { leagues.selectedId.value = id }
      }),
      openCaptcha () {
        void Host.openCaptcha(`https://${REALMS[config.realm].host}${TRADE_PATHS[config.game].web}`)
      },
      hasHost: Host.isElectron,
      isPreview: Host.isPreview,
      needsRestart: computed(() => hotkeyRegistration.value?.needsRestart === true),
      previewUrl,
      previewBusy,
      previewError,
      copied,
      async openPreview () {
        previewBusy.value = true
        previewError.value = null
        try {
          const r = await Host.openPreview()
          if (r) previewUrl.value = r.url
        } catch (e) {
          previewError.value = e instanceof Error ? e.message : String(e)
        } finally {
          previewBusy.value = false
        }
      },
      async copyPreviewUrl () {
        if (!previewUrl.value) return
        try {
          await navigator.clipboard.writeText(previewUrl.value)
          copied.value = true
          setTimeout(() => { copied.value = false }, 1500)
        } catch (e) {
          previewError.value = e instanceof Error ? e.message : String(e)
        }
      }
    }
  }
})
</script>

<style>
.settings-panel .preview-note {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--fs-xs);
}
.settings-panel .preview-note.warn {
  color: var(--warn, var(--gold));
}
.settings-panel .preview-url {
  gap: 6px;
}
.settings-panel .preview-url input {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, Consolas, monospace;
  font-size: var(--fs-2xs);
}
.settings-panel .srow.stack {
  grid-template-columns: minmax(0, 1fr);
}
.settings-panel .themes {
  gap: 6px;
}
.settings-panel .theme {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 4px;
  border: 1px solid var(--edge-1);
  border-radius: var(--radius-m);
  background: var(--surface-2);
  color: var(--ink-1);
}
.settings-panel .theme:hover {
  background: var(--surface-hover);
}
.settings-panel .theme.on {
  border-color: var(--gold);
  box-shadow: 0 0 0 1px var(--gold);
  color: var(--ink-0);
}
.settings-panel .sw {
  display: flex;
  align-items: flex-end;
  width: 56px;
  height: 34px;
  padding: 5px 0 0 7px;
  border-radius: var(--radius-s);
  box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.35);
}
.settings-panel .sw-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  height: 100%;
  padding: 5px;
  border-radius: 3px 0 0 0;
}
.settings-panel .sw-line {
  display: block;
  height: 3px;
  width: 80%;
  border-radius: 2px;
}
.settings-panel .sw-line.short {
  width: 45%;
}
.settings-panel .tname {
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.settings-panel .accents {
  gap: 7px;
}
.settings-panel .dot {
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 50%;
  border: 2px solid var(--surface-1);
  box-shadow: 0 0 0 1px var(--edge-2);
  cursor: pointer;
}
.settings-panel .dot.on {
  box-shadow: 0 0 0 2px var(--ink-0);
}
.settings-panel .dot.auto {
  width: auto;
  min-width: 20px;
  height: auto; /* 字級大時(設定視窗獨立字級)文字不被 20px 高度切掉 */
  min-height: 20px;
  padding: 0 8px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--ink-1);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.settings-panel .dot.custom {
  position: relative;
  overflow: hidden;
  background: conic-gradient(#e0645a, #d8aa4b, #4fbf7a, #3fc1c9, #5b9dff, #a77bff, #e0645a);
}
.settings-panel .dot.custom input {
  position: absolute;
  inset: -8px;
  opacity: 0;
  cursor: pointer;
}
.settings-panel .slider {
  flex: 1;
  min-width: 60px;
  accent-color: var(--gold);
}
/* 自訂背景圖卡片 */
.settings-panel .bg-row {
  display: flex;
  gap: 10px;
  align-items: stretch;
  margin-bottom: 6px;
}
.settings-panel .bg-thumb {
  flex: 0 0 auto;
  width: 120px;
  height: 68px;
  border-radius: var(--radius-s);
  border: 1px solid var(--edge-1);
  background: center / cover no-repeat var(--surface-0-c);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.settings-panel .bg-thumb.empty {
  color: var(--ink-3);
  font-size: var(--fs-2xs);
}
.settings-panel .bg-actions {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
}
.settings-panel .bg-actions .ctl {
  gap: 6px;
}
.settings-panel .bg-file {
  font-size: var(--fs-xs);
  color: var(--ink-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-panel .sublabel {
  display: block;
  margin-top: 0.6em;
  font-size: var(--fs-xs);
  color: var(--ink-1);
  font-weight: 600;
}
.settings-panel .fs-val {
  min-width: 38px;
  text-align: center;
  font-size: var(--fs-xs);
}
.settings-panel .sw-fs-val {
  min-width: 5.5em;
  white-space: nowrap;
}
.settings-panel .slider.follow {
  opacity: 0.55;
}
</style>
