<!--
  Poe Regex 面板(WP5,設定 › 正則):勾選詞綴 → 產生貼進遊戲搜尋列的字串。
  版面照 PobTools `host/regex_tool_ui.cpp`:標題列(遊戲 / 清單 / 模式 / 已勾選 / 雙語)→ 清單(RegexList.vue)
  → 輸出(長度三色、複製、輸出語言、無法單獨指定、用到的片段)→ 書籤(RegexBookmarks.vue)。
  演算法全在 `@exile-appraiser/regex`(純 TS,與 C++ golden 逐字相同);狀態在 ./store.ts。
-->
<template>
  <div class="rx-panel" data-regex="panel" :data-game="selGame" :data-page="page?.id ?? ''">
    <section class="card rx-head" data-regex="header">
      <div class="rx-head-row">
        <div class="seg" data-regex="game">
          <button v-for="g in games" :key="g" :class="{ on: selGame === g }" :data-value="g"
            @click="switchGame(g)">{{ gameLabel(g) }}</button>
        </div>
        <select v-if="catalogue" class="select sm rx-page" data-regex="page" :value="page?.id"
          @change="switchPage(($event.target as HTMLSelectElement).value)">
          <option v-for="p in catalogue.pages" :key="p.id" :value="p.id">{{ pageTitle(p) }}</option>
        </select>
        <div class="seg" data-regex="mode">
          <button v-for="m in modes" :key="m" :class="{ on: ui.mode === m }" :data-value="m"
            :title="m === 'none' ? t('ppz.regex.mode_none_tip') : ''" @click="setMode(m)">{{ t(`ppz.regex.mode_${m}`) }}</button>
        </div>
        <span v-if="page" class="rx-count num" data-regex="count">{{ t('ppz.regex.picked', { n: picked.length, total: page.entries.length }) }}</span>
        <span class="grow" />
        <label class="chk" :title="t('ppz.regex.bilingual_tip')">
          <input type="checkbox" data-regex="bilingual" :checked="ui.bilingual"
            @change="setBilingual(($event.target as HTMLInputElement).checked)">
          {{ t('ppz.regex.bilingual') }}
        </label>
      </div>
      <p v-if="page && pageNote" class="rx-note">{{ pageNote }}</p>
    </section>

    <section v-if="!catalogue" class="card" :class="{ bad: slot.phase === 'error' }" data-regex="status">
      <p v-if="slot.phase === 'error'" class="rx-bad">
        {{ t('ppz.regex.load_failed', { game: gameLabel(selGame), error: slot.error }) }}
        <button class="btn sm" data-regex="retry" @click="retryCatalogue(selGame)">{{ t('ppz.regex.retry') }}</button>
      </p>
      <p v-else class="rx-loading pulse">{{ t('ppz.regex.loading') }}</p>
    </section>

    <template v-if="page && result">
      <RegexList />

      <section class="card rx-out" data-regex="output">
        <span class="label">{{ t('ppz.regex.output_hint') }}</span>
        <textarea class="input rx-query selectable" readonly rows="3" spellcheck="false" data-regex="query"
          :value="result.query" @focus="($event.target as HTMLTextAreaElement).select()" />
        <div class="rx-out-row">
          <span class="num rx-len" :class="lenLevel" data-regex="length" :data-level="lenLevel">
            {{ t('ppz.regex.length', { len: result.length, limit: page.limit }) }}
          </span>
          <span v-if="lenLevel === 'bad'" class="rx-bad" data-regex="over-limit">{{ t('ppz.regex.over_limit') }}</span>
          <span class="grow" />
          <button class="btn primary sm rx-copy" data-regex="copy" :disabled="!result.query" @click="copy">
            {{ copyState === 'ok' ? t('ppz.regex.copied') : copyState === 'fail' ? t('ppz.regex.copy_failed') : t('ppz.regex.copy') }}
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
      </section>

      <RegexBookmarks />
    </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { lengthLevel, lineIn, type Mode, type RegexPage } from '@exile-appraiser/regex'
import { AppConfig } from '@/web/Config'
import RegexList from './RegexList.vue'
import RegexBookmarks from './RegexBookmarks.vue'
import {
  GAMES, dismissNotice, ensureStarted, flushSave, gameLabel, hasPendingSave, retryCatalogue, setBilingual, setLang,
  setMode, switchGame, switchPage, useRegexStore
} from './store'

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
  components: { RegexList, RegexBookmarks },
  setup () {
    const { t, te } = useI18n()
    const store = useRegexStore()
    const config = AppConfig()
    void ensureStarted(config.game)

    const uiEn = computed(() => config.uiLanguage === 'en')
    const copyState = shallowRef<'' | 'ok' | 'fail'>('')
    let copyTimer: ReturnType<typeof setTimeout> | undefined

    // 字串變了,「已複製」就不再成立
    watch(() => store.result.value?.query, () => { copyState.value = '' })
    onBeforeUnmount(() => {
      clearTimeout(copyTimer)
      if (hasPendingSave()) void flushSave()
    })

    return {
      t,
      games: GAMES,
      modes: ['any', 'all', 'none'] as Mode[],
      gameLabel,
      ui: store.ui,
      selGame: store.selGame,
      catalogue: store.catalogue,
      page: store.page,
      picked: store.picked,
      result: store.result,
      notice: store.notice,
      saveError: store.saveError,
      slot: computed(() => store.catalogues[store.selGame.value]),
      copyState,
      lenLevel: computed(() => {
        const r = store.result.value
        const p = store.page.value
        return r && p ? lengthLevel(r.length, p.limit) : 'ok'
      }),
      pageTitle: (p: RegexPage) => (uiEn.value ? p.titleEn : '') || p.title,
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
      onLang (e: Event) {
        setLang((e.target as HTMLSelectElement).value === 'en' ? 'en' : 'zh')
      },
      setBilingual,
      retryCatalogue,
      dismissNotice,
      async copy () {
        const q = store.result.value?.query
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
.rx-head-row .grow,
.rx-out-row .grow {
  flex: 1;
}
.rx-page {
  min-width: 120px;
  max-width: 220px;
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
.rx-out > .label {
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
</style>
