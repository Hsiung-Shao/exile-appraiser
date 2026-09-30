<!-- 設定 › 一般:介面(語言、主題、強調色、字級)與遊戲(遊戲、區服、客戶端語言、聯盟);最後一張卡是瀏覽器預覽。 -->
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
    <div class="chk-row">
      <label class="chk"><input v-model="config.startupToast" type="checkbox" data-setting="startup-toast"><span>{{ t('ppz.startup_toast') }}</span></label>
    </div>
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
import { ACCENTS, THEMES, FS_BASE_MIN, FS_BASE_MAX, DEFAULT_FS_BASE, normAccent, type Theme } from '@/web/useTheme'

/** 主題縮圖:[底, 面板, 字, 強調](同 pob-zh-engine/ui/src/views/SettingsView.svelte 的 SWATCH)。 */
const SWATCH: Record<Theme, [string, string, string, string]> = {
  slate: ['#0e1116', '#192029', '#ece6d8', '#d8aa4b'],
  light: ['#f4f1ea', '#e4dfd4', '#1c1e23', '#946510'],
  contrast: ['#000000', '#1b1b1b', '#ffffff', '#ffc83d'],
  parchment: ['#1a140e', '#2a2117', '#efe2c4', '#e0a94a']
}

export default defineComponent({
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
    return {
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
.settings-panel .fs-val {
  min-width: 38px;
  text-align: center;
  font-size: var(--fs-xs);
}
</style>
