<!--
  設定 › 啟動與更新(2026-11-18 設定重整:原本分在「一般」(啟動、瀏覽器預覽)與「更新與關於」(更新、設定資料夾)):
  - 更新:狀態(main/src/AppUpdater.ts 經 Host.getUpdaterInfo / onUpdaterState)、檢查 / 下載 / 安裝、自動更新(免安裝版不顯示)、新版提醒(第 34 步)。
    更新字串沿用上游 `updates.*`,上游沒有的放 `ppz.update.*`。
  - 啟動:啟動提示、硬體加速(第五輪 30.5,改了要重新啟動)、建立桌面捷徑(2026-11-16)。
  - 檔案與預覽:開啟設定資料夾、瀏覽器預覽(main 的 preview-server;docs/browser-preview.md)。
-->
<template>
  <!-- 2026-11-18 照設計稿 P04-Startup:標題列右邊放狀態 + 目前版本;每列「名稱 + 一句說明 | 開關 / 按鈕」 -->
  <section class="card" data-about="update">
    <div class="card-head">
      <span class="label">{{ t('ppz.about.section_update') }}</span>
      <span class="grow" />
      <span class="update-status" :class="updateTone" :data-update-state="info?.state" :title="updateText"><span class="dot" aria-hidden="true" />{{ updateText }}</span>
      <span class="update-ver num" data-about="current-version" :title="t('ppz.update.current', { version })">{{ versionText }}</span>
    </div>
    <div v-if="info?.reason !== 'not-supported'" class="srow">
      <span class="k">{{ t('ppz.update.auto') }}<help-tip id="auto-update" data-about="auto-update-hint" :text="t('ppz.update.auto_hint')" /><small class="k-sub">{{ t('ppz.update.auto_sub') }}</small></span>
      <div class="ctl">
        <label class="scan-switch" :title="t('ppz.update.auto')"><input v-model="config.autoUpdate" type="checkbox" role="switch" :aria-checked="config.autoUpdate" :aria-label="t('ppz.update.auto')" data-setting="auto-update"><span class="scan-switch-track" aria-hidden="true"><span class="scan-switch-knob" /></span></label>
      </div>
    </div>
    <!-- 第 34 步:有新版本時每 10 分鐘在右下角提醒(main/src/update-reminder.ts) -->
    <div class="srow">
      <span class="k">{{ t('ppz.update.reminder') }}<help-tip id="update-reminder" data-about="update-reminder-hint" :text="t('ppz.update.reminder_hint')" /><small class="k-sub">{{ t('ppz.update.reminder_sub') }}</small></span>
      <div class="ctl">
        <label class="scan-switch" :title="t('ppz.update.reminder')"><input v-model="config.updateReminder" type="checkbox" role="switch" :aria-checked="config.updateReminder" :aria-label="t('ppz.update.reminder')" data-setting="update-reminder"><span class="scan-switch-track" aria-hidden="true"><span class="scan-switch-knob" /></span></label>
      </div>
    </div>
    <div class="srow">
      <span class="k">{{ t('ppz.update.manual') }}</span>
      <div class="ctl">
        <button class="btn sm" data-action="update-check" :disabled="!canCheck" @click="check">{{ t('ppz.update.check') }}</button>
        <button v-if="showDownload" class="btn sm primary" data-action="update-download" @click="download">{{ t('ppz.update.download') }}</button>
        <button v-if="showReleases" class="btn sm" data-action="update-releases" @click="open(releasesUrl)">{{ t('ppz.update.releases') }} ↗</button>
        <button v-if="info?.state === 'downloaded'" class="btn sm primary" data-action="update-install" @click="install">{{ autoApply ? t('ppz.update.restart_now') : t('ppz.update.restart_install') }}</button>
        <span v-if="lastChecked" class="update-meta">{{ lastChecked }}</span>
      </div>
    </div>
  </section>

  <section class="card" data-setting="startup">
    <div class="card-head"><span class="label">{{ t('ppz.section_startup') }}</span></div>
    <div class="srow">
      <span class="k">{{ t('ppz.startup_toast') }}</span>
      <div class="ctl">
        <label class="scan-switch" :title="t('ppz.startup_toast')"><input v-model="config.startupToast" type="checkbox" role="switch" :aria-checked="config.startupToast" :aria-label="t('ppz.startup_toast')" data-setting="startup-toast"><span class="scan-switch-track" aria-hidden="true"><span class="scan-switch-knob" /></span></label>
      </div>
    </div>
    <!-- 第五輪 30.5:硬體加速(預設關 = 改版前;main 在啟動時讀設定檔,改了要重新啟動才生效) -->
    <div class="srow">
      <span class="k">{{ t('ppz.hw_accel.label') }}<help-tip id="hardware-acceleration" data-setting="hardware-acceleration-note" :text="t('ppz.hw_accel.note')" /><small class="k-sub">{{ t('ppz.hw_accel.sub') }}</small></span>
      <div class="ctl">
        <label class="scan-switch" :title="t('ppz.hw_accel.label')"><input v-model="config.hardwareAcceleration" type="checkbox" role="switch" :aria-checked="config.hardwareAcceleration" :aria-label="t('ppz.hw_accel.label')" data-setting="hardware-acceleration"><span class="scan-switch-track" aria-hidden="true"><span class="scan-switch-knob" /></span></label>
        <template v-if="hwAccelPending">
          <span class="warn-text" data-setting="hardware-acceleration-restart">{{ t('ppz.hw_accel.restart_needed') }}</span>
          <button v-if="canRelaunch" class="btn sm" data-action="relaunch" :disabled="relaunching" @click="relaunch">{{ t('ppz.hw_accel.restart_now') }}</button>
        </template>
      </div>
    </div>
    <!-- 2026-11-16:建立桌面捷徑(只有 Electron 視窗;釘選到工作列只能由使用者在捷徑上按右鍵) -->
    <div v-if="canCreateShortcut" class="srow" data-setting="desktop-shortcut">
      <span class="k">{{ t('ppz.desktop_shortcut.label') }}<help-tip id="desktop-shortcut" data-setting="desktop-shortcut-hint" :text="t('ppz.desktop_shortcut.hint')" /></span>
      <div class="ctl">
        <button class="btn sm" data-action="desktop-shortcut-create" :disabled="shortcutBusy" @click="createShortcut">{{ t('ppz.desktop_shortcut.button') }}</button>
        <span v-if="shortcutState" :class="shortcutState === 'done' ? 'note' : 'warn-text'" data-setting="desktop-shortcut-result" role="status">{{ shortcutText }}</span>
      </div>
    </div>
  </section>

  <section v-if="canOpenConfigFolder || hasHost" class="card" data-setting="files-preview">
    <div class="card-head"><span class="label">{{ t('ppz.section_files') }}</span></div>
    <div v-if="canOpenConfigFolder" class="srow" data-about="config-folder">
      <span class="k">{{ t('ppz.about.config_folder') }}</span>
      <div class="ctl">
        <button class="btn sm" data-action="config-open-folder" @click="openConfigFolder">{{ t('ppz.about.config_folder_open') }}</button>
      </div>
    </div>
    <template v-if="hasHost">
      <template v-if="isPreview">
        <div class="card-head sub-head" data-setting="browser-preview"><span class="sublabel">{{ t('ppz.preview.section') }}</span></div>
        <p class="preview-note" data-preview="active">{{ t('ppz.preview.active') }}</p>
        <p v-if="needsRestart" class="preview-note warn" data-preview="needs-restart">{{ t('ppz.preview.needs_restart') }}</p>
      </template>
      <template v-else>
        <div class="srow" data-setting="browser-preview">
          <span class="k">{{ t('ppz.preview.section') }}<help-tip id="browser-preview" :text="t('ppz.preview.hint')" /><small class="k-sub">{{ t('ppz.preview.lead') }}</small></span>
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
        <p v-if="previewError" class="err">{{ t('ppz.preview.failed', { error: previewError }) }}</p>
      </template>
    </template>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UpdaterInfo } from '@ipc/types'
import { AppConfig, configContentsForRelaunch, hotkeyRegistration } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import HelpTip from '../HelpTip.vue'

const RELEASES = 'https://github.com/Hsiung-Shao/exile-appraiser/releases'

export default defineComponent({
  components: { HelpTip },
  setup () {
    const { t } = useI18n()
    const config = AppConfig()

    // ---- 更新(原 About.vue) ----
    const info = shallowRef<UpdaterInfo | null>(null)
    let unsubscribe: (() => void) | null = null
    let pushed = false
    onMounted(() => {
      unsubscribe = Host.onUpdaterState((next) => { pushed = true; info.value = next })
      // 推播比查詢先到就以推播為準
      Host.getUpdaterInfo()
        .then((v) => { if (!pushed) info.value = v })
        .catch((e) => { console.error('[startup] getUpdaterInfo 失敗', e) })
    })
    onUnmounted(() => { unsubscribe?.() })
    /** 安裝版 + main 已套用 autoUpdate:下載完成後「結束程式時自動套用」。 */
    const autoApply = computed(() => info.value?.reason === 'unsigned-build' && info.value.autoUpdate !== false)
    const updateText = computed(() => {
      const i = info.value
      if (!i) return t('ppz.loading')
      if (i.reason === 'disabled-by-flag') return t('ppz.update.disabled')
      switch (i.state) {
        case 'initial': return t('ppz.update.initial')
        case 'checking': return t('updates.checking')
        case 'available':
          return i.reason === 'not-supported'
            ? `${t('updates.available', [i.version ?? '?'])} — ${t('ppz.update.not_supported')}`
            : t('updates.available', [i.version ?? '?'])
        case 'not-available': return t('updates.latest')
        case 'downloading': return t('updates.downloading')
        case 'downloaded':
          return autoApply.value
            ? t('ppz.update.downloaded_auto', { version: i.version ?? '?' })
            : t('ppz.update.downloaded', { version: i.version ?? '?' })
        case 'error':
          return i.errorKind === 'not-found'
            ? t('ppz.update.not_found')
            : t('ppz.update.error', { error: (i.error ?? '').split('\n')[0] })
        default: return ''
      }
    })
    const updateTone = computed(() => {
      const s = info.value?.state
      if (s === 'available' || s === 'downloaded') return 'good'
      if (s === 'error' && info.value?.errorKind !== 'not-found') return 'bad'
      if (s === 'checking' || s === 'downloading') return 'pulse'
      return ''
    })

    // ---- 瀏覽器預覽(原 General.vue) ----
    const previewUrl = shallowRef<string | null>(null)
    const previewBusy = shallowRef(false)
    const previewError = shallowRef<string | null>(null)
    const copied = shallowRef(false)
    onMounted(async () => {
      if (!Host.isElectron || Host.isPreview) return
      try { previewUrl.value = await Host.getPreviewUrl() } catch { /* 預覽伺服器還沒開 = 沒有網址,按鈕照常可按 */ }
    })

    // ---- 第五輪 30.5:硬體加速(啟動時套用的值;拿不到(預覽 / 純瀏覽器)= 開設定頁時的值)----
    const hwAccelAtStart = shallowRef<boolean>(config.hardwareAcceleration)
    const relaunching = shallowRef(false)
    onMounted(async () => {
      try {
        const v = await Host.hwAccelActive()
        if (typeof v === 'boolean') hwAccelAtStart.value = v
      } catch { /* 拿不到啟動時的值 = 沿用開設定頁時的值 */ }
    })
    const shortcutBusy = shallowRef(false)
    const shortcutState = shallowRef<'' | 'done' | 'dev' | 'failed'>('')
    async function createShortcut () {
      shortcutBusy.value = true
      shortcutState.value = '' // 先清掉,連按兩次也看得到結果重新出現
      shortcutState.value = await Host.createDesktopShortcut()
      shortcutBusy.value = false
    }
    async function relaunch () {
      relaunching.value = true
      try { await Host.appRelaunch(configContentsForRelaunch()) } catch { relaunching.value = false }
    }

    return {
      t,
      config,
      version: Host.version,
      // 開發模式 / 純瀏覽器 Host.version = 'dev',不加 v
      versionText: /^\d/.test(Host.version) ? `v${Host.version}` : Host.version,
      info,
      autoApply,
      updateText,
      updateTone,
      lastChecked: computed(() => {
        const at = info.value?.checkedAt
        return at ? t('updates.last_checked', [new Date(at).toLocaleString(config.uiLanguage === 'en' ? 'en-US' : 'zh-TW')]) : ''
      }),
      canCheck: computed(() => {
        const i = info.value
        return i != null && i.reason !== 'disabled-by-flag' && i.state !== 'checking' && i.state !== 'downloading'
      }),
      showDownload: computed(() => info.value?.state === 'available' && info.value.reason === 'unsigned-build'),
      showReleases: computed(() => info.value?.state === 'available' && info.value.reason === 'not-supported'),
      releasesUrl: computed(() => info.value?.releaseNotesUrl ?? RELEASES),
      check () { void Host.checkForUpdate() },
      download () { void Host.downloadUpdate() },
      install () { void Host.installUpdate() },
      open (url: string) { void Host.openExternal(url) },
      canOpenConfigFolder: Host.canOpenConfigFolder,
      openConfigFolder () { void Host.openConfigFolder() },
      hwAccelPending: computed(() => config.hardwareAcceleration !== hwAccelAtStart.value),
      canRelaunch: Host.canRelaunch,
      canCreateShortcut: Host.canCreateDesktopShortcut,
      shortcutBusy,
      shortcutState,
      // 鍵寫成字面值:settings-ia 測試靜態掃 t('ppz.…') 檢查兩語都有
      shortcutText: computed(() => ({ '': '', done: t('ppz.desktop_shortcut.done'), dev: t('ppz.desktop_shortcut.dev'), failed: t('ppz.desktop_shortcut.failed') })[shortcutState.value]),
      createShortcut,
      relaunching,
      relaunch,
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
/* 第五輪 30.5:硬體加速「重新啟動後生效」列(尺寸用 em / --fs-*,跟設定視窗獨立字級) */
.settings-panel .hw-restart {
  display: flex;
  align-items: center;
  gap: 0.6em;
  margin-top: 4px;
  font-size: var(--fs-xs);
}
.settings-panel .hw-restart .warn-text {
  color: var(--warn, var(--gold));
}
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
.settings-panel .card-head.sub-head {
  margin: 0.8em 0 0.3em;
}
/* 2026-11-18 設計稿 P04-Startup:標題列右邊 = 狀態點 + 狀態 + 目前版本;名稱下一行小字說明 */
.settings-panel [data-about="update"] .card-head .grow {
  flex: 1;
}
.settings-panel [data-about="update"] .update-status {
  display: inline-flex;
  align-items: center;
  gap: 0.45em;
  min-width: 0;
  font-size: var(--fs-xs);
  color: var(--ink-2);
}
.settings-panel [data-about="update"] .update-status .dot {
  flex: none;
  width: 0.5em;
  height: 0.5em;
  border-radius: 50%;
  background: var(--ink-3);
}
.settings-panel [data-about="update"] .update-status.good .dot {
  background: var(--ok);
}
.settings-panel [data-about="update"] .update-status.bad .dot {
  background: var(--bad);
}
.settings-panel [data-about="update"] .update-status[data-update-state="not-available"] {
  color: var(--ok);
}
.settings-panel [data-about="update"] .update-status[data-update-state="not-available"] .dot {
  background: var(--ok);
}
.settings-panel .update-ver {
  flex: none;
  font-family: ui-monospace, Consolas, monospace;
  font-size: var(--fs-xs);
  color: var(--ink-1);
}
.settings-panel .srow > .k .k-sub {
  display: block;
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.settings-panel .srow > .ctl .update-meta {
  margin: 0;
}
</style>
