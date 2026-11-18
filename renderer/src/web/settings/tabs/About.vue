<!--
  設定 › 關於(WP4;2026-11-18 設定重整:更新與設定資料夾搬到「啟動與更新」(Startup.vue),這頁只剩品牌 → 資料來源 → 連結與贊助 → 致謝):品牌 + 版本、
  資料來源(2026-10-14 使用者要求只留 poe.ninja 價格表的更新時間;MANIFEST 的資料版本列已移除)、連結列、回報問題、第三方致謝(授權全文 modal)。
  更新字串沿用上游 `updates.*`,上游沒有的放 `ppz.update.*`。所有外連走 Host.openExternal。
  贊助連結一律純文字(Patreon 不可用任何標誌 / 圖示)。
  授權全文 = LICENSES/*.MIT 的複本,放在 renderer/public/licenses/(Vite 帶進 dist;正式版由 app:// 供應)。
  2026-10-07:品牌卡片顯示「支援遊戲版本」(`settings/game-versions.ts`,遊戲改版 / 資料同步 / 發版時更新);
  2026-10-14 改成品牌卡片右側兩個醒目的大字塊(設計稿:強調色邊框、大號等寬數字)。
  第 39 步:免安裝版不顯示「自動更新」開關(只對安裝版有效;狀態列已說明);「開啟設定資料夾」從連結卡片獨立成一張。
-->
<template>
  <section class="card about-brand">
    <div class="brand-main">
      <div class="brand-row">
        <i class="brand-mark" />
        <span class="brand-name">ExileAppraiser</span>
        <span class="brand-zh">流亡鑑價</span>
        <span class="chip soft" data-about="version">{{ version }}</span>
      </div>
      <p class="tagline">{{ t('ppz.about.tagline') }}</p>
    </div>
    <div class="gv-row" data-about="game-versions" role="group" :aria-label="t('ppz.about.game_versions_label')" :title="t('ppz.about.game_versions_label')">
      <span class="gv-title">{{ t('ppz.about.game_versions_title') }}</span>
      <span v-for="g in gameBlocks" :key="g.id" class="gv-block" :data-game="g.id">
        <span class="gv-game">{{ g.name }}</span>
        <span class="gv-num num">{{ g.version }}</span>
      </span>
    </div>
  </section>

  <section class="card">
    <span class="label">{{ t('ppz.section_data') }}</span>
    <div class="srow" data-source="poe.ninja">
      <span class="k">{{ t('ppz.ninja.source') }}</span>
      <div class="ctl source-text" :title="ninjaError">{{ ninjaText }}</div>
    </div>
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
import { computed, defineComponent, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import { reportIssue, copyIssueReport, reportStatus } from '@/web/report'
import { usePoeninja } from '@/web/background/Prices'
import { SUPPORTED_GAME_VERSIONS } from '../game-versions'

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
  { name: 'poe-disenchant-tool', author: 'deronek', license: 'MIT', url: 'https://github.com/deronek/poe-disenchant-tool', desc: 'ppz.about.disenchant', licenseFile: 'poe-disenchant-tool.MIT' },
  { name: 'Exile UI', author: 'Lailloken', license: 'MIT', url: 'https://github.com/Lailloken/Exile-UI', desc: 'ppz.about.exile_ui', licenseFile: 'exile-ui.MIT' },
  { name: 'poe-dust (gist)', author: '@alserom', url: 'https://gist.github.com/alserom/22bdd4106806cbd4f85a5cb8c4345c08', desc: 'ppz.about.alserom' }
]

export default defineComponent({
  setup () {
    const { t } = useI18n()
    const license = shallowRef<{ name: string, text: string } | null>(null)
    // poe.ninja 價格表(Prices.ts 的快取時間;目標依目前遊戲,WP-R2 起 PoE2 也抓)
    const ninja = usePoeninja()
    const ninjaText = computed(() => {
      if (AppConfig().realm !== 'intl') return t('ppz.ninja.tw_unavailable')
      const at = ninja.lastFetchedAt.value
      if (at) return t('ppz.ninja.updated', { time: new Date(at).toLocaleString(AppConfig().uiLanguage === 'en' ? 'en-US' : 'zh-TW') })
      if (ninja.isLoading.value) return t('ppz.ninja.loading')
      if (ninja.lastError.value) return t('ppz.ninja.error', { error: ninja.lastError.value })
      return t('ppz.ninja.never')
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
      config: AppConfig(),
      version: Host.version,
      gameVersions: SUPPORTED_GAME_VERSIONS,
      gameBlocks: [
        { id: 'poe1', name: 'PoE1', version: SUPPORTED_GAME_VERSIONS.poe1 },
        { id: 'poe2', name: 'PoE2', version: SUPPORTED_GAME_VERSIONS.poe2 }
      ],
      ninjaText,
      ninjaError: computed(() => ninja.lastError.value ?? undefined),
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
.about-brand {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75em 1em;
}
.about-brand .brand-main {
  flex: 1 1 14em;
  min-width: 0;
}
/* 支援遊戲版本:品牌卡片下方獨佔一列,標題 + 每代一個「遊戲 | 版號」膠囊(2026-10-14 使用者嫌金框大字塊醜) */
.about-brand .gv-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5em 0.6em;
  flex: 1 1 100%;
  padding-top: 0.7em;
  border-top: 1px solid var(--edge-1);
}
.about-brand .gv-title {
  margin-right: 0.3em;
  color: var(--ink-2);
  font-size: var(--fs-sm);
}
.about-brand .gv-block {
  display: inline-flex;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid var(--edge-1);
  border-radius: 999px;
  background: var(--surface-2);
  line-height: 1.9;
}
.about-brand .gv-game {
  padding: 0 0.7em;
  color: var(--ink-2);
  font-size: var(--fs-xs);
  font-weight: 600;
  background: var(--surface-1);
  border-right: 1px solid var(--edge-1);
}
.about-brand .gv-num {
  padding: 0 0.8em;
  color: var(--ink-0);
  font-size: var(--fs-md);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
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
  max-width: calc(var(--fs-base) * 50);
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
