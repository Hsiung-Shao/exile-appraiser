<!--
  設定 › 啟動與更新(2026-11-18 設定重整:原本分在「一般」(啟動、瀏覽器預覽)與「更新與關於」(更新、設定資料夾)):
  - 更新:狀態(main/src/AppUpdater.ts 經 Host.getUpdaterInfo / onUpdaterState)、檢查 / 下載 / 安裝、自動更新(免安裝版不顯示)、新版提醒(第 34 步)。
    更新字串沿用上游 `updates.*`,上游沒有的放 `ppz.update.*`。
  - 啟動:啟動提示、硬體加速(第五輪 30.5,改了要重新啟動)、建立桌面捷徑(2026-11-16)。
  - 檔案與預覽:開啟設定資料夾、瀏覽器預覽(main 的 preview-server;docs/browser-preview.md)。
-->
<template>
  <section class="card" data-about="update">
    <span class="label">{{ t('ppz.about.section_update') }}</span>
    <span class="update-status" :class="updateTone" :data-update-state="info?.state" :title="updateText">{{ updateText }}</span>
    <p v-if="lastChecked" class="update-meta">{{ lastChecked }}</p>
    <div class="btn-row">
      <button class="btn sm" data-action="update-check" :disabled="!canCheck" @click="check">{{ t('ppz.update.check') }}</button>
      <button v-if="showDownload" class="btn sm primary" data-action="update-download" @click="download">{{ t('ppz.update.download') }}</button>
      <button v-if="showReleases" class="btn sm" data-action="update-releases" @click="open(releasesUrl)">{{ t('ppz.update.releases') }} ↗</button>
      <button v-if="info?.state === 'downloaded'" class="btn sm primary" data-action="update-install" @click="install">{{ autoApply ? t('ppz.update.restart_now') : t('ppz.update.restart_install') }}</button>
    </div>
    <template v-if="info?.reason !== 'not-supported'">
      <div class="chk-row">
        <label class="chk"><input v-model="config.autoUpdate" type="checkbox" data-setting="auto-update"><span>{{ t('ppz.update.auto') }}</span></label>
        <help-tip id="auto-update" data-about="auto-update-hint" :text="t('ppz.update.auto_hint')" />
      </div>
    </template>
    <!-- 第 34 步:有新版本時每 10 分鐘在右下角提醒(main/src/update-reminder.ts) -->
    <div class="chk-row">
      <label class="chk"><input v-model="config.updateReminder" type="checkbox" data-setting="update-reminder"><span>{{ t('ppz.update.reminder') }}</span></label>
      <help-tip id="update-reminder" data-about="update-reminder-hint" :text="t('ppz.update.reminder_hint')" />
    </div>
  </section>

  <section class="card" data-setting="startup">
    <span class="label">{{ t('ppz.section_startup') }}</span>
    <div class="chk-row">
      <label class="chk"><input v-model="config.startupToast" type="checkbox" data-setting="startup-toast"><span>{{ t('ppz.startup_toast') }}</span></label>
    </div>
    <!-- 第五輪 30.5:硬體加速(預設關 = 改版前;main 在啟動時讀設定檔,改了要重新啟動才生效) -->
    <div class="chk-row">
      <label class="chk"><input v-model="config.hardwareAcceleration" type="checkbox" data-setting="hardware-acceleration"><span>{{ t('ppz.hw_accel.label') }}</span></label>
      <help-tip id="hardware-acceleration" data-setting="hardware-acceleration-note" :text="t('ppz.hw_accel.note')" />
    </div>
    <div v-if="hwAccelPending" class="hw-restart" data-setting="hardware-acceleration-restart">
      <span class="warn-text">{{ t('ppz.hw_accel.restart_needed') }}</span>
      <button v-if="canRelaunch" class="btn sm" data-action="relaunch" :disabled="relaunching" @click="relaunch">{{ t('ppz.hw_accel.restart_now') }}</button>
    </div>
    <!-- 2026-11-16:建立桌面捷徑(只有 Electron 視窗;釘選到工作列只能由使用者在捷徑上按右鍵) -->
    <div v-if="canCreateShortcut" class="srow" data-setting="desktop-shortcut">
      <span class="k">{{ t('ppz.desktop_shortcut.label') }}</span>
      <div class="ctl">
        <button class="btn sm" data-action="desktop-shortcut-create" :disabled="shortcutBusy" @click="createShortcut">{{ t('ppz.desktop_shortcut.button') }}</button>
        <span v-if="shortcutState" :class="shortcutState === 'done' ? 'note' : 'warn-text'" data-setting="desktop-shortcut-result" role="status">{{ shortcutText }}</span>
      </div>
    </div>
    <p v-if="canCreateShortcut" class="lead" data-setting="desktop-shortcut-hint">{{ t('ppz.desktop_shortcut.hint') }}</p>
  </section>

  <section v-if="canOpenConfigFolder || hasHost" class="card" data-setting="files-preview">
    <span class="label">{{ t('ppz.section_files') }}</span>
    <div v-if="canOpenConfigFolder" class="srow" data-about="config-folder">
      <span class="k">{{ t('ppz.about.config_folder') }}</span>
      <div class="ctl">
        <button class="btn ghost sm" data-action="config-open-folder" @click="openConfigFolder">{{ t('ppz.about.config_folder_open') }}</button>
      </div>
    </div>
    <template v-if="hasHost">
      <div class="card-head sub-head" data-setting="browser-preview">
        <span class="sublabel">{{ t('ppz.preview.section') }}</span>
        <help-tip v-if="!isPreview" id="browser-preview" :text="t('ppz.preview.hint')" />
      </div>
      <template v-if="isPreview">
        <p class="preview-note" data-preview="active">{{ t('ppz.preview.active') }}</p>
        <p v-if="needsRestart" class="preview-note warn" data-preview="needs-restart">{{ t('ppz.preview.needs_restart') }}</p>
      </template>
      <template v-else>
        <p class="lead">{{ t('ppz.preview.lead') }}</p>
        <div class="btn-row">
          <button class="btn sm" :disabled="previewBusy" data-action="open-preview" @click="openPreview">{{ t('ppz.preview.open') }}</button>
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
</style>
