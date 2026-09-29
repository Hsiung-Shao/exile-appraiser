<!--
  設定 › 關於(WP4):品牌 + 版本、更新狀態(main/src/AppUpdater.ts 經 Host.getUpdaterInfo / onUpdaterState)、
  資料來源(data/MANIFEST.json 的 `sources["data/poe1" | "data/poe2" | "data/poe2/trade" | "data/regex"]`,依目前遊戲列出;
  有 commit 顯示短碼,只有 fetchedAt(交易站快照)顯示抓取日期)、連結列、回報問題、第三方致謝(授權全文 modal)。
  更新字串沿用上游 `updates.*`,上游沒有的放 `ppz.update.*`。所有外連走 Host.openExternal。
  贊助連結一律純文字(Patreon 不可用任何標誌 / 圖示)。
  授權全文 = LICENSES/*.MIT 的複本,放在 renderer/public/licenses/(Vite 帶進 dist;正式版由 app:// 供應)。
-->
<template>
  <section class="card about-brand">
    <div class="brand-row">
      <i class="brand-mark" />
      <span class="brand-name">ExileAppraiser</span>
      <span class="brand-zh">流亡鑑價</span>
      <span class="chip soft" data-about="version">{{ version }}</span>
    </div>
    <p class="tagline">{{ t('ppz.about.tagline') }}</p>
  </section>

  <section class="card" data-about="update">
    <span class="label">{{ t('ppz.about.section_update') }}</span>
    <span class="update-status" :class="updateTone" :data-update-state="info?.state" :title="updateText">{{ updateText }}</span>
    <p v-if="lastChecked" class="update-meta">{{ lastChecked }}</p>
    <div class="btn-row">
      <button class="btn sm" data-action="update-check" :disabled="!canCheck" @click="check">{{ t('ppz.update.check') }}</button>
      <button v-if="showDownload" class="btn sm primary" data-action="update-download" @click="download">{{ t('ppz.update.download') }}</button>
      <button v-if="showReleases" class="btn sm" data-action="update-releases" @click="open(releasesUrl)">{{ t('ppz.update.releases') }} ↗</button>
      <button v-if="info?.state === 'downloaded'" class="btn sm primary" data-action="update-install" @click="install">{{ t('ppz.update.restart_install') }}</button>
    </div>
  </section>

  <section class="card">
    <span class="label">{{ t('ppz.section_data') }}</span>
    <div v-for="row in rows" :key="row.prefix" class="srow" :data-source="row.prefix">
      <span class="k">{{ t(row.key) }}</span>
      <div class="ctl source-text">{{ row.text }}</div>
    </div>
    <div v-if="ninjaText" class="srow" data-source="poe.ninja">
      <span class="k">{{ t('ppz.ninja.source') }}</span>
      <div class="ctl source-text" :title="ninjaError">{{ ninjaText }}</div>
    </div>
    <p v-if="manifestError" class="err-line">{{ manifestError }}</p>
  </section>

  <section class="card" data-about="links">
    <span class="label">{{ t('ppz.about.section_links') }}</span>
    <div class="btn-row">
      <button v-for="l in links" :key="l.url" class="btn ghost sm" :data-link="l.url" @click="open(l.url)">{{ t(l.key) }} ↗</button>
    </div>
    <span class="label sub">{{ t('ppz.about.support') }}</span>
    <div class="btn-row">
      <button v-for="l in support" :key="l.url" class="btn ghost sm" :data-link="l.url" @click="open(l.url)">{{ t(l.key) }} ↗</button>
    </div>
    <span class="label sub">{{ t('ppz.about.report') }}</span>
    <p class="hint">{{ t('ppz.about.report_hint') }}</p>
    <div class="btn-row">
      <button class="btn sm" data-action="report-app" @click="report">{{ t('ppz.about.report') }} ↗</button>
      <button class="btn ghost sm" data-action="report-copy" @click="copy">{{ t('ppz.report.copy') }}</button>
    </div>
    <p v-if="reportMessage" class="hint" :class="{ bad: reportFailed }" data-report-status>{{ reportMessage }}</p>
  </section>

  <section class="card" data-about="thanks">
    <span class="label">{{ t('ppz.about.section_thanks') }}</span>
    <p class="hint">{{ t('ppz.about.thanks_intro') }}</p>
    <ul class="thanks">
      <li v-for="p in thanks" :key="p.name" :data-credit="p.name">
        <div class="thanks-head">
          <button class="linkish" :data-link="p.url" @click="open(p.url)">{{ p.name }} ↗</button>
          <span class="dim">{{ p.author }}<template v-if="p.license"> · {{ p.license }}</template></span>
        </div>
        <p class="thanks-desc">{{ t(p.desc) }}</p>
        <div v-if="p.licenseFile || p.support" class="btn-row">
          <button v-if="p.licenseFile" class="btn ghost sm" :data-license="p.licenseFile" @click="showLicense(p.name, p.licenseFile)">{{ t('ppz.about.license') }}</button>
          <button v-if="p.support" class="btn ghost sm" :data-link="p.support" @click="open(p.support)">{{ t('ppz.about.support_author') }} ↗</button>
        </div>
      </li>
    </ul>
  </section>

  <div v-if="license" class="modal about-modal" data-modal="license" @click.self="license = null">
    <div class="dialog" role="dialog" aria-modal="true">
      <header class="dialog-head">
        <span>{{ t('ppz.about.license_title', { name: license.name }) }}</span>
        <button class="btn ghost sm" data-action="license-close" @click="license = null">{{ t('ppz.about.close') }}</button>
      </header>
      <pre class="license-text">{{ license.text }}</pre>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UpdaterInfo } from '@ipc/types'
import { AppConfig } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import { reportIssue, copyIssueReport, reportStatus } from '@/web/report'
import { usePoeninja } from '@/web/background/Prices'

interface ManifestSource {
  repo?: string
  commit?: string
  fetchedAt?: string
}

/** 各遊戲要列的 MANIFEST 前綴(順序即顯示順序)。 */
const PREFIXES: Record<'poe1' | 'poe2', Array<{ prefix: string, key: string }>> = {
  poe1: [
    { prefix: 'data/poe1', key: 'ppz.data_poe1' },
    { prefix: 'data/regex', key: 'ppz.data_regex' }
  ],
  poe2: [
    { prefix: 'data/poe2', key: 'ppz.data_poe2' },
    { prefix: 'data/poe2/trade', key: 'ppz.data_poe2_trade' },
    { prefix: 'data/regex', key: 'ppz.data_regex' }
  ]
}

const REPO = 'https://github.com/Hsiung-Shao/exile-appraiser'
const RELEASES = `${REPO}/releases`

const LINKS = [
  { key: 'ppz.about.github', url: REPO },
  { key: 'ppz.about.release_notes', url: RELEASES },
  { key: 'ppz.about.website', url: 'https://hsiung-shao.github.io/' },
  { key: 'ppz.about.discord', url: 'https://discord.gg/6VamPQb8nC' }
]
/** 贊助:純文字(不放 Patreon 標誌)。 */
const SUPPORT = [
  { key: 'ppz.about.bmc', url: 'https://buymeacoffee.com/hsiung' },
  { key: 'ppz.about.patreon', url: 'https://patreon.com/HsiungShao' }
]

interface Credit {
  name: string
  author: string
  license?: string
  url: string
  desc: string
  /** renderer/public/licenses/ 下的檔名(fork 沿用上游的 MIT 授權)。 */
  licenseFile?: string
  /** 原作者的支持連結(純文字)。 */
  support?: string
}

const THANKS: Credit[] = [
  { name: 'Awakened PoE Trade', author: 'SnosMe', license: 'MIT', url: 'https://github.com/SnosMe/awakened-poe-trade', desc: 'ppz.about.apt', licenseFile: 'awakened-poe-trade.MIT', support: 'https://patreon.com/awakened_poe_trade' },
  { name: 'awakened-poe-trade-zh-TW', author: 'Hsiung-Shao', license: 'MIT', url: 'https://github.com/Hsiung-Shao/awakened-poe-trade-zh-TW', desc: 'ppz.about.apt_zh', licenseFile: 'awakened-poe-trade.MIT' },
  { name: 'Exiled Exchange 2', author: 'Kvan7', license: 'MIT', url: 'https://github.com/Kvan7/Exiled-Exchange-2', desc: 'ppz.about.ee2', licenseFile: 'exiled-exchange-2.MIT' },
  { name: 'Exiled-Exchange-2-zh-TW', author: 'Hsiung-Shao', license: 'MIT', url: 'https://github.com/Hsiung-Shao/Exiled-Exchange-2-zh-TW', desc: 'ppz.about.ee2_zh', licenseFile: 'exiled-exchange-2.MIT' },
  { name: 'PoENavi', author: 'Buri', license: 'MIT', url: 'https://github.com/buri34/poenavi', desc: 'ppz.about.poenavi', licenseFile: 'poenavi.MIT' },
  { name: 'PobTools', author: 'Hsiung-Shao', url: 'https://github.com/Hsiung-Shao/PobTools-zh', desc: 'ppz.about.pobtools' },
  { name: 'Path of Building Community (PoE2)', author: 'PathOfBuildingCommunity', license: 'MIT', url: 'https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2', desc: 'ppz.about.pob_poe2', licenseFile: 'path-of-building.MIT' },
  { name: 'poe-disenchant-tool', author: 'deronek', license: 'MIT', url: 'https://github.com/deronek/poe-disenchant-tool', desc: 'ppz.about.disenchant', licenseFile: 'poe-disenchant-tool.MIT' },
  { name: 'poe-dust (gist)', author: '@alserom', url: 'https://gist.github.com/alserom/22bdd4106806cbd4f85a5cb8c4345c08', desc: 'ppz.about.alserom' }
]

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const sources = shallowRef<Record<string, ManifestSource>>({})
    const manifestError = shallowRef('')
    const info = shallowRef<UpdaterInfo | null>(null)
    const license = shallowRef<{ name: string, text: string } | null>(null)
    let unsubscribe: (() => void) | null = null
    let pushed = false

    onMounted(async () => {
      unsubscribe = Host.onUpdaterState((next) => { pushed = true; info.value = next })
      // 推播比查詢先到就以推播為準
      Host.getUpdaterInfo()
        .then((v) => { if (!pushed) info.value = v })
        .catch((e) => { console.error('[about] getUpdaterInfo 失敗', e) })
      try {
        const m = await (await fetch('./data/MANIFEST.json')).json() as { sources?: Record<string, ManifestSource> }
        sources.value = m.sources ?? {}
      } catch (e) {
        manifestError.value = `MANIFEST.json: ${(e as Error).message}`
      }
    })
    onUnmounted(() => { unsubscribe?.() })

    // poe.ninja 價格表(PoE1 查價元件用;Prices.ts 的快取時間)
    const ninja = usePoeninja()
    const ninjaText = computed(() => {
      if (AppConfig().game !== 'poe1') return ''
      if (AppConfig().realm !== 'intl') return t('ppz.ninja.tw_unavailable')
      const at = ninja.lastFetchedAt.value
      if (at) return t('ppz.ninja.updated', { time: new Date(at).toLocaleString(AppConfig().uiLanguage === 'en' ? 'en-US' : 'zh-TW') })
      if (ninja.isLoading.value) return t('ppz.ninja.loading')
      if (ninja.lastError.value) return t('ppz.ninja.error', { error: ninja.lastError.value })
      return t('ppz.ninja.never')
    })

    const rows = computed(() => PREFIXES[AppConfig().game].map(({ prefix, key }) => {
      const s = sources.value[prefix]
      let text = '?'
      if (s) {
        const repo = s.repo ?? prefix
        if (s.commit) {
          text = t('ppz.data_source', { repo, commit: s.commit.slice(0, 7) })
        } else if (s.fetchedAt) {
          text = `${repo} · ${t('ppz.data_fetched', { date: s.fetchedAt.slice(0, 10) })}`
        } else {
          text = repo
        }
      }
      return { prefix, key, text }
    }))

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
        case 'downloaded': return t('ppz.update.downloaded', { version: i.version ?? '?' })
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

    const reportMessage = computed(() => {
      const s = reportStatus.value
      if (!s) return ''
      if (s.kind === 'url') return t('ppz.report.opened')
      if (s.kind === 'clipboard') return t('ppz.report.clipboard')
      if (s.kind === 'copied') return t('ppz.report.copied')
      return t('ppz.report.failed', { error: s.message ?? '' })
    })

    function open (url: string) { void Host.openExternal(url) }

    return {
      t,
      version: Host.version,
      rows,
      manifestError,
      ninjaText,
      ninjaError: computed(() => ninja.lastError.value ?? undefined),
      info,
      updateText,
      updateTone,
      lastChecked: computed(() => {
        const at = info.value?.checkedAt
        return at ? t('updates.last_checked', [new Date(at).toLocaleString(AppConfig().uiLanguage === 'en' ? 'en-US' : 'zh-TW')]) : ''
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
      open,
      links: LINKS,
      support: SUPPORT,
      thanks: THANKS,
      license,
      async showLicense (name: string, file: string) {
        try {
          const res = await fetch(`./licenses/${file}`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          license.value = { name, text: await res.text() }
        } catch (e) {
          license.value = { name, text: t('ppz.about.license_failed', { error: (e as Error).message }) }
        }
      },
      reportMessage,
      reportFailed: computed(() => reportStatus.value?.kind === 'error'),
      report () { void reportIssue({}) },
      copy () { void copyIssueReport({}) }
    }
  }
})
</script>

<style>
.settings-panel .source-text {
  font-size: var(--fs-xs);
  color: var(--ink-1);
  overflow-wrap: anywhere;
  user-select: text;
}
.about-brand .brand-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.about-brand .brand-mark {
  width: 12px;
  height: 12px;
  background: var(--gold);
  transform: rotate(45deg);
  border-radius: 2px;
  flex-shrink: 0;
}
.about-brand .brand-name {
  font-weight: 600;
  font-size: var(--fs-md);
  letter-spacing: 0.05em;
}
.about-brand .brand-zh {
  color: var(--ink-1);
  font-size: var(--fs-sm);
}
.about-brand .tagline {
  margin: 6px 0 0;
  color: var(--ink-2);
  font-size: var(--fs-xs);
}
.settings-panel .btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.settings-panel .label.sub {
  display: block;
  margin: 12px 0 0;
}
.settings-panel .hint {
  margin: 4px 0 0;
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.settings-panel .hint.bad {
  color: var(--bad);
}
.update-status {
  display: block;
  font-size: var(--fs-sm);
  color: var(--ink-1);
}
/* 錯誤只顯示一行(完整內容在 title) */
.update-status.bad {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.update-status.good {
  color: var(--ok);
}
.update-status.bad {
  color: var(--bad);
}
.update-meta {
  margin: 2px 0 0;
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.thanks {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.thanks-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}
.thanks-head .dim {
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.thanks-desc {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--ink-2);
}
.linkish {
  appearance: none;
  border: 0;
  background: none;
  padding: 0;
  color: var(--ink-0);
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
}
.linkish:hover {
  color: var(--gold);
  text-decoration: underline;
}
.about-modal {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.55);
}
.about-modal .dialog {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 100%;
  background: var(--surface-1);
  border: 1px solid var(--edge-1);
  border-radius: 8px;
  box-shadow: var(--shadow-float);
  overflow: hidden;
}
.about-modal .dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 8px 14px;
  border-bottom: 1px solid var(--edge-0);
  font-weight: 600;
  font-size: var(--fs-sm);
}
.about-modal .license-text {
  margin: 0;
  padding: 12px 14px;
  overflow: auto;
  font-size: var(--fs-2xs);
  line-height: 1.5;
  color: var(--ink-1);
  white-space: pre-wrap;
  user-select: text;
}
</style>
