<!--
  Poe Regex 面板(WP5 + WP-C,設定 › 正則):勾選詞綴 / 數值條件 → 產生貼進遊戲搜尋列的字串。
  版面照 PobTools `host/regex_tool_ui.cpp`:標題列(遊戲 / 檢視 / 清單 / 模式 / 已勾選 / 雙語)+ 範本與分享碼
  → 清單(語料頁 RegexList.vue、演算法頁 RegexAlgoList.vue、已選合併 RegexCombined.vue;
    地圖詞綴 / 換界石詞綴頁頂端另有數值區 RegexNumericSection.vue,第 32 步)
  → 輸出(合併 / 單頁、長度三色、複製、輸出語言、無法單獨指定、用到的片段)→ 書籤(RegexBookmarks.vue)。
  演算法全在 `@exile-appraiser/regex`(純 TS);狀態在 ./store.ts。
-->
<template>
  <div class="rx-panel" data-regex="panel" :data-game="selGame" :data-page="page?.id ?? ''" :data-view="panelView">
    <section class="card rx-head" data-regex="header">
      <div class="rx-head-row">
        <div class="seg" data-regex="game">
          <button v-for="g in games" :key="g" :class="{ on: selGame === g }" :data-value="g"
            @click="switchGame(g)">{{ gameLabel(g) }}</button>
        </div>
        <div v-if="catalogue" class="seg" data-regex="view">
          <button :class="{ on: panelView === 'combined' }" data-value="combined" @click="setPanelView('combined')">
            {{ t('ppz.regex.view_combined', { n: pickedPages.length }) }}
          </button>
          <button :class="{ on: panelView === 'page' }" data-value="page" @click="setPanelView('page')">{{ t('ppz.regex.view_page') }}</button>
        </div>
        <select v-if="catalogue" class="select sm rx-page" data-regex="page" :value="page?.id"
          @change="switchPage(($event.target as HTMLSelectElement).value)">
          <option v-for="p in listed" :key="p.id" :value="p.id">{{ pageTitle(p) }}{{ pagePickCount(p) ? ` (${pagePickCount(p)})` : '' }}</option>
        </select>
        <div class="seg" data-regex="mode">
          <button v-for="m in modes" :key="m" :class="{ on: ui.mode === m }" :data-value="m"
            :title="m === 'none' ? t('ppz.regex.mode_none_tip') : ''" @click="setMode(m)">{{ t(`ppz.regex.mode_${m}`) }}</button>
        </div>
        <span v-if="page && panelView === 'page'" class="rx-count num" data-regex="count">{{ t('ppz.regex.picked', { n: picked.length, total: page.entries.length }) }}</span>
        <span class="grow" />
        <label class="chk" :title="t('ppz.regex.bilingual_tip')">
          <input type="checkbox" data-regex="bilingual" :checked="ui.bilingual"
            @change="setBilingual(($event.target as HTMLInputElement).checked)">
          {{ t('ppz.regex.bilingual') }}
        </label>
      </div>
      <div v-if="catalogue" class="rx-head-row rx-head-tools">
        <select class="select sm rx-tpl" data-regex="template" :value="''" @change="onTemplate">
          <option value="" disabled>{{ t('ppz.regex.template_ph', { n: myTemplates.length }) }}</option>
          <option v-for="tp in myTemplates" :key="tp.id" :value="tp.id">{{ uiEn ? tp.name.en : tp.name.zh }}</option>
        </select>
        <button class="btn sm" data-regex="share-copy" :disabled="!anyPicked && !ui.custom.length && !ui.excludes.length"
          :title="t('ppz.regex.share_copy_tip')" @click="copyShare">
          {{ shareState === 'ok' ? t('ppz.regex.copied') : shareState === 'fail' ? t('ppz.regex.copy_failed') : t('ppz.regex.share_copy') }}
        </button>
        <button class="btn sm" data-regex="share-paste" :title="t('ppz.regex.share_paste_tip')" @click="openPaste">{{ t('ppz.regex.share_paste') }}</button>
      </div>
      <p v-if="page && panelView === 'page' && pageNote" class="rx-note">{{ pageNote }}</p>
    </section>

    <section v-if="!catalogue" class="card" :class="{ bad: slot.phase === 'error' }" data-regex="status">
      <p v-if="slot.phase === 'error'" class="rx-bad">
        {{ t('ppz.regex.load_failed', { game: gameLabel(selGame), error: slot.error }) }}
        <button class="btn sm" data-regex="retry" @click="retryCatalogue(selGame)">{{ t('ppz.regex.retry') }}</button>
      </p>
      <p v-else class="rx-loading pulse">{{ t('ppz.regex.loading') }}</p>
    </section>

    <template v-if="page && out">
      <RegexCombined v-if="panelView === 'combined'" />
      <template v-else-if="itemPage">
        <!-- 第 40 步:物品詞綴數值頁頂端的稀有度 / 汙染條件區 -->
        <RegexNumericSection v-if="section" :key="section.id" :section="section" />
        <RegexItemModList :key="itemPage.id" :page="itemPage" />
      </template>
      <RegexAlgoList v-else-if="algoPage" :page="algoPage" />
      <template v-else>
        <RegexNumericSection v-if="section" :key="section.id" :section="section" />
        <RegexList />
      </template>

      <section class="card rx-out" data-regex="output" :data-scope="scope">
        <div class="rx-out-row">
          <span class="label rx-out-label">{{ t('ppz.regex.output_hint') }}</span>
          <span class="grow" />
          <div class="seg" data-regex="out-scope" :title="t('ppz.regex.out_scope_tip')">
            <button :class="{ on: scope === 'combined' }" data-value="combined" @click="setOutScope('combined')">{{ t('ppz.regex.scope_combined') }}</button>
            <button :class="{ on: scope === 'page' }" data-value="page" @click="setOutScope('page')">{{ t('ppz.regex.scope_page') }}</button>
          </div>
        </div>
        <textarea class="input rx-query selectable" readonly rows="3" spellcheck="false" data-regex="query"
          :value="out.query" @focus="($event.target as HTMLTextAreaElement).select()" />
        <div class="rx-out-row">
          <span class="num rx-len" :class="lenLevel" data-regex="length" :data-level="lenLevel" :data-len="out.length">
            {{ t('ppz.regex.length', { len: out.length, limit: out.limit }) }}
          </span>
          <span v-if="scope === 'combined' && out.perPage.length + (out.custom.length ? 1 : 0) + (out.excludes.length ? 1 : 0) > 1"
            class="rx-parts" data-regex="parts">
            {{ partsText }}
          </span>
          <span v-if="lenLevel === 'bad'" class="rx-bad" data-regex="over-limit">{{ t('ppz.regex.over_limit') }}</span>
          <span class="grow" />
          <button class="btn primary sm rx-copy" data-regex="copy" :disabled="!out.query" @click="copy">
            {{ copyState === 'ok' ? t('ppz.regex.copied') : copyState === 'fail' ? t('ppz.regex.copy_failed') : t('ppz.regex.copy') }}
          </button>
          <!-- 2026-10-01:把目前字串加到「倉庫與聊天 › 倉庫搜尋」(熱鍵在那一頁設;第 39 步前分頁叫「聊天指令」) -->
          <button class="btn ghost sm" data-regex="add-stash" :disabled="!out.query || out.query.length > 250" :title="t('ppz.regex.add_stash_tip')" @click="addStash">
            {{ stashState === 'ok' ? t('ppz.regex.add_stash_done') : stashState === 'dup' ? t('ppz.regex.add_stash_dup') : t('ppz.regex.add_stash') }}
          </button>
          <select class="select sm" data-regex="lang" :value="ui.lang" :title="t('ppz.regex.lang_tip')"
            @change="onLang">
            <option value="zh">{{ t('ppz.regex.out_zh') }}</option>
            <option value="en">{{ t('ppz.regex.out_en') }}</option>
          </select>
        </div>
        <div v-if="notice" class="rx-notice" data-regex="notice">
          <span>{{ t(notice.key, notice.params ?? {}) }}</span>
          <button class="btn ghost sm" @click="dismissNotice">{{ t('ppz.regex.dismiss') }}</button>
        </div>
        <p v-if="saveError" class="rx-bad">{{ t('ppz.regex.save_failed', { error: saveError }) }}</p>
        <!-- R10:稀有度 / 汙染條件互相矛盾 → 不出字串;合併只併目前頁的物品組 -->
        <p v-if="!out.query && conditionClash" class="rx-bad rx-conflict-line" data-regex="condition-clash">{{ t('ppz.regex.condition_clash_out') }}</p>
        <p v-if="scope === 'combined' && mergeSkipped > 0" class="dim rx-conflict-line" data-regex="merge-skipped">
          {{ t('ppz.regex.merge_skipped', { n: mergeSkipped }) }}
        </p>
        <p v-if="scope === 'combined' && out.conflicts.length" class="rx-warn rx-conflict-line" data-regex="conflict-count">
          {{ t('ppz.regex.conflicts', { n: out.conflicts.length }) }}
          <a v-if="panelView !== 'combined'" href="#" @click.prevent="setPanelView('combined')">{{ t('ppz.regex.see_combined') }}</a>
        </p>
        <p v-if="scope === 'combined' && out.custom.length" class="dim rx-conflict-line">{{ t('ppz.regex.custom_unverified') }}</p>
        <template v-if="scope === 'page' && result">
          <details v-if="result.unresolved.length" class="rx-details" data-regex="unresolved">
            <summary class="rx-warn">{{ t('ppz.regex.unresolved', { n: result.unresolved.length }) }}</summary>
            <ul>
              <li v-for="i in result.unresolved" :key="i">{{ lineIn(page.entries[i], ui.lang) }}</li>
            </ul>
            <p class="dim">{{ t('ppz.regex.unresolved_why') }}</p>
          </details>
          <details v-if="result.usedTokens.length" class="rx-details" data-regex="tokens">
            <summary>{{ t('ppz.regex.tokens', { n: result.usedTokens.length }) }}</summary>
            <p class="dim">{{ t('ppz.regex.tokens_hint') }}</p>
            <ul class="rx-tokens">
              <li v-for="(tk, i) in result.usedTokens" :key="i">「{{ tk }}」</li>
            </ul>
          </details>
        </template>
      </section>

      <RegexBookmarks />
    </template>

    <Teleport to="body">
      <div v-if="tplConfirm" class="modal rx-modal" :class="fsClass" :style="fsStyle" @mousedown.self="tplConfirm = null">
        <div class="rx-dialog" role="dialog" aria-modal="true" data-regex="template-dialog">
          <div class="rx-dialog-title">{{ t('ppz.regex.template_apply_title', { name: uiEn ? tplConfirm.name.en : tplConfirm.name.zh }) }}</div>
          <p>{{ uiEn ? tplConfirm.desc.en : tplConfirm.desc.zh }}</p>
          <p class="dim">{{ t('ppz.regex.template_apply_warn', { game: gameLabel(tplConfirm.game) }) }}</p>
          <div class="rx-dialog-btns">
            <button class="btn primary" data-regex="template-ok" @click="confirmTemplate">{{ t('ppz.regex.apply') }}</button>
            <button class="btn" @click="tplConfirm = null">{{ t('ppz.regex.cancel') }}</button>
          </div>
        </div>
      </div>
      <div v-if="paste" class="modal rx-modal" :class="fsClass" :style="fsStyle" @mousedown.self="paste = null">
        <div class="rx-dialog" role="dialog" aria-modal="true" data-regex="share-dialog">
          <div class="rx-dialog-title">{{ t('ppz.regex.share_paste') }}</div>
          <p class="dim">{{ t('ppz.regex.share_paste_warn') }}</p>
          <textarea v-model="paste.code" class="input rx-share-input" rows="4" spellcheck="false" data-regex="share-input"
            :placeholder="t('ppz.regex.share_paste_ph')" />
          <p v-if="paste.error" class="rx-bad" data-regex="share-error">{{ paste.error }}</p>
          <div class="rx-dialog-btns">
            <button class="btn primary" data-regex="share-ok" :disabled="!paste.code.trim() || paste.busy" @click="confirmPaste">{{ t('ppz.regex.apply') }}</button>
            <button class="btn" @click="paste = null">{{ t('ppz.regex.cancel') }}</button>
          </div>
        </div>
      </div>
      <!-- 一鍵從 PobTools 送正則分享碼 / 書籤包(incoming-share.ts):確認才套用 / 加入,取消不改任何狀態;點暗幕不關(避免誤觸) -->
      <div v-if="incoming" class="modal rx-modal" :class="fsClass" :style="fsStyle">
        <div class="rx-dialog" role="dialog" aria-modal="true" data-regex="incoming-dialog" :data-phase="incoming.phase">
          <div class="rx-dialog-title">{{ t(incoming.kind === 'bookmarks' ? 'ppz.regex.incoming_bm_title' : 'ppz.regex.incoming_title') }}</div>
          <p class="dim" data-regex="incoming-source">{{ t('ppz.regex.incoming_source', { source: 'PobTools' }) }}</p>
          <p v-if="incoming.phase === 'loading'" class="pulse">{{ t('ppz.regex.incoming_loading') }}</p>
          <p v-else-if="incoming.phase === 'error'" class="rx-bad" data-regex="incoming-error" :data-reason="incoming.reason">
            {{ t(`ppz.regex.incoming_err_${incoming.reason}`, { detail: incoming.detail }) }}
          </p>
          <!-- 第 40 步:書籤包 —— 依遊戲 → 資料夾列出要加入的書籤;新資料夾、改名、找不到的項目另外標示 -->
          <template v-else-if="incoming.phase === 'confirm-bookmarks'">
            <p data-regex="incoming-bm-total">{{ t('ppz.regex.incoming_bm_total', { n: incoming.summary.total }) }}</p>
            <p class="dim">{{ t('ppz.regex.incoming_bm_keep') }}</p>
            <div class="rx-incoming-list" data-regex="incoming-bm-list">
              <div v-for="g in incoming.summary.games" :key="g.game" class="rx-incoming-game" :data-game="g.game">
                <div class="label">{{ gameLabel(g.game) }}</div>
                <div v-for="f in g.folders" :key="f.folder" class="rx-incoming-folder" :data-folder="f.folder">
                  <div class="rx-incoming-fname">
                    {{ f.folder || t('ppz.regex.fd_uncategorized') }}
                    <span v-if="f.isNew" class="chip soft" data-regex="incoming-bm-newfolder">{{ t('ppz.regex.incoming_bm_new_folder') }}</span>
                  </div>
                  <ul>
                    <li v-for="(x, k) in f.items" :key="k" data-regex="incoming-bm-item" :data-bm="x.name">
                      <template v-if="x.name !== x.originalName">{{ t('ppz.regex.incoming_bm_renamed', { from: x.originalName, to: x.name }) }}</template>
                      <template v-else>{{ x.name }}</template>
                      <span class="dim">({{ pageTitleOf(x.page) }})</span>
                      <span v-if="x.missed > 0" class="rx-warn" data-regex="incoming-bm-missed">{{ t('ppz.regex.incoming_bm_missed', { n: x.missed }) }}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <p v-if="incoming.summary.renamed > 0" class="dim" data-regex="incoming-bm-renamed">{{ t('ppz.regex.incoming_bm_renamed_note', { n: incoming.summary.renamed }) }}</p>
            <p v-if="incoming.summary.withMissed > 0" class="rx-warn">{{ t('ppz.regex.incoming_bm_missed_note', { n: incoming.summary.withMissed }) }}</p>
          </template>
          <template v-else>
            <p data-regex="incoming-game">{{ t('ppz.regex.incoming_game', { game: gameLabel(incoming.summary.game) }) }}</p>
            <p class="rx-warn">{{ t('ppz.regex.incoming_overwrite', { game: gameLabel(incoming.summary.game) }) }}</p>
            <p class="dim">{{ incoming.summary.replaced.length ? t('ppz.regex.incoming_replaced', { n: incoming.summary.replaced.length }) : t('ppz.regex.incoming_replaced_none', { game: gameLabel(incoming.summary.game) }) }}</p>
            <ul v-if="incoming.summary.replaced.length" class="rx-incoming-list" data-regex="incoming-replaced">
              <li v-for="r in incoming.summary.replaced" :key="r.id">{{ pageTitleOf(r.id) }}({{ r.n }})</li>
            </ul>
            <p>{{ t('ppz.regex.incoming_lists', { n: incoming.summary.incoming.length }) }}</p>
            <ul v-if="incoming.summary.incoming.length" class="rx-incoming-list" data-regex="incoming-lists">
              <li v-for="r in incoming.summary.incoming" :key="r.id">{{ pageTitleOf(r.id) }}({{ r.n }})</li>
            </ul>
            <p class="dim" data-regex="incoming-rest">
              {{ t('ppz.regex.incoming_rest', {
                custom: incoming.summary.custom, excludes: incoming.summary.excludes, mode: t(`ppz.regex.mode_${incoming.summary.mode}`),
                curCustom: incoming.summary.current.custom, curExcludes: incoming.summary.current.excludes
              }) }}
            </p>
            <p v-if="incoming.summary.missed > 0 || incoming.summary.unknownPages.length" class="rx-warn" data-regex="incoming-missed">
              {{ t('ppz.regex.incoming_missed', { n: incoming.summary.missed, pages: incoming.summary.unknownPages.join(', ') || '-' }) }}
            </p>
          </template>
          <div class="rx-dialog-btns">
            <button v-if="incoming.phase === 'confirm'" class="btn primary" data-regex="incoming-ok" @click="confirmIncoming">{{ t('ppz.regex.apply') }}</button>
            <button v-else-if="incoming.phase === 'confirm-bookmarks'" class="btn primary" data-regex="incoming-ok" @click="confirmIncoming">{{ t('ppz.regex.incoming_bm_add') }}</button>
            <button class="btn" data-regex="incoming-cancel" @click="cancelIncoming">{{ incoming.phase === 'confirm' || incoming.phase === 'confirm-bookmarks' ? t('ppz.regex.cancel') : t('ppz.regex.incoming_close') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isAlgoPage, isItemModPageId, lengthLevel, lineIn, type Mode, type RegexPage, type RegexTemplate } from '@exile-appraiser/regex'
import { AppConfig, addStashSearchEntry } from '@/web/Config'
import { useSettingsFs } from '@/web/settings/settings-fs'
import RegexList from './RegexList.vue'
import RegexAlgoList from './RegexAlgoList.vue'
import RegexItemModList from './RegexItemModList.vue'
import RegexCombined from './RegexCombined.vue'
import RegexBookmarks from './RegexBookmarks.vue'
import RegexNumericSection from './RegexNumericSection.vue'
import {
  GAMES, applyShareCode, applyTemplate, dismissNotice, ensureStarted, flushSave, gameLabel, hasPendingSave, makeShareCode,
  pagePickCount, retryCatalogue, setBilingual, setLang, setMode, setOutScope, setPanelView, switchGame, switchPage, useRegexStore
} from './store'
import { incomingShare } from './incoming'

/** 按鈕文字只能放純文字;複製失敗(例如視窗沒有焦點)時退回 execCommand */
async function writeClipboard (text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {}
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  if (!ok) throw new Error('copy failed')
}

export default defineComponent({
  components: { RegexList, RegexAlgoList, RegexItemModList, RegexCombined, RegexBookmarks, RegexNumericSection },
  setup () {
    const { t, te } = useI18n()
    const store = useRegexStore()
    const config = AppConfig()
    void ensureStarted(config.game)

    const uiEn = computed(() => config.uiLanguage === 'en')
    const copyState = shallowRef<'' | 'ok' | 'fail'>('')
    const shareState = shallowRef<'' | 'ok' | 'fail'>('')
    let copyTimer: ReturnType<typeof setTimeout> | undefined
    let shareTimer: ReturnType<typeof setTimeout> | undefined

    const scope = computed(() => store.ui.outScope)
    const out = computed(() => scope.value === 'combined' ? store.combined.value : store.pageCombined.value)
    const pageTitle = (p: RegexPage) => (uiEn.value ? p.titleEn : '') || p.title

    // 字串變了,「已複製」「已加入」就不再成立
    const stashState = shallowRef<'' | 'ok' | 'dup'>('')
    let stashTimer: ReturnType<typeof setTimeout> | undefined
    watch(() => out.value?.query, () => { copyState.value = ''; stashState.value = '' })
    onBeforeUnmount(() => {
      clearTimeout(copyTimer)
      clearTimeout(stashTimer)
      clearTimeout(shareTimer)
      if (hasPendingSave()) void flushSave()
    })

    const tplConfirm = shallowRef<RegexTemplate | null>(null)
    const paste = shallowRef<{ code: string, error: string, busy: boolean } | null>(null)

    const settingsFs = useSettingsFs()
    return {
      /** 對話框 Teleport 到 body,綁設定視窗獨立字級變數(第 21 步)+ `fs-own`(控制項補高,code review 第 C 批) */
      fsStyle: settingsFs.style,
      fsClass: settingsFs.cls,
      t,
      uiEn,
      games: GAMES,
      modes: ['any', 'all', 'none'] as Mode[],
      gameLabel,
      ui: store.ui,
      selGame: store.selGame,
      catalogue: store.catalogue,
      listed: store.listed,
      section: store.section,
      pagePickCount,
      page: store.page,
      picked: store.picked,
      pickedPages: store.pickedPages,
      mergeSkipped: store.mergeSkipped,
      anyPicked: store.anyPicked,
      conditionClash: computed(() => !!out.value?.conflicts.some(c => c.kind === 'conditionClash')),
      panelView: store.panelView,
      result: computed(() => store.result.value),
      algoPage: computed(() => isAlgoPage(store.page.value) ? store.page.value : null),
      // 第 37 步:物品詞綴數值頁(幾千條,先篩選再畫;第一次開頁才載入)
      itemPage: computed(() => isAlgoPage(store.page.value) && isItemModPageId(store.page.value.id) ? store.page.value : null),
      out,
      scope,
      notice: store.notice,
      saveError: store.saveError,
      slot: computed(() => store.catalogues[store.selGame.value]),
      myTemplates: computed(() => store.templates.value.filter(x => x.game === store.selGame.value)),
      copyState,
      shareState,
      tplConfirm,
      paste,
      /** 一鍵從 PobTools 送來的分享碼(確認 / 錯誤對話框) */
      incoming: incomingShare.view,
      pageTitleOf (id: string) {
        const p = store.pageById(id)
        return p ? pageTitle(p) : id
      },
      confirmIncoming () { incomingShare.confirm() },
      cancelIncoming () { incomingShare.cancel() },
      lenLevel: computed(() => {
        const r = out.value
        return r ? lengthLevel(r.length, r.limit) : 'ok'
      }),
      /** 每頁貢獻:「地圖詞綴 38 · 地圖數值條件 55 · 自訂 9」 */
      partsText: computed(() => {
        const r = out.value
        if (!r) return ''
        const parts = r.perPage.map(c => { const p = store.pageById(c.id); return `${p ? pageTitle(p) : c.id} ${c.length}` })
        if (r.custom.length) parts.push(`${t('ppz.regex.custom')} ${r.customLength}`)
        if (r.excludes.length) parts.push(`${t('ppz.regex.excludes')} ${r.excludesLength}`)
        return parts.join(' · ')
      }),
      pageTitle,
      // 資料檔的 note 只有中文;英文介面用 i18n 的譯文(沒有就照原文)
      pageNote: computed(() => {
        const p = store.page.value
        if (!p) return ''
        const key = `ppz.regex.page_note.${p.id}`
        return uiEn.value && te(key) ? t(key) : p.note
      }),
      lineIn,
      switchGame,
      switchPage,
      setMode,
      setOutScope,
      setPanelView,
      onLang (e: Event) {
        setLang((e.target as HTMLSelectElement).value === 'en' ? 'en' : 'zh')
      },
      setBilingual,
      retryCatalogue,
      dismissNotice,
      onTemplate (e: Event) {
        const sel = e.target as HTMLSelectElement
        const tp = store.templates.value.find(x => x.id === sel.value)
        sel.value = ''
        if (tp) tplConfirm.value = tp
      },
      confirmTemplate () {
        const tp = tplConfirm.value
        tplConfirm.value = null
        if (tp) applyTemplate(tp)
      },
      async copyShare () {
        clearTimeout(shareTimer)
        try {
          await writeClipboard(await makeShareCode())
          shareState.value = 'ok'
        } catch {
          shareState.value = 'fail'
        }
        shareTimer = setTimeout(() => { shareState.value = '' }, 1600)
      },
      async openPaste () {
        paste.value = { code: '', error: '', busy: false }
        try {
          const clip = (await navigator.clipboard.readText()).trim()
          if (paste.value && !paste.value.code && /^[A-Za-z0-9_-]{16,}$/.test(clip)) paste.value = { ...paste.value, code: clip }
        } catch {}
      },
      async confirmPaste () {
        const p = paste.value
        if (!p) return
        paste.value = { ...p, busy: true, error: '' }
        try {
          const warnings = await applyShareCode(p.code)
          if (warnings.length) console.warn('[regex] 分享碼警告', warnings)
          paste.value = null
        } catch (e) {
          paste.value = { ...p, busy: false, error: t('ppz.regex.share_bad', { error: e instanceof Error ? e.message : String(e) }) }
        }
      },
      stashState,
      /** 加到倉庫搜尋一鍵輸入(聊天指令分頁;熱鍵空白,使用者自己設);同一字串已在清單就不重複加 */
      addStash () {
        const r = addStashSearchEntry(config.stashSearch, out.value?.query ?? '')
        if (r === 'invalid') return
        if (r === 'added') config.stashSearch = [...config.stashSearch, { text: (out.value?.query ?? '').trim(), hotkey: '' }]
        stashState.value = r === 'added' ? 'ok' : 'dup'
        clearTimeout(stashTimer)
        stashTimer = setTimeout(() => { stashState.value = '' }, 1600)
      },
      async copy () {
        const q = out.value?.query
        if (!q) return
        clearTimeout(copyTimer)
        try {
          await writeClipboard(q)
          copyState.value = 'ok'
        } catch {
          copyState.value = 'fail'
        }
        copyTimer = setTimeout(() => { copyState.value = '' }, 1600)
      }
    }
  }
})
</script>

<style>
.rx-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.rx-head-row,
.rx-out-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}
.rx-incoming-game + .rx-incoming-game {
  margin-top: 6px;
}
.rx-incoming-folder ul {
  margin: 0 0 4px;
  padding-left: 1.4em;
}
.rx-incoming-fname {
  font-weight: 600;
}
.rx-incoming-list {
  margin: 0 0 6px;
  padding-left: 18px;
  max-height: 140px;
  overflow-y: auto;
  font-size: var(--fs-sm);
}
.rx-head-tools {
  margin-top: 8px;
}
.rx-head-row .grow,
.rx-out-row .grow {
  flex: 1;
}
.rx-page {
  min-width: 120px;
  max-width: 220px;
}
.rx-tpl {
  min-width: 140px;
  max-width: 260px;
}
.rx-count {
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.rx-note {
  margin: 8px 0 0;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.rx-loading {
  margin: 0;
  color: var(--ink-2);
  font-size: var(--fs-sm);
}
.rx-bad {
  margin: 0;
  color: var(--bad);
  font-size: var(--fs-xs);
}
.rx-warn {
  color: var(--warn);
}
.rx-out {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rx-out-label {
  margin: 0 !important;
}
.rx-query {
  height: auto;
  min-height: 64px;
  padding: 6px 9px;
  resize: vertical;
  font-family: var(--font-mono);
  word-break: break-all;
  user-select: text;
}
.rx-len {
  font-size: var(--fs-xs);
  color: var(--ok);
}
.rx-len.warn {
  color: var(--warn);
}
.rx-len.bad {
  color: var(--bad);
  font-weight: 600;
}
.rx-parts {
  font-size: var(--fs-2xs);
  color: var(--ink-3);
}
.rx-conflict-line {
  margin: 0;
  font-size: var(--fs-xs);
}
.rx-conflict-line.dim {
  color: var(--ink-3);
}
.rx-conflict-line a {
  margin-left: 6px;
  color: var(--gold);
}
.rx-copy {
  min-width: 72px;
  justify-content: center;
}
.rx-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-xs);
  color: var(--warn);
}
.rx-details {
  font-size: var(--fs-xs);
  color: var(--ink-2);
}
.rx-details summary {
  cursor: pointer;
}
.rx-details ul {
  margin: 4px 0;
  padding-left: 18px;
}
.rx-details .dim {
  margin: 4px 0 0;
  color: var(--ink-3);
}
.rx-tokens li {
  font-family: var(--font-mono);
  white-space: pre;
}
.rx-share-input {
  width: 100%;
  height: auto;
  margin: 6px 0;
  padding: 6px 9px;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  word-break: break-all;
  resize: vertical;
}
</style>
